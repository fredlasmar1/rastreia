/**
 * RASTREIA — Motor de cálculo da Revisão de Contrato Bancário.
 *
 * Funções PURAS: sem IA, sem banco, sem rede. Recebem `dados_conferidos`
 * (nunca `dados_extraidos`) e devolvem números em precisão total — o
 * arredondamento é só na apresentação (PDF/tela). Toda saída do laudo vem
 * daqui; a IA apenas lê o contrato e explica o resultado.
 *
 * Notação: PV = valor financiado total (principal sobre o qual correm juros),
 * PMT = parcela, n = prazo em meses, i = taxa mensal (fração: 0.02 = 2%).
 * Testes: scripts/test-revisao-bancaria.js (node).
 */
const VERSAO_CALCULO = 'rb-calc-1.7.0 (2026-10-23)';

const EPS = 1e-12;

// ── Conversões (juros compostos) ──────────────────────────────────────────
// a.m. → a.a.: (1 + i_m)^12 − 1
const mensalParaAnual = (im) => Math.pow(1 + im, 12) - 1;
// a.a. → a.m.: (1 + i_a)^(1/12) − 1
const anualParaMensal = (ia) => Math.pow(1 + ia, 1 / 12) - 1;

// ── Price ─────────────────────────────────────────────────────────────────
// Parcela fixa: PMT = PV · i / (1 − (1 + i)^−n)   (i = 0 ⇒ PV / n)
function parcelaPrice(PV, i, n) {
  if (Math.abs(i) < EPS) return PV / n;
  return PV * i / (1 - Math.pow(1 + i, -n));
}

// Taxa implícita da Price (= TAXA/RATE do Excel): resolve
//   f(i) = PV − PMT · (1 − (1 + i)^−n) / i = 0
// por Newton-Raphson, com derivada analítica
//   f'(i) = −PMT · [ n·(1+i)^(−n−1) / i − (1 − (1+i)^−n) / i² ]
// Retorna null se não há solução positiva (ex.: PMT·n ≤ PV).
function taxaImplicitaPrice(PV, PMT, n) {
  if (!(PV > 0 && PMT > 0 && n > 0)) return null;
  if (PMT * n <= PV + EPS) return PMT * n === PV ? 0 : null;
  let i = (PMT * n / PV - 1) / n * 2 || 0.01;   // chute inicial razoável
  if (i <= 0) i = 0.01;
  for (let k = 0; k < 200; k++) {
    const a = Math.pow(1 + i, -n);
    const f = PV - PMT * (1 - a) / i;
    const df = -PMT * (n * Math.pow(1 + i, -n - 1) / i - (1 - a) / (i * i));
    const passo = f / df;
    let novo = i - passo;
    if (!(novo > 0)) novo = i / 2;               // mantém no domínio positivo
    if (Math.abs(novo - i) < 1e-14) return novo;
    i = novo;
  }
  return i;
}

// Taxa interna de retorno mensal de um fluxo: recebe `recebido` em t=0 e paga
// parcelas[t-1] em t=1..n. Bissecção (robusta para qualquer fluxo de parcelas).
function taxaInternaRetorno(recebido, parcelas) {
  if (!(recebido > 0) || !parcelas.length) return null;
  const vp = (i) => parcelas.reduce((s, p, t) => s + p / Math.pow(1 + i, t + 1), 0);
  if (vp(0) <= recebido) return null;                       // paga menos do que recebeu
  let lo = 0, hi = 1;
  while (vp(hi) > recebido && hi < 64) hi *= 2;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (vp(mid) > recebido) lo = mid; else hi = mid;
    if (hi - lo < 1e-14) break;
  }
  return (lo + hi) / 2;
}

// SAC: 1ª parcela = PV/n + PV·i  ⇒  i = (PMT₁ − PV/n) / PV
function taxaImplicitaSAC(PV, PMT1, n) {
  if (!(PV > 0 && PMT1 > 0 && n > 0)) return null;
  const i = (PMT1 - PV / n) / PV;
  return i >= 0 ? i : null;
}

