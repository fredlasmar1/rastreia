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

// Faixa de juros escrita no contrato ("taxa mínima de 2,26% ao mês e a taxa
// máxima de 100,00% ao mês") — rede de segurança se a IA não preencheu os campos
const numBR = (t) => Number(String(t).replace(/\./g, '').replace(',', '.'));
function faixaDoTrecho(txt) {
  const m = String(txt || '').match(/m[ií]nima\s+de\s+([\d.,]+)\s*%[^%]{0,80}?m[aá]xima\s+de\s+([\d.,]+)\s*%/i);
  if (!m) return null;
  const min = numBR(m[1]), max = numBR(m[2]);
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min ? { min, max } : null;
}
const reLimite = /limite\s+de\s+cr[eé]dito|cr[eé]dito\s+pr[eé]-?aprovado|girocaixa|cheque\s+empresa|conta\s+garantida/i;

// Saída da IA → dados no formato do motor de cálculo (o mesmo da conferência)
// Contrato de limite: cada saque é uma operação; o limite não é valor financiado
function marcarLimite(op) {
  const faixa = (op.taxa_minima_mensal != null || op.taxa_maxima_mensal != null) ? null : faixaDoTrecho(op.clausula_capitalizacao_trecho);
  if (faixa) { op.taxa_minima_mensal = faixa.min; op.taxa_maxima_mensal = faixa.max; }
  if (!op.estrutura && (reLimite.test(op.tipo || '') || faixa)) op.estrutura = 'limite_de_credito';
  if (op.estrutura === 'limite_de_credito' && op.limite_credito == null && op.valor_financiado_total != null && op.valor_parcela == null && op.prazo_meses == null) {
    op.limite_credito = op.valor_financiado_total; op.valor_financiado_total = null;
  }
  return op;
}

