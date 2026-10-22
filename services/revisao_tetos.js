/**
 * RASTREIA — Tetos LEGAIS de juros na Revisão de Contrato Bancário.
 *
 * Algumas linhas têm limite fixado em lei ou resolução: aí o parâmetro é o
 * TETO, não a média de mercado do BACEN. Funções PURAS (sem rede): a Selic do
 * mês (Pronampe) chega pronta em `opts.selicAA`.
 *
 * Textos conferidos em 22/10/2026 no acervo de legislação do escritório
 * (skills normativos-bcb e credito-imobiliario-ccb; Lei 13.999 e Lei 14.690
 * compiladas do Planalto, em "Z - CLAUDE/Referências"):
 *   - Res. CMN 4.765/2019, art. 3º: cheque especial de pessoa natural e MEI,
 *     juros de no máximo 8% a.m. (em vigor desde 06/01/2020).
 *   - Lei 14.690/2023, art. 28, § 1º, e Res. CMN 4.549/2017, arts. 2º-A a 2º-D:
 *     no rotativo e no parcelamento da fatura do cartão, juros + encargos não
 *     passam do valor original da dívida (operações a partir de 03/01/2024;
 *     não vale para cartão consignado — art. 4º).
 *   - Lei 13.999/2020, art. 3º, I (red. Lei 14.161/2021): Pronampe, Selic +
 *     1,25% a.a. até 31/12/2020 e Selic + 6% a.a. a partir de 01/01/2021.
 * Linhas de programa com taxa fixada pelo CMN para cada período (FCO/FNE/FNO,
 * Fies, crédito rural controlado, SFH, MCMV) ficam REGULADAS sem teto
 * automático: a média de mercado não serve e o advogado confere a resolução.
 */
const VERSAO_TETOS = 'rb-tetos-1.0.0 (2026-10-22)';

const anualParaMensal = (ia) => Math.pow(1 + ia, 1 / 12) - 1;
const mensalParaAnual = (im) => Math.pow(1 + im, 12) - 1;
const pct = (x, d = 2) => `${(x * 100).toFixed(d).replace('.', ',')}%`;

const PROGRAMAS = {
  pronampe: 'Pronampe',
  fco: 'FCO (Fundo Constitucional do Centro-Oeste)',
  fne: 'FNE (Fundo Constitucional do Nordeste)',
  fno: 'FNO (Fundo Constitucional do Norte)',
  fies: 'Fies',
  rural: 'crédito rural',
  sfh: 'SFH (Sistema Financeiro da Habitação)',
  mcmv: 'Minha Casa, Minha Vida'
};

// Programa oficial: o que a IA classificou ou, na falta, o nome do produto
const RE_PROGRAMA = [
  ['pronampe', /pronampe/i],
  ['fco', /\bfco\b|fundo constitucional de financiamento do centro/i],
  ['fne', /\bfne\b|fundo constitucional de financiamento do nordeste/i],
  ['fno', /\bfno\b|fundo constitucional de financiamento do norte/i],
  ['fies', /\bfies\b|financiamento estudantil/i],
  ['rural', /c[eé]dula rural|cr[eé]dito rural|\bpronaf\b|\bpronamp\b/i],
  ['mcmv', /minha casa,? minha vida|\bmcmv\b/i],
  ['sfh', /\bsfh\b|sistema financeiro da habita[cç][aã]o/i]
];
function programaDoContrato(d = {}) {
  if (d.programa && PROGRAMAS[d.programa]) return d.programa;
  if ((d.campos_editados || []).includes('programa')) return null;   // operador escolheu "nenhum"
  const op = d.operacao || {};
  const txt = [op.tipo, op.clausula_capitalizacao_trecho].filter(Boolean).join(' ');
  for (const [k, re] of RE_PROGRAMA) if (re.test(txt)) return k;
  return null;
}