// ── Tabelas de amortização ────────────────────────────────────────────────
// Cada linha: { parcela_n, parcela, juros, amortizacao, saldo }
function tabelaPrice(PV, i, n) {
  const pmt = parcelaPrice(PV, i, n);
  const linhas = [];
  let saldo = PV;
  for (let t = 1; t <= n; t++) {
    const juros = saldo * i;                     // juros do período sobre o saldo
    const amortizacao = pmt - juros;
    saldo = saldo - amortizacao;
    linhas.push({ parcela_n: t, parcela: pmt, juros, amortizacao, saldo: Math.abs(saldo) < 1e-7 ? 0 : saldo });
  }
  return linhas;
}
function tabelaSAC(PV, i, n) {
  const amort = PV / n;                          // amortização constante
  const linhas = [];
  let saldo = PV;
  for (let t = 1; t <= n; t++) {
    const juros = saldo * i;
    saldo = saldo - amort;
    linhas.push({ parcela_n: t, parcela: amort + juros, juros, amortizacao: amort, saldo: Math.abs(saldo) < 1e-7 ? 0 : saldo });
  }
  return linhas;
}
const tabela = (sistema, PV, i, n) => (sistema === 'sac' ? tabelaSAC(PV, i, n) : tabelaPrice(PV, i, n));

// ── Comparação contratado × revisado ──────────────────────────────────────
// k = parcelas já pagas. "Pago a mais" = Σ(contratada − revisada) nas k pagas
// + valores questionáveis pagos à vista (não financiados). "Economia futura" =
// Σ nas parcelas restantes. Repetição em dobro é só referência (CDC art. 42).
function comparar(tabContr, tabRev, k, extrasPagosAVista = 0) {
  const n = tabContr.length;
  const kk = Math.max(0, Math.min(k || 0, n));
  let pagoAMais = extrasPagosAVista, futura = 0;
  for (let t = 0; t < n; t++) {
    const d = tabContr[t].parcela - tabRev[t].parcela;
    if (t < kk) pagoAMais += d; else futura += d;
  }
  const saldoContr = kk === 0 ? (tabContr[0].saldo + tabContr[0].amortizacao) : tabContr[kk - 1].saldo;
  const saldoRev = kk === 0 ? (tabRev[0].saldo + tabRev[0].amortizacao) : tabRev[kk - 1].saldo;
  return {
    parcela_contratada: tabContr[Math.min(kk, n - 1)].parcela,
    parcela_revisada: tabRev[Math.min(kk, n - 1)].parcela,
    diferenca_por_parcela: tabContr[Math.min(kk, n - 1)].parcela - tabRev[Math.min(kk, n - 1)].parcela,
    total_pago_a_mais: pagoAMais,
    saldo_devedor_contratual: saldoContr,
    saldo_devedor_revisado: saldoRev,
    economia_futura: futura,
    economia_total: pagoAMais + futura,
    repeticao_simples: pagoAMais,
    repeticao_dobro: 2 * pagoAMais
  };
}

// ── Itens questionáveis (tarifas/seguros) ─────────────────────────────────
// `questionaveis`: lista de { origem: 'tarifa'|'seguro', indice } marcada pelo
// checklist de teses. Financiados saem do principal (e o IOF financiado cai na
// mesma proporção, pois incidiu sobre eles); pagos à vista viram restituição.
function separarQuestionaveis(dados, questionaveis = []) {
  let financiado = 0, aVista = 0;
  const itens = [];
  for (const q of questionaveis) {
    const lista = q.origem === 'seguro' ? (dados.seguros || []) : (dados.tarifas || []);
    const it = lista[q.indice];
    if (!it) continue;
    const valor = Number(it.valor) || 0;
    if (valor <= 0) continue;
    const fin = q.origem === 'seguro' ? !!it.financiado : !!it.financiada;
    if (fin) financiado += valor; else aVista += valor;
    itens.push({ origem: q.origem, nome: it.nome || it.tipo || q.origem, valor, financiado: fin });
  }
  return { financiado, aVista, itens };
}

