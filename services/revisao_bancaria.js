/**
 * RASTREIA — Revisão de Contrato Bancário: registro, preço e etapas.
 *
 * Tabela revisao_bancaria (1 por pedido). Etapas:
 *   aguardando_documentos → extraindo → conferencia_operador → calculando
 *   → revisao_juridica → aprovado   (ou reprovado_juridico → conferencia_operador)
 *
 * Toda mudança de etapa: transação + pg_advisory_xact_lock(pedido_id) + linha em logs.
 * Regra de ouro do produto: a IA LÊ e EXPLICA; quem CALCULA é código
 * determinístico (services/revisao_bancaria_calculo.js).
 */
const { pool } = require('../db');

const TIPO = 'revisao_contrato_bancario';
const ETAPAS = ['aguardando_documentos', 'extraindo', 'conferencia_operador', 'calculando', 'revisao_juridica', 'aprovado', 'reprovado_juridico'];
const TIPOS_OPERACAO = ['financiamento_veiculo', 'emprestimo_pessoal', 'consignado', 'renegociacao', 'ccb_capital_giro', 'conta_garantida', 'desconto_recebiveis', 'antecipacao_cartao', 'cartao_credito', 'cheque_especial', 'financiamento_bens', 'arrendamento_mercantil', 'vendor', 'compror', 'cambio', 'comercio_exterior', 'financiamento_imobiliario', 'outro'];
const SITUACOES = ['em_dia', 'atrasado', 'busca_apreensao', 'executado', 'quitado'];

async function config(chave, padrao) {
  try {
    const r = await pool.query('SELECT valor FROM configuracoes WHERE chave = $1', [chave]);
    return r.rows.length && r.rows[0].valor !== null && r.rows[0].valor !== '' ? r.rows[0].valor : padrao;
  } catch (_) { return padrao; }
}
async function configNum(chave, padrao) {
  const n = Number(String(await config(chave, padrao)).replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
}

// Preço: fixo (padrão R$ 1.500) ou percentual do valor financiado com mínimo.
async function precoRevisao(valorFinanciado) {
  const modo = String(await config('revisao_bancaria_modo', 'fixo')).trim().toLowerCase();
  const fixo = await configNum('revisao_bancaria_preco_fixo', 1500);
  if (modo !== 'percentual') return fixo;
  const pct = await configNum('revisao_bancaria_percentual', 1);
  const minimo = await configNum('revisao_bancaria_preco_minimo', 1500);
  const v = Number(valorFinanciado) || 0;
  return Math.max(minimo, Math.round(v * pct) / 100);
}

// Normaliza o que o operador digitou no pedido (tudo opcional; a IA preenche depois)
function normalizarInformados(b = {}) {
  const num = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null; };
  const data = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : null);
  return {
    tipo_operacao: TIPOS_OPERACAO.includes(b.tipo_operacao) ? b.tipo_operacao : null,
    banco: (b.banco || '').toString().trim().slice(0, 120) || null,
    data_contratacao: data(b.data_contratacao),
    valor_financiado: num(b.valor_financiado),
    valor_parcela: num(b.valor_parcela),
    prazo_meses: num(b.prazo_meses) ? Math.round(num(b.prazo_meses)) : null,
    parcelas_pagas: Number.isFinite(Number(b.parcelas_pagas)) && Number(b.parcelas_pagas) >= 0 ? Math.round(Number(b.parcelas_pagas)) : null,
    situacao: SITUACOES.includes(b.situacao) ? b.situacao : null
  };
}

async function criarRegistro(pedidoId, informados, consentimento) {
  await pool.query(
    `INSERT INTO revisao_bancaria (pedido_id, dados_informados, consentimento_lgpd_em)
     VALUES ($1, $2, $3) ON CONFLICT (pedido_id) DO NOTHING`,
    [pedidoId, JSON.stringify(informados || {}), consentimento ? new Date() : null]
  );
}

async function obter(pedidoId) {
  const r = await pool.query('SELECT * FROM revisao_bancaria WHERE pedido_id = $1', [pedidoId]);
  return r.rows[0] || null;
}

// Atualiza campos e/ou etapa sob lock, com log. `campos` = {coluna: valor}.
async function atualizar(pedidoId, { etapa, campos = {}, usuarioId = null, acao, detalhes = '' } = {}) {
  if (etapa && !ETAPAS.includes(etapa)) throw new Error(`Etapa inválida: ${etapa}`);
  const permitidas = new Set(['dados_extraidos', 'dados_conferidos', 'taxa_media_bacen', 'calculo', 'teses', 'veredito',
    'economia_estimada', 'parecer_ia', 'parecer_juridico', 'revisor_id', 'revisado_em', 'versao_calculo']);
  const sets = []; const vals = [];
  for (const [k, v] of Object.entries(campos)) {
    if (!permitidas.has(k)) throw new Error(`Campo não permitido: ${k}`);
    vals.push(v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (etapa) { vals.push(etapa); sets.push(`etapa = $${vals.length}`); }
  sets.push('atualizado_em = now()');
  vals.push(pedidoId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(pedidoId)]);
    const r = await client.query(`UPDATE revisao_bancaria SET ${sets.join(', ')} WHERE pedido_id = $${vals.length} RETURNING *`, vals);
    if (etapa || acao) {
      await client.query('INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)',
        [pedidoId, usuarioId, acao || `Revisão bancária: etapa ${etapa}`, detalhes || null]);
    }
    await client.query('COMMIT');
    return r.rows[0] || null;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Pagamento confirmado: com contrato anexado vai para a extração; sem, aguarda documentos.
// (A extração IA entra na etapa 4 da entrega — services/revisao_bancaria_ia.js.)
async function iniciarAposPagamento(pedidoId) {
  const reg = await obter(pedidoId);
  if (!reg) return { ok: false, erro: 'registro_revisao_ausente' };
  const docs = await pool.query('SELECT COUNT(*)::int AS n FROM pedido_documentos WHERE pedido_id = $1', [pedidoId]);
  if (!docs.rows[0].n) {
    await atualizar(pedidoId, { etapa: 'aguardando_documentos', acao: 'Revisão bancária: aguardando contrato', detalhes: 'Pagamento confirmado sem contrato anexado' });
    return { ok: true, etapa: 'aguardando_documentos' };
  }
  // Veio da análise rápida: o contrato já foi lido — vai direto para a conferência
  if (reg.dados_extraidos) {
    await atualizar(pedidoId, { etapa: 'conferencia_operador', acao: 'Revisão bancária: conferência', detalhes: 'Contrato já lido na análise rápida — sem nova leitura da IA' });
    return { ok: true, etapa: 'conferencia_operador' };
  }
  let extrair = null;
  try { extrair = require('./revisao_bancaria_ia').extrairContrato; } catch (_) { /* etapa 4 */ }
  if (!extrair) {
    await atualizar(pedidoId, { etapa: 'conferencia_operador', acao: 'Revisão bancária: conferência manual', detalhes: 'Extração IA ainda não disponível — operador preenche os dados' });
    return { ok: true, etapa: 'conferencia_operador' };
  }
  return extrair(pedidoId);
}

module.exports = { iniciarAposPagamento, TIPO, ETAPAS, TIPOS_OPERACAO, SITUACOES, config, configNum, precoRevisao, normalizarInformados, criarRegistro, obter, atualizar };