const FUND_CHEQUE = 'Res. CMN 4.765/2019, art. 3º: os juros do cheque especial de pessoa natural e de MEI estão limitados a 8% ao mês (em vigor desde 06/01/2020).';
const FUND_CARTAO = 'Lei 14.690/2023, art. 28, § 1º, e Res. CMN 4.549/2017, arts. 2º-A a 2º-D: no rotativo e no parcelamento da fatura do cartão, o total de juros e encargos não pode passar do valor original da dívida (operações a partir de 03/01/2024; não vale para cartão consignado).';
const FUND_PRONAMPE = 'Lei 13.999/2020, art. 3º, I (redação da Lei 14.161/2021): no Pronampe, a taxa anual máxima é a Selic acrescida de 6% (operações a partir de 01/01/2021) ou de 1,25% (até 31/12/2020).';
const FUND_REGULADA = (nome) => `Linha de ${nome}: os encargos são fixados pela lei do programa e por resolução do CMN para cada período — o parâmetro é o teto normativo da data da contratação, não a média de mercado do BACEN.`;

/**
 * tetoLegal(d, t, opts)
 *   d    = dados_conferidos
 *   t    = { efetivaAM, declAM, declAA, PV, PMT, n } (frações; do motor de cálculo)
 *   opts = { selicAA (% a.a. do mês da contratação, ex. 10.4) }
 * → null (linha sem teto) ou { id, nome, fundamento, regulada, teto_am, teto_aa,
 *   taxa_comparada_am, excedido (true|false|null), detalhe, ... }
 */