function montarDados(ex = {}) {
  const op = marcarLimite({ ...(ex.operacao || {}) });
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
    programa: cl.programa || null,
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
    operacoes_do_limite: Array.isArray(ex.operacoes_do_limite) ? ex.operacoes_do_limite : [],
    clausulas: ex.clausulas || {},
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

// Contrato de LIMITE (GiroCaixa, cheque empresa…): o papel não tem a taxa de
// cada saque. Sem o demonstrativo da operação, diz o que pedir ao cliente e
// compara o PISO da faixa com a média do BACEN (sinal, não cálculo).
function limiteDeCredito(d, calc, taxa) {
  const op = d.operacao || {};
  if (op.estrutura !== 'limite_de_credito') return;
  const fx = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const media = taxa && taxa.ok ? Number(taxa.valor_am) : null;
  const sinais = [];
  if (op.taxa_minima_mensal != null && media) {
    const r = op.taxa_minima_mensal / media;
    calc.limite = { taxa_minima_am: op.taxa_minima_mensal, taxa_maxima_am: op.taxa_maxima_mensal ?? null, media_bacen_am: media, razao_piso: r };
    sinais.push(`Mesmo a taxa MÍNIMA do contrato (${fx(op.taxa_minima_mensal)}% a.m.) já é ${r.toFixed(2).replace('.', ',')}× a média do Banco Central (${fx(media)}% a.m.)${r >= 1.5 ? ' — indício forte de juros abusivos em qualquer saque' : r >= 1.2 ? ' — os saques tendem a ficar acima do mercado' : ''}.`);
  }
  if (op.taxa_maxima_mensal != null && op.taxa_maxima_mensal >= 10) sinais.push(`O contrato permite ao banco cobrar até ${fx(op.taxa_maxima_mensal)}% a.m.: a taxa de cada saque é escolhida pelo banco na hora — ponto para o advogado avaliar.`);
  if (calc.veredito?.nivel === 'incompleto') {
    const nOps = (d.operacoes_do_limite || []).length;
    calc.veredito.motivo = `Este é um contrato de LIMITE de crédito${op.limite_credito ? ` (R$ ${fx(op.limite_credito)})` : ''}: ele só abre o limite; cada empréstimo tirado dele tem taxa, prazo e parcela próprios. ` +
      (nOps ? `Foram encontradas ${nOps} operação(ões) nos documentos: confira os dados de uma delas abaixo e recalcule.` : 'Para analisar, peça ao cliente o DEMONSTRATIVO (ou comprovante/extrato) de cada empréstimo contratado no limite e clique em "Adicionar documentos".');
    calc.veredito.pedir_documentos = ['Demonstrativo / comprovante de cada empréstimo tirado do limite (internet banking ou agência)', 'Extrato da conta mostrando as parcelas debitadas'];
  }
  calc.alertas.unshift(...sinais);
}

// Pronampe: o teto é Selic do mês da contratação + spread (Lei 13.999, art. 3º, I)
async function selicSePronampe(d) {
  if (require('./revisao_tetos').programaDoContrato(d) !== 'pronampe') return null;
  const s = await bacen.buscarSelicAnual(String(d.operacao?.data_contratacao || '').slice(0, 7));
  return s ? s.valor_aa : null;
}

// Cálculo + teses (sem IA). Devolve os campos para salvar.
async function calcularAnalise(d, taxaAnterior) {
  const editouValor = (d.campos_editados || []).some(k => /valor_financiado_total/.test(k));
  if (d.operacao && !d.operacao.estrutura && !editouValor) d.operacao = marcarLimite({ ...d.operacao });   // análises lidas antes da v1.4
  const taxa = await taxaPara(d, taxaAnterior);
  const { limiares } = require('./revisao_bancaria_fluxo');
  const ipcaMensal = await bacen.buscarIPCA(String(d.operacao?.data_contratacao || '').slice(0, 7) || null);
  const selicAA = await selicSePronampe(d);
  const calc = calculo.calcular(d, { taxaMediaBacenAM: taxa && taxa.ok ? taxa.valor_am : null, questionaveis: teses.itensQuestionaveis(d), limiares: await limiares(), ipcaMensal, selicAA });
  if (!taxa || !taxa.ok) calc.alertas.unshift(`Taxa média do Banco Central indisponível${taxa?.erro ? ` (${taxa.erro})` : ''}: o veredito considera só tarifas e seguros. Informe a taxa para comparar os juros.`);
  if (d.parcelas_pagas_estimadas) calc.alertas.push('Parcelas pagas ESTIMADAS pela data do 1º vencimento: confirme com o cliente (extrato ou carnê).');
  limiteDeCredito(d, calc, taxa);
  const ts = teses.aplicarTeses(d, calc);
  const diagnostico = require('./revisao_diagnostico').montarDiagnostico(d, calc, taxa, ts);
  return {
    diagnostico,
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
    `UPDATE revisao_bancaria SET dados_extraidos = $2, dados_conferidos = $3, taxa_media_bacen = COALESCE(taxa_media_bacen, $4), diagnostico = COALESCE(diagnostico, $5), atualizado_em = now() WHERE pedido_id = $1`,
    [pedidoId, JSON.stringify(a.dados_extraidos || null), a.dados ? JSON.stringify(a.dados) : null, a.taxa_media_bacen && a.taxa_media_bacen.ok ? JSON.stringify(a.taxa_media_bacen) : null, a.diagnostico ? JSON.stringify(a.diagnostico) : null]);
  if (Array.isArray(a.custo_ia)) for (const c of a.custo_ia) {
    await pool.query("INSERT INTO dados_consulta (pedido_id, fonte, dados) VALUES ($1, 'custo_ia_revisao', $2)", [pedidoId, JSON.stringify(c)]);
  }
  await salvar(analiseId, { pedido_id: pedidoId });
  await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)',
    [pedidoId, usuarioId || null, 'Revisão bancária: aberta a partir da análise rápida', `Veredito preliminar ${a.veredito || '—'} · ${(a.arquivos || []).length} documento(s) reaproveitado(s), sem nova leitura da IA`]);
  return { ok: true };
}

module.exports = { obter, salvar, processar, recalcular, montarDados, estimarPagas, calcularAnalise, vincularAoPedido, faixaDoTrecho, limiteDeCredito, marcarLimite, selicSePronampe };
