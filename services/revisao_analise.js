/**
 * RASTREIA — Análise rápida de contrato (aba Revisão de Contratos).
 *
 *   sobe o contrato → IA lê (revisao_bancaria_ia.lerDocumentos) → o CÓDIGO
 *   calcula (taxa BACEN + motor + teses) → veredito PRELIMINAR na tela.
 *
 * Sem cliente, sem valor, sem advogado: serve para decidir se o caso vale uma
 * revisão completa. Os dados lidos ficam editáveis e o veredito é refeito na
 * hora (recalcular). "Abrir revisão" leva arquivos e dados para um pedido
 * (vincularAoPedido), sem ler o contrato de novo.
 * Regra de ouro mantida: a IA só lê; todo número sai do motor de cálculo.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const calculo = require('./revisao_bancaria_calculo');
const teses = require('./revisao_bancaria_teses');
const bacen = require('./bacen_taxas');
const { serieParaOperacao } = require('./bacen_series');

async function obter(id) {
  const r = await pool.query('SELECT * FROM revisao_analises WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function salvar(id, campos) {
  const ks = Object.keys(campos);
  const sets = ks.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = ks.map(k => (campos[k] !== null && typeof campos[k] === 'object' ? JSON.stringify(campos[k]) : campos[k]));
  await pool.query(`UPDATE revisao_analises SET ${sets}, atualizado_em = now() WHERE id = $1`, [id, ...vals]);
}

// Parcelas pagas: o contrato não diz. Estimativa pelos meses desde o 1º
// vencimento (marcada como estimada — o operador corrige na tela).
function estimarPagas(op, hoje = new Date()) {
  const m = String(op.data_primeiro_vencimento || op.data_contratacao || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const n = Math.round(Number(op.prazo_meses) || 0);
  if (!m || !n) return null;
  let meses = (hoje.getFullYear() - Number(m[1])) * 12 + (hoje.getMonth() + 1 - Number(m[2]));
  if (hoje.getDate() >= Number(m[3])) meses += 1;      // a do mês já venceu
  if (!op.data_primeiro_vencimento) meses -= 1;          // contratação ≈ 1 mês antes do 1º vencimento
  return Math.max(0, Math.min(n, meses));
}

// Saída da IA → dados no formato do motor de cálculo (o mesmo da conferência)
function montarDados(ex = {}) {
  const op = { ...(ex.operacao || {}) };
  const cl = ex.classificacao || {};
  const doc = require('./documento').limparDoc(ex.contratante?.cpf_cnpj);
  // Parcelas pagas: o que extrato/carnê comprova vale mais que a estimativa pela data
  const pg = ex.pagamentos || {};
  const doDoc = Number.isFinite(Number(pg.parcelas_pagas)) && pg.parcelas_pagas !== null ? Math.round(Number(pg.parcelas_pagas)) : null;
  const pagas = doDoc != null ? doDoc : estimarPagas(op);
  return {
    pfpj: cl.pfpj || (doc.length === 14 ? 'PJ' : 'PF'),
    tipo_operacao: cl.tipo_operacao || 'outro',
    subtipo: cl.subtipo || null,
    situacao: Number(pg.parcelas_em_atraso) > 0 ? 'atrasado' : null,
    parcelas_pagas: pagas,
    parcelas_pagas_estimadas: doDoc == null && pagas != null,
    parcelas_pagas_origem: doDoc != null ? (pg.documento_origem || 'documento') : (pagas != null ? 'estimativa' : null),
    instituicao: { nome: ex.instituicao?.nome || null, cnpj: ex.instituicao?.cnpj || null },
    contratante: { nome: ex.contratante?.nome || null, cpf_cnpj: ex.contratante?.cpf_cnpj || null },
    operacao: op,
    garantia: ex.garantia || {},
    tarifas: ex.tarifas || [],
    seguros: ex.seguros || [],
    iof: ex.iof || {},
    encargos_mora: ex.encargos_mora || {},
    campos_editados: []
  };
}

// Taxa média: manual > mesma série/mês já buscada > BACEN
async function taxaPara(d, anterior) {
  if (d.taxa_media_manual && d.taxa_media_manual.ok) return d.taxa_media_manual;
  const serie = serieParaOperacao(d.tipo_operacao || 'outro', d.pfpj || 'PF', d.subtipo || null);
  const mes = String(d.operacao?.data_contratacao || '').slice(0, 7);
  if (anterior && anterior.ok && String(anterior.serie_am) === String(serie.am) && anterior.mes_contratacao === mes) return anterior;
  return bacen.buscarTaxaMedia({ tipoOperacao: d.tipo_operacao || 'outro', pfpj: d.pfpj || 'PF', subtipo: d.subtipo || null, dataContratacao: d.operacao?.data_contratacao, banco: d.instituicao || {} });
}

// Cálculo + teses (sem IA). Devolve os campos para salvar.
async function calcularAnalise(d, taxaAnterior) {
  const taxa = await taxaPara(d, taxaAnterior);
  const { limiares } = require('./revisao_bancaria_fluxo');
  const ipcaMensal = await bacen.buscarIPCA(String(d.operacao?.data_contratacao || '').slice(0, 7) || null);
  const calc = calculo.calcular(d, { taxaMediaBacenAM: taxa && taxa.ok ? taxa.valor_am : null, questionaveis: teses.itensQuestionaveis(d), limiares: await limiares(), ipcaMensal });
  if (!taxa || !taxa.ok) calc.alertas.unshift(`Taxa média do Banco Central indisponível${taxa?.erro ? ` (${taxa.erro})` : ''}: o veredito considera só tarifas e seguros. Informe a taxa para comparar os juros.`);
  if (d.parcelas_pagas_estimadas) calc.alertas.push('Parcelas pagas ESTIMADAS pela data do 1º vencimento: confirme com o cliente (extrato ou carnê).');
  const ts = teses.aplicarTeses(d, calc);
  return {
    taxa_media_bacen: taxa && taxa.ok ? taxa : { ok: false, erro: taxa?.erro || 'indisponível' },
    calculo: calc, teses: ts, veredito: calc.veredito.nivel,
    economia_estimada: Math.round((calc.economia_estimada || 0) * 100) / 100
  };
}

// Leitura + cálculo (roda em segundo plano depois do upload)
async function processar(id) {
  const ia = require('./revisao_bancaria_ia');
  const a = await obter(id);
  if (!a) return;
  try {
    if (!ia.disponivel()) throw new Error('IA indisponível (ANTHROPIC_API_KEY ausente).');
    await salvar(id, { status: 'lendo', erro: null });
    const { dados: ex, r } = await ia.lerDocumentos(a.arquivos || []);
    const d = montarDados(ex);
    const custo = await ia.custoDaChamada('analise_rapida', r);
    await salvar(id, { dados_extraidos: ex, dados: d, custo_ia: [...(Array.isArray(a.custo_ia) ? a.custo_ia : []), custo] });
    await salvar(id, { ...(await calcularAnalise(d, null)), status: 'pronto' });
  } catch (e) {
    console.error('[revisao-analise] falhou:', e.message);
    await salvar(id, { status: 'erro', erro: e.message.slice(0, 500) });
  }
}

// Operador corrigiu dados na tela → recalcula (sem IA)
async function recalcular(id, dadosNovos, camposEditados = []) {
  const a = await obter(id);
  if (!a) return null;
  const d = { ...dadosNovos, campos_editados: [...new Set([...(a.dados?.campos_editados || []), ...camposEditados])] };
  if (camposEditados.includes('parcelas_pagas')) { d.parcelas_pagas_estimadas = false; d.parcelas_pagas_origem = 'operador'; }
  const out = await calcularAnalise(d, a.taxa_media_bacen);
  await salvar(id, { dados: d, ...out, status: 'pronto', erro: null });
  return obter(id);
}

/**
 * "Abrir revisão": copia os arquivos para o pedido, leva a leitura e os dados
 * corrigidos (a conferência do operador começa deles) e marca a análise.
 */
