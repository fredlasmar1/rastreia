/**
 * RASTREIA — Taxa média de juros do Banco Central para a Revisão Bancária.
 *
 * Fonte primária: API SGS (sem chave)
 *   https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados?formato=json&dataInicial=dd/mm/aaaa&dataFinal=dd/mm/aaaa
 * Fonte complementar: Olinda taxaJuros (taxa por instituição no mês) — só
 * para mostrar a posição do banco no laudo; não entra no cálculo.
 *
 * Mês de referência = mês da contratação. Sem dado no mês ⇒ volta mês a mês
 * (até 6) e registra o mês usado. Cache em dados_consulta
 * (fonte = 'bacen_taxa_media'). Falha ⇒ { ok:false } e a etapa trava para o
 * operador informar a taxa manual (origem "manual" no laudo).
 */
const axios = require('axios');
const { serieParaOperacao, VALIDADO_EM } = require('./bacen_series');

const SGS = (c) => `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${c}/dados`;
const pad = (n) => String(n).padStart(2, '0');
const ultimoDia = (a, m) => new Date(a, m, 0).getDate();   // m: 1-12

async function getComRetry(url, params, tentativas = 3) {
  let ultimo;
  for (let t = 0; t < tentativas; t++) {
    try {
      const r = await axios.get(url, { params, timeout: 15000 });
      return r.data;
    } catch (e) {
      ultimo = e;
      await new Promise(r => setTimeout(r, 600 * (t + 1)));
    }
  }
  throw ultimo;
}