/**
 * calcular(dados, opts)
 *   dados  = dados_conferidos { operacao, tarifas, seguros, iof, situacao, parcelas_pagas }
 *   opts   = { taxaMediaBacenAM (% a.m., ex 1.85), questionaveis: [...],
 *              limiares: { razaoForte, razaoModerada, economiaFortePct, economiaModeradaPct, prescricaoAnos },
 *              hoje: Date }
 */
// Soma mês a mês + 'AAAA-MM' (sem fuso: data pura vira o mês dela)
function somarMeses(anoMes, n) {
  let [a, m] = anoMes.split('-').map(Number);
  m += n; a += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${a}-${String(m).padStart(2, '0')}`;
}
// Fator do IPCA de um mês até o último mês disponível (exclusive o mês do
// pagamento: a correção começa no mês seguinte, como nas tabelas dos tribunais)
function fatorIPCA(ipca, desdeMes, ateMes) {
  let f = 1, mes = somarMeses(desdeMes, 1);
  while (mes <= ateMes) { const v = ipca[mes]; if (v != null) f *= 1 + Number(v) / 100; mes = somarMeses(mes, 1); }
  return f;
}
function corrigirIndebito({ tabContr, tabRev, k, extrasAVista, primeiroVenc, dataContr, ipca }) {
  const meses = Object.keys(ipca || {}).sort();
  if (!meses.length || !(k > 0 || extrasAVista > 0)) return null;
  const ate = meses[meses.length - 1];
  const base = /^\d{4}-\d{2}/.test(String(primeiroVenc || '')) ? String(primeiroVenc).slice(0, 7)
    : (/^\d{4}-\d{2}/.test(String(dataContr || '')) ? somarMeses(String(dataContr).slice(0, 7), 1) : null);
  if (!base) return null;
  let nominal = 0, corrigido = 0;
  const linhas = [];
  for (let t = 0; t < Math.min(k, tabContr.length); t++) {
    const d = tabContr[t].parcela - tabRev[t].parcela;
    const mes = somarMeses(base, t);
    if (mes > ate) break;
    const f = fatorIPCA(ipca, mes, ate);
    nominal += d; corrigido += d * f;
    linhas.push({ parcela_n: t + 1, mes, diferenca: d, fator: f, corrigido: d * f });
  }
  if (extrasAVista > 0 && dataContr) {
    const mes = String(dataContr).slice(0, 7);
    const f = fatorIPCA(ipca, mes, ate);
    nominal += extrasAVista; corrigido += extrasAVista * f;
    linhas.unshift({ parcela_n: 0, mes, diferenca: extrasAVista, fator: f, corrigido: extrasAVista * f, descricao: 'tarifas/seguros pagos à parte' });
  }
  return {
    indice: 'IPCA (BCB/SGS 433)', ate_mes: ate, nominal, corrigido, correcao: corrigido - nominal,
    repeticao_simples_corrigida: corrigido, repeticao_dobro_corrigida: 2 * corrigido,
    sem_juros_de_mora: true, linhas
  };
}

function calcular(dados = {}, opts = {}) {
  const op = dados.operacao || {};
  const L = { razaoForte: 1.5, razaoModerada: 1.2, economiaFortePct: 15, economiaModeradaPct: 5, prescricaoAnos: 10, ...(opts.limiares || {}) };
  const alertas = [];
  const PV = Number(op.valor_financiado_total) || Number(op.valor_liberado) || 0;
  const PMT = Number(op.valor_parcela) || 0;
  const n = Math.round(Number(op.prazo_meses) || 0);
  const sistema = op.sistema_amortizacao === 'sac' ? 'sac' : 'price';
  const k = Math.max(0, Math.round(Number(dados.parcelas_pagas ?? op.parcelas_pagas) || 0));
  const declAM = op.taxa_juros_mensal_declarada != null ? Number(op.taxa_juros_mensal_declarada) / 100 : null;
  const declAA = op.taxa_juros_anual_declarada != null ? Number(op.taxa_juros_anual_declarada) / 100 : null;
  const cetAM = op.cet_mensal != null ? Number(op.cet_mensal) / 100 : null;

  // Modalidades em que parcela fixa não descreve bem a dívida
  const SIMPLIFICADO = {
    cartao_credito: 'Cartão de crédito: o rotativo muda de saldo e taxa todo mês — o cálculo trata como parcela fixa e é uma aproximação; confira com as faturas.',
    cheque_especial: 'Cheque especial: os juros incidem sobre o saldo diário — o cálculo por parcela fixa é uma aproximação; confira com os extratos.',
    financiamento_imobiliario: 'Financiamento imobiliário: correção pela TR e seguros MIP/DFI não entram neste cálculo — use como estimativa e confira com a planilha do banco.',
    conta_garantida: 'Conta garantida: crédito rotativo, com juros sobre o saldo utilizado — o cálculo por parcela fixa é uma aproximação; confira com os extratos.',
    desconto_recebiveis: 'Desconto de títulos: cada título é uma operação de pagamento único — o cálculo por parcela fixa é uma aproximação; confira com os borderôs.',
    cambio: 'Adiantamento de câmbio: pagamento único em moeda estrangeira — o cálculo por parcela fixa é só referência.',
    vendor: 'Vendor: operação de prazo curto e pagamento único — o cálculo por parcela fixa é só referência.',
    compror: 'Compror: operação de prazo curto e pagamento único — o cálculo por parcela fixa é só referência.'
  };
  if (SIMPLIFICADO[dados.tipo_operacao]) alertas.push(`Cálculo simplificado. ${SIMPLIFICADO[dados.tipo_operacao]}`);
  const faltando = [];
  if (!(PV > 0)) faltando.push('valor financiado');
  if (!(n > 0)) faltando.push('prazo');
  if (!(PMT > 0) && declAM == null) faltando.push('parcela ou taxa');

  // 1) Taxa real implícita
  let implAM = null;
  if (PV > 0 && PMT > 0 && n > 0) implAM = sistema === 'sac' ? taxaImplicitaSAC(PV, PMT, n) : taxaImplicitaPrice(PV, PMT, n);
  const efetivaAM = implAM ?? declAM;           // taxa usada como "contratada"
  const difPP = implAM != null && declAM != null ? (implAM - declAM) * 100 : null;  // pontos percentuais a.m.
  const taxaMaiorQueDeclarada = difPP != null && difPP > 0.05;
  if (taxaMaiorQueDeclarada) alertas.push(`Taxa efetiva (${(implAM * 100).toFixed(4)}% a.m.) maior que a declarada (${(declAM * 100).toFixed(4)}% a.m.).`);

  // 2) Capitalização: anual > 12 × mensal ⇒ pactuação expressa (Súmula 541)
  const duodecuplo = declAM != null && declAA != null ? declAA > 12 * declAM + 1e-9 : null;

  const resultado = {
    versao_calculo: VERSAO_CALCULO,
    entradas: { valor_financiado: PV, parcela: PMT, prazo_meses: n, sistema, parcelas_pagas: k },
    taxa: {
      implicita_am: implAM, implicita_aa: implAM != null ? mensalParaAnual(implAM) : null,
      declarada_am: declAM, declarada_aa: declAA, cet_am: cetAM,
      efetiva_am: efetivaAM, efetiva_aa: efetivaAM != null ? mensalParaAnual(efetivaAM) : null,
      diferenca_pp_am: difPP, taxa_efetiva_maior_que_declarada: taxaMaiorQueDeclarada,
      capitalizacao_por_duodecuplo: duodecuplo
    },
    bacen: null, razao: null, tabela_contratada: [], cenarios: {}, alertas, faltando
  };

  // Teto legal (cheque especial, cartão, Pronampe) ou linha regulada: o
  // parâmetro passa a ser a norma, não a média de mercado (services/revisao_tetos.js)
  const teto = require('./revisao_tetos').tetoLegal(dados, { efetivaAM, declAM, declAA, PV, PMT, n }, { selicAA: opts.selicAA });
  resultado.teto = teto;
  if (teto && teto.excedido) alertas.unshift(`${teto.nome}: ${teto.detalhe}`);
  else if (teto && teto.regulada && teto.excedido == null) alertas.unshift(teto.detalhe);

  // Pós-fixado (Selic/CDI/IPCA/TR + spread, ex.: Pronampe): a parcela do contrato é só
  // amortização de capital e os encargos seguem o índice — a "taxa implícita" da Price
  // não existe. O parâmetro é o spread contra o teto (revisao_tetos) e a planilha do banco.
  if (['selic', 'cdi', 'ipca', 'tr'].includes(op.indexador)) {
    const sp = op.spread_anual != null ? `${String(op.spread_anual).replace('.', ',')}% a.a.` : 'spread não informado';
    resultado.pos_fixado = { indexador: op.indexador, spread_anual: op.spread_anual ?? null };
    resultado.taxa.implicita_am = null; resultado.taxa.implicita_aa = null;
    resultado.faltando = [];
    resultado.economia_estimada = 0;
    const base = `Contrato pós-fixado (${op.indexador.toUpperCase()} + ${sp}): os juros seguem o índice, sem taxa fixa para comparar com a média de mercado.`;
    if (teto && teto.excedido) resultado.veredito = { nivel: 'forte', motivo: `${teto.nome}: ${teto.detalhe}` };
    else resultado.veredito = { nivel: 'fraca', motivo: `${base}${teto && teto.excedido === false ? ` ${teto.detalhe}` : ''} O resultado vem das demais verificações (tarifas, encargos, garantias, programa).` };
    return resultado;
  }

  if (faltando.length || efetivaAM == null) {
    // Faltar dado não é contrato ruim: é análise que ainda não pode ser feita
    resultado.veredito = { nivel: 'incompleto', motivo: `Faltam dados para calcular: ${faltando.join(', ') || 'taxa'}.` };
    // ...mas taxa acima do teto da lei já basta (ex.: cheque especial a 12% a.m. sem saldo nem prazo)
    if (teto && teto.excedido) resultado.veredito = { nivel: 'forte', motivo: `${teto.nome}: ${teto.detalhe} Faltam dados para calcular o valor: ${faltando.join(', ') || 'taxa'}.` };
    resultado.economia_estimada = 0;
    return resultado;
  }

  // 3) Tabela contratada (com a parcela informada na Price, a tabela usa a taxa implícita)
  const tabContr = tabela(sistema, PV, efetivaAM, n);
  resultado.tabela_contratada = tabContr;

  // CET real (Res. CMN 4.881/2020; antes de 01/02/2021, Res. 3.517/2007): taxa interna de retorno entre o que o
  // cliente EFETIVAMENTE recebeu (valor liberado − tarifas, seguros e IOF pagos
  // à parte) e as parcelas. Comparado com o CET declarado no contrato.
  const liberado = Number(op.valor_liberado) || 0;
  if (liberado > 0) {
    const aVista = [...(dados.tarifas || []).filter(t => !t.financiada), ...(dados.seguros || []).filter(x => !x.financiado)]
      .reduce((s, it) => s + (Number(it.valor) || 0), 0) + ((dados.iof && !dados.iof.financiado) ? Number(dados.iof.valor) || 0 : 0);
    const recebido = liberado - aVista;
    const cetAm = taxaInternaRetorno(recebido, tabContr.map(l => l.parcela));
    const declAmCet = cetAM != null ? cetAM : (op.cet_anual != null ? anualParaMensal(Number(op.cet_anual) / 100) : null);
    const difCet = cetAm != null && declAmCet != null ? (cetAm - declAmCet) * 100 : null;
    resultado.cet = {
      recebido_liquido: recebido, pagos_a_parte: aVista,
      real_am: cetAm, real_aa: cetAm != null ? mensalParaAnual(cetAm) : null,
      declarado_am: declAmCet, declarado_aa: declAmCet != null ? mensalParaAnual(declAmCet) : null,
      declarado_origem: cetAM != null ? 'mensal' : (op.cet_anual != null ? 'anual' : null),
      diferenca_pp_am: difCet,
      real_maior_que_declarado: difCet != null && difCet > 0.05
    };
    if (resultado.cet.real_maior_que_declarado) alertas.push(`CET real (${(cetAm * 100).toFixed(4)}% a.m.) maior que o CET informado no contrato (${(declAmCet * 100).toFixed(4)}% a.m.).`);
  } else {
    resultado.cet = null;
  }

  // 4) Cenários. Linha regulada: a média de mercado fica só de referência
  // (resultado.bacen.ignorada) — não entra na razão, no cenário nem no veredito.
  const mediaAM = opts.taxaMediaBacenAM != null ? Number(opts.taxaMediaBacenAM) / 100 : null;
  const bacenAM = teto && teto.regulada ? null : mediaAM;
  if (mediaAM != null) resultado.bacen = { am: mediaAM, aa: mensalParaAnual(mediaAM), ...(bacenAM == null ? { ignorada: true } : {}) };
  if (bacenAM != null) resultado.razao = efetivaAM / bacenAM;
  // Taxa revisada: a menor entre a média (linha livre) e o teto legal estourado
  const tetoAM = teto && teto.excedido && teto.teto_am != null && teto.teto_am < efetivaAM ? teto.teto_am : null;
  const revAM = [bacenAM != null && bacenAM < efetivaAM ? bacenAM : null, tetoAM].filter(x => x != null).reduce((a, b) => Math.min(a, b), Infinity);
  const nomeA = revAM === tetoAM ? 'Juros pelo teto legal' : 'Juros pela taxa média do BACEN';
  const q = separarQuestionaveis(dados, opts.questionaveis || []);
  // IOF financiado cai na proporção do principal retirado (incidiu também sobre os itens)
  const iof = dados.iof || {};
  const iofFin = iof.financiado ? Number(iof.valor) || 0 : 0;
  const baseSemIof = PV - iofFin;
  const iofSobreItens = iofFin > 0 && baseSemIof > 0 ? iofFin * (q.financiado / baseSemIof) : 0;
  const PVsemItens = PV - q.financiado - iofSobreItens;

  const cen = {};
  if (Number.isFinite(revAM)) {
    const t = tabela(sistema, PV, revAM, n);
    cen.A = { nome: nomeA, taxa_am: revAM, principal: PV, ...comparar(tabContr, t, k), tabela: t };
  }
  if (q.itens.length) {
    const t = tabela(sistema, PVsemItens, efetivaAM, n);
    cen.B = { nome: 'Sem tarifas e seguros questionáveis', taxa_am: efetivaAM, principal: PVsemItens, itens_excluidos: q.itens, iof_excluido: iofSobreItens, ...comparar(tabContr, t, k, q.aVista), tabela: t };
  }
  if (cen.A && cen.B) {
    const t = tabela(sistema, PVsemItens, revAM, n);
    cen.C = { nome: `Combinado: ${revAM === tetoAM ? 'teto legal' : 'taxa BACEN'} + sem tarifas/seguros`, taxa_am: revAM, principal: PVsemItens, ...comparar(tabContr, t, k, q.aVista), tabela: t };
  }
  resultado.cenarios = cen;
  // Honestidade: os juros só entram no cenário PRINCIPAL quando a tese se
  // sustenta — teto legal estourado ou taxa ≥ razaoForte (1,5×) a média, o
  // patamar que o STJ costuma exigir. Abaixo disso, A/C viram "cenário
  // otimista" (aparece como "até R$ X se o juiz limitar os juros à média"),
  // e a economia prometida fica só no que tem base (tarifas e seguros, B).
  const jurosSustentam = tetoAM != null || (resultado.razao != null && resultado.razao >= L.razaoForte);
  resultado.juros_revisaveis = jurosSustentam;
  const chave = jurosSustentam ? (cen.C ? 'C' : cen.A ? 'A' : cen.B ? 'B' : null) : (cen.B ? 'B' : null);
  const chaveOtimista = !jurosSustentam && resultado.razao != null && resultado.razao >= L.razaoModerada ? (cen.C ? 'C' : cen.A ? 'A' : null) : null;
  const melhor = chave ? cen[chave] : null;
  const economia = melhor ? Math.max(0, melhor.economia_total) : 0;
  resultado.economia_estimada = economia;
  resultado.cenario_principal = chave;
  resultado.cenario_otimista = chaveOtimista;
  resultado.economia_otimista = chaveOtimista ? Math.max(0, cen[chaveOtimista].economia_total) : null;
  // Pago a mais CORRIGIDO (estimativa): cada diferença paga é corrigida pelo
  // IPCA desde o mês do pagamento (Súmulas 43 e 162 STJ por analogia; CC art. 389, par. único,
  // Lei 14.905/2024). Juros de mora ficam de fora — na repetição correm da
  // citação (CC art. 405). Parcela t vence no 1º vencimento + (t−1) meses e é
  // tida como paga no vencimento. opts.ipcaMensal = { 'AAAA-MM': % do mês }.
  resultado.indebito_corrigido = melhor && opts.ipcaMensal ? corrigirIndebito({
    tabContr, tabRev: melhor.tabela, k, extrasAVista: resultado.cenario_principal === 'A' ? 0 : q.aVista,
    primeiroVenc: op.data_primeiro_vencimento, dataContr: op.data_contratacao, ipca: opts.ipcaMensal
  }) : null;

  // Valor incontroverso (CPC art. 330, §§ 2º e 3º): na revisional o autor diz
  // quanto reconhece dever e segue pagando — é a parcela do cenário revisado.
  resultado.valor_incontroverso = melhor ? {
    cenario: resultado.cenario_principal,
    parcela_mensal: melhor.parcela_revisada,
    parcela_contratada: melhor.parcela_contratada,
    diferenca_mensal: melhor.diferenca_por_parcela,
    saldo_devedor_revisado: melhor.saldo_devedor_revisado,
    parcelas_restantes: Math.max(0, n - k)
  } : null;

  // 6) Veredito
  const pct = PV > 0 ? economia / PV * 100 : 0;
  const r = resultado.razao;
  // prescrição: contrato quitado há mais tempo que o prazo configurado
  let prescrito = false;
  if (dados.situacao === 'quitado' && op.data_contratacao) {
    const fim = new Date(op.data_contratacao); fim.setMonth(fim.getMonth() + n);
    const anos = ((opts.hoje || new Date()) - fim) / (365.25 * 24 * 3600 * 1000);
    prescrito = anos > L.prescricaoAnos;
  }
  let nivel, motivo;
  if (prescrito) { nivel = 'inviavel'; motivo = `Contrato quitado há mais de ${L.prescricaoAnos} anos (prazo prescricional configurado).`; }
  else if (teto && teto.excedido) { nivel = 'forte'; motivo = `${teto.nome}: ${teto.detalhe} Economia estimada: ${pct.toFixed(1)}% do valor financiado.`; }
  else if ((r != null && r >= L.razaoForte) || pct >= L.economiaFortePct) { nivel = 'forte'; }
  else if ((r != null && r >= L.razaoModerada) || pct >= L.economiaModeradaPct) { nivel = 'moderada'; }
  else { nivel = 'fraca'; }
  if (!motivo) motivo = teto && teto.regulada
    ? `Linha regulada: a taxa se compara com o teto da norma do programa, não com a média do BACEN. Economia estimada: ${pct.toFixed(1)}% do valor financiado.`
    : `Razão taxa contratada ÷ média BACEN: ${r != null ? r.toFixed(2) : 'sem BACEN'}; economia estimada: ${pct.toFixed(1)}% do valor financiado.`;
  resultado.veredito = { nivel, motivo, razao: r, economia_pct: pct };
  return resultado;
}

module.exports = {
  VERSAO_CALCULO, mensalParaAnual, anualParaMensal, parcelaPrice,
  taxaImplicitaPrice, taxaImplicitaSAC, taxaInternaRetorno, corrigirIndebito, fatorIPCA, somarMeses, tabelaPrice, tabelaSAC, comparar, separarQuestionaveis, calcular
};