async function vincularAoPedido(analiseId, pedidoId, uploadsRoot, usuarioId) {
  const a = await obter(analiseId);
  if (!a || a.pedido_id) return { ok: false, erro: a ? 'análise já virou revisão' : 'análise não encontrada' };
  const dir = path.join(uploadsRoot, pedidoId);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of a.arquivos || []) {
    if (!fs.existsSync(f.filepath)) continue;
    const destino = path.join(dir, path.basename(f.filepath));
    fs.copyFileSync(f.filepath, destino);
    await pool.query('INSERT INTO pedido_documentos (pedido_id, tipo, filename, filepath, size_bytes, mime_type) VALUES ($1, $2, $3, $4, $5, $6)',
      [pedidoId, null, f.filename, destino, f.size_bytes || null, f.mime_type || null]);
  }
  await pool.query(
    `UPDATE revisao_bancaria SET dados_extraidos = $2, dados_conferidos = $3, taxa_media_bacen = COALESCE(taxa_media_bacen, $4), atualizado_em = now() WHERE pedido_id = $1`,
    [pedidoId, JSON.stringify(a.dados_extraidos || null), a.dados ? JSON.stringify(a.dados) : null, a.taxa_media_bacen && a.taxa_media_bacen.ok ? JSON.stringify(a.taxa_media_bacen) : null]);
  if (Array.isArray(a.custo_ia)) for (const c of a.custo_ia) {
    await pool.query("INSERT INTO dados_consulta (pedido_id, fonte, dados) VALUES ($1, 'custo_ia_revisao', $2)", [pedidoId, JSON.stringify(c)]);
  }
  await salvar(analiseId, { pedido_id: pedidoId });
  await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)',
    [pedidoId, usuarioId || null, 'Revisão bancária: aberta a partir da análise rápida', `Veredito preliminar ${a.veredito || '—'} · ${(a.arquivos || []).length} documento(s) reaproveitado(s), sem nova leitura da IA`]);
  return { ok: true };
}

module.exports = { obter, salvar, processar, recalcular, montarDados, estimarPagas, calcularAnalise, vincularAoPedido };