// Valor de uma série SGS num mês (a, m). null se o mês não tem dado.
async function valorSgsNoMes(codigo, a, m) {
  const dados = await getComRetry(SGS(codigo), {
    formato: 'json', dataInicial: `01/${pad(m)}/${a}`, dataFinal: `${ultimoDia(a, m)}/${pad(m)}/${a}`
  });
  if (!Array.isArray(dados) || !dados.length) return null;
  const v = Number(String(dados[dados.length - 1].valor).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

// Posição do banco na Olinda — Best-effort, não entra no cálculo.
// O dado MENSAL da Olinda só tem financiamento imobiliário; as demais
// modalidades estão no SEMANAL (TaxasJurosDiariaPorInicioPeriodo), que separa
// PF/PJ. Usa a primeira semana iniciada no mês da contratação. A Olinda exige
// espaço como %20 (o '+' do axios quebra o $filter), por isso a URL é montada à mão.
const OLINDA_SEMANAL = 'https://olinda.bcb.gov.br/olinda/servico/taxaJuros/versao/v2/odata/TaxasJurosDiariaPorInicioPeriodo';
async function posicaoBancoOlinda(modalidade, anoMes, banco = {}, segmento = 'PF') {
  if (!modalidade) return null;
  try {
    const [a, m] = anoMes.split('-').map(Number);
    const q = (v) => encodeURIComponent(v).replace(/'/g, '%27');
    const filtro = `InicioPeriodo ge '${anoMes}-01' and InicioPeriodo le '${anoMes}-${pad(ultimoDia(a, m))}'` +
      ` and Modalidade eq '${modalidade.replace(/'/g, "''")}' and Segmento eq '${segmento === 'PJ' ? 'PESSOA JURÍDICA' : 'PESSOA FÍSICA'}'`;
    const url = `${OLINDA_SEMANAL}?%24format=json&%24top=500&%24orderby=InicioPeriodo%20asc&%24filter=${q(filtro)}`;
    let d = null, ult;
    for (let t = 0; t < 2 && !d; t++) {
      try { d = (await axios.get(url, { timeout: 20000 })).data; } catch (e) { ult = e; await new Promise(r => setTimeout(r, 800)); }
    }
    if (!d) throw ult;
    const todas = (d && d.value) || [];
    if (!todas.length) return null;
    const semana = todas[0].InicioPeriodo;
    const linhas = todas.filter(l => l.InicioPeriodo === semana);
    const cnpj8 = String(banco.cnpj || '').replace(/\D/g, '').slice(0, 8);
    const IGN = ['BANCO', 'BCO', 'S.A', 'SA', 'S/A', 'FINANCEIRA', 'CREDITO', 'FINANCIAMENTO', 'INVESTIMENTO', 'DO', 'DA', 'DE'];
    const nomeNorm = String(banco.nome || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(p => p.length > 1 && !IGN.includes(p));
    // Nome: todas as palavras do banco aparecem e sobra o mínimo de palavras
    // ("Banco do Brasil" não pode casar com "BCO SANTANDER (BRASIL)").
    const tokens = (x) => String(x || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(p => p.length > 1 && !IGN.includes(p));
    let achado = linhas.find(l => cnpj8 && l.cnpj8 === cnpj8);
    if (!achado && nomeNorm.length) {
      const cand = linhas.map(l => ({ l, t: tokens(l.InstituicaoFinanceira) }))
        .filter(c => nomeNorm.every(p => c.t.includes(p)))
        .sort((x, y) => x.t.length - y.t.length);
      achado = cand.length ? cand[0].l : null;
    }
    const taxas = linhas.map(l => Number(l.TaxaJurosAoMes)).filter(Number.isFinite).sort((x, y) => x - y);
    return {
      modalidade, segmento, semana: `${semana} a ${linhas[0].FimPeriodo}`, total_instituicoes: linhas.length,
      menor_am: taxas[0], maior_am: taxas[taxas.length - 1], mediana_am: taxas[Math.floor(taxas.length / 2)],
      banco: achado ? { nome: achado.InstituicaoFinanceira, posicao: achado.Posicao, taxa_am: achado.TaxaJurosAoMes, taxa_aa: achado.TaxaJurosAoAno } : null
    };
  } catch (e) {
    return null;
  }
}

/**
 * Busca a taxa média do mês da contratação.
 *   { tipoOperacao, pfpj, subtipo, dataContratacao: 'AAAA-MM-DD', banco: {nome, cnpj} }
 * → { ok, origem:'bacen_sgs', serie_am, serie_aa, nome_serie, mes_referencia,
 *     mes_contratacao, recuou_meses, valor_am, valor_aa, data_consulta, olinda }
 */
async function buscarTaxaMedia({ tipoOperacao, pfpj = 'PF', subtipo = null, dataContratacao, banco = {} } = {}) {
  const m = String(dataContratacao || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return { ok: false, erro: 'Data da contratação não informada — necessária para escolher o mês da taxa média.' };
  const serie = serieParaOperacao(tipoOperacao, pfpj, subtipo);
  let a = Number(m[1]), mes = Number(m[2]);
  try {
    for (let recuo = 0; recuo <= 6; recuo++) {
      const vAm = await valorSgsNoMes(serie.am, a, mes);
      if (vAm != null) {
        let vAa = null;
        try { vAa = serie.aa ? await valorSgsNoMes(serie.aa, a, mes) : null; } catch (_) { vAa = null; }
        const anoMes = `${a}-${pad(mes)}`;
        return {
          ok: true, origem: 'bacen_sgs',
          tipo_operacao: tipoOperacao, segmento: serie.segmento, chave_serie: serie.chave,
          serie_am: serie.am, serie_aa: serie.aa, nome_serie: serie.nome, series_validadas_em: VALIDADO_EM,
          mes_contratacao: `${m[1]}-${m[2]}`, mes_referencia: anoMes, recuou_meses: recuo,
          valor_am: vAm, valor_aa: vAa ?? (Math.pow(1 + vAm / 100, 12) - 1) * 100, valor_aa_origem: vAa != null ? 'serie' : 'composto',
          data_consulta: new Date().toISOString(),
          olinda: await posicaoBancoOlinda(serie.olinda, `${m[1]}-${m[2]}`, banco, serie.segmento)
        };
      }
      mes -= 1; if (mes === 0) { mes = 12; a -= 1; }
    }
    return { ok: false, erro: `Sem taxa média na série ${serie.am} para o mês da contratação nem nos 6 anteriores.` };
  } catch (e) {
    return { ok: false, erro: `Banco Central indisponível (${e.code || e.response?.status || e.message}). Informe a taxa média manualmente.` };
  }
}

// Taxa informada pelo operador quando o BACEN falha — o laudo mostra a origem "manual".
function taxaManual({ valorAm, mesReferencia, fonte, usuario }) {
  const v = Number(valorAm);
  return {
    ok: Number.isFinite(v) && v > 0, origem: 'manual', valor_am: v, valor_aa: (Math.pow(1 + v / 100, 12) - 1) * 100,
    valor_aa_origem: 'composto', mes_referencia: mesReferencia || null, fonte_manual: fonte || null,
    informado_por: usuario || null, data_consulta: new Date().toISOString()
  };
}

// Cache por pedido em dados_consulta (fonte = 'bacen_taxa_media'): mesma série e
// mesmo mês de contratação não vão ao BACEN de novo.
async function obterComCache(pedidoId, params) {
  const { pool } = require('../db');
  const { serieParaOperacao } = require('./bacen_series');
  const s = serieParaOperacao(params.tipoOperacao, params.pfpj, params.subtipo);
  const mes = String(params.dataContratacao || '').slice(0, 7);
  const c = await pool.query(
    `SELECT dados FROM dados_consulta WHERE pedido_id = $1 AND fonte = 'bacen_taxa_media'
       AND dados->>'serie_am' = $2 AND dados->>'mes_contratacao' = $3 ORDER BY coletado_em DESC LIMIT 1`,
    [pedidoId, String(s.am), mes]
  );
  if (c.rows.length) return { ...c.rows[0].dados, cache: true };
  const r = await buscarTaxaMedia(params);
  if (r.ok) await pool.query("INSERT INTO dados_consulta (pedido_id, fonte, dados) VALUES ($1, 'bacen_taxa_media', $2)", [pedidoId, JSON.stringify(r)]);
  return r;
}

module.exports = { buscarTaxaMedia, obterComCache, taxaManual, valorSgsNoMes, posicaoBancoOlinda };
