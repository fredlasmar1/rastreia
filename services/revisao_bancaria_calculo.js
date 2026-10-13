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
const VERSAO_CALCULO = 'rb-calc-1.1.0 (2026-10-13)';

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
    financiamento_imobiliario: 'Financiamento imobiliário: correção pela TR e seguros MIP/DFI não entram neste cálculo — use como estimativa e confira com a planilha do banco.'
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

  if (faltando.length || efetivaAM == null) {
    resultado.veredito = { nivel: 'inviavel', motivo: `Dados insuficientes para calcular: ${faltando.join(', ') || 'taxa'}.` };
    resultado.economia_estimada = 0;
    return resultado;
  }

  // 3) Tabela contratada (com a parcela informada na Price, a tabela usa a taxa implícita)
  const tabContr = tabela(sistema, PV, efetivaAM, n);
  resultado.tabela_contratada = tabContr;

  // 4) Cenários
  const bacenAM = opts.taxaMediaBacenAM != null ? Number(opts.taxaMediaBacenAM) / 100 : null;
  if (bacenAM != null) {
    resultado.bacen = { am: bacenAM, aa: mensalParaAnual(bacenAM) };
    resultado.razao = efetivaAM / bacenAM;
  }
  const q = separarQuestionaveis(dados, opts.questionaveis || []);
  // IOF financiado cai na proporção do principal retirado (incidiu também sobre os itens)
  const iof = dados.iof || {};
  const iofFin = iof.financiado ? Number(iof.valor) || 0 : 0;
  const baseSemIof = PV - iofFin;
  const iofSobreItens = iofFin > 0 && baseSemIof > 0 ? iofFin * (q.financiado / baseSemIof) : 0;
  const PVsemItens = PV - q.financiado - iofSobreItens;

  const cen = {};
  if (bacenAM != null && bacenAM < efetivaAM) {
    const t = tabela(sistema, PV, bacenAM, n);
    cen.A = { nome: 'Juros pela taxa média do BACEN', taxa_am: bacenAM, principal: PV, ...comparar(tabContr, t, k), tabela: t };
  }
  if (q.itens.length) {
    const t = tabela(sistema, PVsemItens, efetivaAM, n);
    cen.B = { nome: 'Sem tarifas e seguros questionáveis', taxa_am: efetivaAM, principal: PVsemItens, itens_excluidos: q.itens, iof_excluido: iofSobreItens, ...comparar(tabContr, t, k, q.aVista), tabela: t };
  }
  if (cen.A && cen.B) {
    const t = tabela(sistema, PVsemItens, bacenAM, n);
    cen.C = { nome: 'Combinado: taxa BACEN + sem tarifas/seguros', taxa_am: bacenAM, principal: PVsemItens, ...comparar(tabContr, t, k, q.aVista), tabela: t };
  }
  resultado.cenarios = cen;
  const melhor = cen.C || cen.A || cen.B || null;
  const economia = melhor ? Math.max(0, melhor.economia_total) : 0;
  resultado.economia_estimada = economia;
  resultado.cenario_principal = melhor ? (cen.C ? 'C' : cen.A ? 'A' : 'B') : null;
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
  else if ((r != null && r >= L.razaoForte) || pct >= L.economiaFortePct) { nivel = 'forte'; }
  else if ((r != null && r >= L.razaoModerada) || pct >= L.economiaModeradaPct) { nivel = 'moderada'; }
  else { nivel = 'fraca'; }
  if (!motivo) motivo = `Razão taxa contratada ÷ média BACEN: ${r != null ? r.toFixed(2) : 'sem BACEN'}; economia estimada: ${pct.toFixed(1)}% do valor financiado.`;
  resultado.veredito = { nivel, motivo, razao: r, economia_pct: pct };
  return resultado;
}

module.exports = {
  VERSAO_CALCULO, mensalParaAnual, anualParaMensal, parcelaPrice,
  taxaImplicitaPrice, taxaImplicitaSAC, tabelaPrice, tabelaSAC, comparar, separarQuestionaveis, calcular
};