function tetoLegal(d = {}, t = {}, opts = {}) {
  const op = d.operacao || {};
  const data = String(op.data_contratacao || '');
  const programa = programaDoContrato(d);

  // Cheque especial PF/MEI — 8% a.m.
  if (d.tipo_operacao === 'cheque_especial' && (d.pfpj !== 'PJ' || d.mei === true)) {
    const teto = 0.08;
    const taxa = t.declAM ?? t.efetivaAM ?? null;
    const base = { id: 'cheque_especial_8', nome: 'Teto de 8% a.m. do cheque especial', fundamento: FUND_CHEQUE, regulada: false, teto_am: teto, teto_aa: mensalParaAnual(teto), taxa_comparada_am: taxa };
    const antes = data && data < '2020-01-06' ? ' O contrato é anterior a 06/01/2020: o teto vale para os juros cobrados desde essa data — confira nos extratos.' : '';
    if (taxa == null) return { ...base, excedido: null, detalhe: 'Sem a taxa do cheque especial: confira nos extratos se os juros passaram de 8% a.m.' + antes };
    if (taxa > teto + 1e-9) return { ...base, excedido: true, detalhe: `Juros de ${pct(taxa)} a.m., acima do teto legal de 8% a.m.: o que passou do teto é cobrança indevida.${antes}` };
    return { ...base, excedido: false, detalhe: `Juros de ${pct(taxa)} a.m., dentro do teto de 8% a.m.${antes}` };
  }

  // Cartão (rotativo e parcelamento da fatura) — juros + encargos ≤ valor original
  if (d.tipo_operacao === 'cartao_credito') {
    if (data && data < '2024-01-03') return null;   // operação anterior ao teto
    const base = { id: 'cartao_100', nome: 'Teto do cartão: juros e encargos até o valor original da dívida', fundamento: FUND_CARTAO, regulada: false, teto_am: null, teto_aa: null, taxa_comparada_am: t.efetivaAM ?? null };
    if (!data) return { ...base, excedido: null, detalhe: 'Sem a data da operação: o teto vale para operações a partir de 03/01/2024.' };
    if (!(t.PV > 0 && t.PMT > 0 && t.n > 0)) return { ...base, excedido: null, detalhe: 'Para conferir o teto, faltam o valor original da dívida, a parcela e o prazo (estão nas faturas).' };
    const encargos = t.PMT * t.n - t.PV;
    // Taxa (Price) em que os juros somam exatamente o valor original: parcela = 2·PV/n
    const tetoAM = require('./revisao_bancaria_calculo').taxaImplicitaPrice(t.PV, 2 * t.PV / t.n, t.n);
    const out = { ...base, teto_am: tetoAM, teto_aa: tetoAM != null ? mensalParaAnual(tetoAM) : null, valor_original: t.PV, juros_e_encargos: encargos, excesso: Math.max(0, encargos - t.PV) };
    if (encargos > t.PV + 0.005) return { ...out, excedido: true, detalhe: `Juros e encargos somam R$ ${encargos.toFixed(2).replace('.', ',')}, acima do valor original de R$ ${t.PV.toFixed(2).replace('.', ',')}: o excesso de R$ ${(encargos - t.PV).toFixed(2).replace('.', ',')} não pode ser cobrado.` };
    return { ...out, excedido: false, detalhe: `Juros e encargos (R$ ${encargos.toFixed(2).replace('.', ',')}) dentro do valor original (R$ ${t.PV.toFixed(2).replace('.', ',')}).` };
  }

  // Pronampe — Selic + 6% a.a. (ou + 1,25% até 2020)
  if (programa === 'pronampe') {
    const spreadMax = data && data < '2021-01-01' ? 1.25 : 6;
    const base = { id: 'pronampe', nome: `Teto do Pronampe: Selic + ${String(spreadMax).replace('.', ',')}% a.a.`, fundamento: FUND_PRONAMPE, regulada: true, programa, spread_maximo_aa: spreadMax, teto_am: null, teto_aa: null, taxa_comparada_am: t.efetivaAM ?? null };
    if (op.indexador === 'selic' && op.spread_anual != null) {
      const s = Number(op.spread_anual);
      if (s > spreadMax + 1e-9) return { ...base, excedido: true, detalhe: `O contrato cobra Selic + ${String(s).replace('.', ',')}% a.a., acima do máximo legal de Selic + ${String(spreadMax).replace('.', ',')}% a.a.` };
      return { ...base, excedido: false, detalhe: `Selic + ${String(s).replace('.', ',')}% a.a., dentro do máximo legal (Selic + ${String(spreadMax).replace('.', ',')}% a.a.).` };
    }
    const taxaAA = t.declAA ?? (t.efetivaAM != null ? mensalParaAnual(t.efetivaAM) : null);
    if (taxaAA == null) return { ...base, excedido: null, detalhe: 'Sem a taxa do contrato (ou o spread sobre a Selic): não dá para conferir o teto do Pronampe.' };
    if (opts.selicAA == null) return { ...base, excedido: null, detalhe: 'Selic do mês da contratação indisponível: confira o teto do Pronampe à mão.' };
    // Composto ((1+Selic)·(1+spread) − 1): o teto mais alto das duas leituras, para não acusar excesso a mais
    const tetoAA = (1 + opts.selicAA / 100) * (1 + spreadMax / 100) - 1;
    const out = { ...base, selic_aa: opts.selicAA / 100, teto_aa: tetoAA, teto_am: anualParaMensal(tetoAA) };
    const ref = `Selic do mês da contratação ${pct(opts.selicAA / 100)} a.a. + ${String(spreadMax).replace('.', ',')}% a.a. = teto de ${pct(tetoAA)} a.a.`;
    if (taxaAA > tetoAA + 1e-6) return { ...out, excedido: true, detalhe: `Taxa de ${pct(taxaAA)} a.a., acima do teto (${ref}). Se o contrato é pós-fixado, confira o spread sobre a Selic.` };
    return { ...out, excedido: false, detalhe: `Taxa de ${pct(taxaAA)} a.a., dentro do teto (${ref}).` };
  }

  // Outras linhas de programa: reguladas, sem teto automático
  if (programa) {
    return { id: 'programa_regulado', nome: `Linha regulada (${PROGRAMAS[programa]})`, fundamento: FUND_REGULADA(PROGRAMAS[programa]), regulada: true, programa, teto_am: null, teto_aa: null, taxa_comparada_am: t.efetivaAM ?? null, excedido: null,
      detalhe: `Linha de ${PROGRAMAS[programa]}: compare a taxa com a resolução do CMN vigente na contratação. A média de mercado do BACEN não serve de parâmetro e foi deixada de fora do veredito.` };
  }
  return null;
}

module.exports = { VERSAO_TETOS, PROGRAMAS, programaDoContrato, tetoLegal, FUND_CHEQUE, FUND_CARTAO, FUND_PRONAMPE };
