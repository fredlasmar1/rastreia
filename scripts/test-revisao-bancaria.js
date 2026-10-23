/**
 * Testes do motor de cálculo da Revisão de Contrato Bancário.
 * Rodar: node scripts/test-revisao-bancaria.js
 * Sem dependências: assert do Node. Sai com código 1 se algum falhar.
 */
const assert = require('assert');
const C = require('../services/revisao_bancaria_calculo');

let ok = 0, falhas = 0;
function teste(nome, fn) {
  try { fn(); ok++; console.log(`  ✔ ${nome}`); }
  catch (e) { falhas++; console.log(`  ✘ ${nome}\n      ${e.message}`); }
}
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

// Método independente para conferir o Newton-Raphson: bisseção na Price
function taxaBissecao(PV, PMT, n) {
  let lo = 1e-9, hi = 1;
  for (let k = 0; k < 300; k++) {
    const mid = (lo + hi) / 2;
    const pv = PMT * (1 - Math.pow(1 + mid, -n)) / mid;
    if (pv > PV) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

console.log(`Motor ${C.VERSAO_CALCULO}\n`);

console.log('1) Price conhecido — taxa implícita = TAXA do Excel');
teste('TAXA(12; -1000; 10000) = 2,92285% a.m.', () => {
  // Valor de referência do Excel/LibreOffice: =TAXA(12;-1000;10000) → 0,0292285
  perto(C.taxaImplicitaPrice(10000, 1000, 12), 0.0292285, 5e-7, 'taxa');
});
teste('Newton-Raphson bate com bisseção em 3 contratos', () => {
  for (const [PV, PMT, n] of [[45000, 1580, 48], [120000, 3150.77, 60], [8000, 412.5, 24]]) {
    perto(C.taxaImplicitaPrice(PV, PMT, n), taxaBissecao(PV, PMT, n), 1e-10, `PV=${PV}`);
  }
});
teste('Parcela Price recalculada reproduz a parcela informada', () => {
  const i = C.taxaImplicitaPrice(45000, 1580, 48);
  perto(C.parcelaPrice(45000, i, 48), 1580, 1e-6, 'pmt');
});
teste('Conversões compostas a.m. ↔ a.a.', () => {
  perto(C.mensalParaAnual(0.02), 0.268241794562545, 1e-12, '2% a.m.');
  perto(C.anualParaMensal(C.mensalParaAnual(0.0185)), 0.0185, 1e-12, 'ida e volta');
});
teste('Tabela Price zera o saldo na última parcela', () => {
  const t = C.tabelaPrice(10000, 0.0292285, 12);
  perto(t[11].saldo, 0, 0.01, 'saldo final');
});

console.log('\n2) SAC');
teste('Taxa implícita SAC pela 1ª parcela: PV 12000, n 12, 1ª = 1240 ⇒ 2% a.m.', () => {
  perto(C.taxaImplicitaSAC(12000, 1240, 12), 0.02, 1e-12, 'taxa');
});
teste('Tabela SAC: amortização constante, parcelas decrescentes, saldo zera', () => {
  const t = C.tabelaSAC(12000, 0.02, 12);
  assert.ok(t.every(l => Math.abs(l.amortizacao - 1000) < 1e-9));
  assert.ok(t[0].parcela > t[11].parcela);
  perto(t[11].saldo, 0, 1e-6, 'saldo final');
});
teste('Revisão SAC pela taxa BACEN gera economia positiva', () => {
  const r = C.calcular({ operacao: { valor_financiado_total: 12000, valor_parcela: 1240, prazo_meses: 12, sistema_amortizacao: 'sac' }, parcelas_pagas: 4 },
    { taxaMediaBacenAM: 1.2 });
  assert.strictEqual(r.entradas.sistema, 'sac');
  assert.ok(r.cenarios.A.economia_total > 0, 'economia');
  perto(r.razao, 0.02 / 0.012, 1e-9, 'razão');
});

console.log('\n3) Tarifas e seguro financiados');
const contratoTarifas = () => {
  const PV = 30000, i = 0.025, n = 36;
  return {
    PV, i, n,
    dados: {
      operacao: { valor_financiado_total: PV, valor_parcela: C.parcelaPrice(PV, i, n), prazo_meses: n, taxa_juros_mensal_declarada: 2.5, taxa_juros_anual_declarada: 34.49 },
      tarifas: [{ nome: 'Tarifa de cadastro', valor: 800, financiada: true }, { nome: 'Serviços de terceiros', valor: 700, financiada: true }],
      seguros: [{ tipo: 'prestamista', valor: 1000, financiado: true }],
      iof: { valor: 0, financiado: false },
      parcelas_pagas: 6
    }
  };
};
teste('Cenário B retira R$ 1.700 do principal e recalcula a parcela', () => {
  const { dados, i, n } = contratoTarifas();
  const r = C.calcular(dados, { questionaveis: [{ origem: 'tarifa', indice: 1 }, { origem: 'seguro', indice: 0 }] });
  perto(r.cenarios.B.principal, 30000 - 1700, 1e-9, 'principal');
  perto(r.cenarios.B.parcela_revisada, C.parcelaPrice(28300, i, n), 1e-9, 'parcela');
  // pago a mais nas 6 pagas = 6 × diferença de parcela (Price)
  perto(r.cenarios.B.total_pago_a_mais, 6 * (C.parcelaPrice(30000, i, n) - C.parcelaPrice(28300, i, n)), 1e-8, 'pago a mais');
  perto(r.cenarios.B.repeticao_dobro, 2 * r.cenarios.B.total_pago_a_mais, 1e-9, 'dobro');
});
teste('IOF financiado cai na proporção dos itens retirados', () => {
  const { dados } = contratoTarifas();
  dados.iof = { valor: 900, financiado: true };
  const r = C.calcular(dados, { questionaveis: [{ origem: 'seguro', indice: 0 }] });
  perto(r.cenarios.B.iof_excluido, 900 * 1000 / (30000 - 900), 1e-9, 'iof');
});
teste('Cenário C combina taxa BACEN + sem itens e economiza mais que A e B', () => {
  const { dados } = contratoTarifas();
  const r = C.calcular(dados, { taxaMediaBacenAM: 1.6, questionaveis: [{ origem: 'seguro', indice: 0 }] });
  assert.ok(r.cenarios.C.economia_total > r.cenarios.A.economia_total);
  assert.ok(r.cenarios.C.economia_total > r.cenarios.B.economia_total);
  assert.strictEqual(r.cenario_principal, 'C');
});
teste('Item questionável pago à vista vira restituição em "pago a mais"', () => {
  const { dados } = contratoTarifas();
  dados.tarifas[0].financiada = false;
  const r = C.calcular(dados, { questionaveis: [{ origem: 'tarifa', indice: 0 }] });
  perto(r.cenarios.B.total_pago_a_mais, 800, 1e-9, 'restituição');
});
teste('Duodécuplo: 34,49% a.a. > 12 × 2,5% ⇒ capitalização pactuada', () => {
  const { dados } = contratoTarifas();
  assert.strictEqual(C.calcular(dados, {}).taxa.capitalizacao_por_duodecuplo, true);
});

console.log('\n4) Sem taxa declarada');
teste('Calcula a taxa implícita e o veredito sem taxa no contrato', () => {
  const r = C.calcular({ operacao: { valor_financiado_total: 45000, valor_parcela: 1580, prazo_meses: 48 } }, { taxaMediaBacenAM: 1.7 });
  perto(r.taxa.implicita_am, taxaBissecao(45000, 1580, 48), 1e-10, 'taxa');
  assert.strictEqual(r.taxa.declarada_am, null);
  assert.strictEqual(r.taxa.taxa_efetiva_maior_que_declarada, false);
  assert.ok(['forte', 'moderada', 'fraca'].includes(r.veredito.nivel));
});
teste('Taxa efetiva > declarada em mais de 0,05 p.p. gera alerta', () => {
  const r = C.calcular({ operacao: { valor_financiado_total: 45000, valor_parcela: 1580, prazo_meses: 48, taxa_juros_mensal_declarada: 2.0 } }, {});
  assert.strictEqual(r.taxa.taxa_efetiva_maior_que_declarada, true);
  assert.ok(r.alertas.length > 0);
});
teste('Faltando parcela e taxa ⇒ incompleto (não inviável)', () => {
  const r = C.calcular({ operacao: { valor_financiado_total: 45000, prazo_meses: 48 } }, {});
  assert.strictEqual(r.veredito.nivel, 'incompleto');
});

console.log('\n5) Parcelas já pagas com atraso');
teste('Atrasado com 10 de 24 pagas: pago a mais = 10 diferenças, futura = 14', () => {
  const PV = 20000, n = 24, i = 0.035;
  const pmt = C.parcelaPrice(PV, i, n);
  const r = C.calcular({ operacao: { valor_financiado_total: PV, valor_parcela: pmt, prazo_meses: n }, situacao: 'atrasado', parcelas_pagas: 10 }, { taxaMediaBacenAM: 2.0 });
  const d = pmt - C.parcelaPrice(PV, 0.02, n);
  perto(r.cenarios.A.total_pago_a_mais, 10 * d, 1e-8, 'pago a mais');
  perto(r.cenarios.A.economia_futura, 14 * d, 1e-8, 'futura');
  assert.ok(r.cenarios.A.saldo_devedor_revisado < r.cenarios.A.saldo_devedor_contratual, 'saldo revisado menor');
  // 3,5 ÷ 2,0 = 1,75 ≥ 1,5 ⇒ forte
  assert.strictEqual(r.veredito.nivel, 'forte');
});

console.log('\n6) Veredito pelos limiares');
teste('Razão 1,3 e economia baixa ⇒ moderada; razão 1,1 ⇒ fraca', () => {
  const base = (bacen) => C.calcular({ operacao: { valor_financiado_total: 10000, valor_parcela: C.parcelaPrice(10000, 0.013, 12), prazo_meses: 12 } }, { taxaMediaBacenAM: bacen, limiares: { economiaModeradaPct: 50, economiaFortePct: 80 } });
  assert.strictEqual(base(1.0).veredito.nivel, 'moderada');
  assert.strictEqual(base(1.19).veredito.nivel, 'fraca');
});
teste('Quitado há mais tempo que a prescrição ⇒ inviável', () => {
  const r = C.calcular({ operacao: { valor_financiado_total: 10000, valor_parcela: 1000, prazo_meses: 12, data_contratacao: '2010-01-10' }, situacao: 'quitado' },
    { taxaMediaBacenAM: 1.0, hoje: new Date('2026-10-13') });
  assert.strictEqual(r.veredito.nivel, 'inviavel');
});

console.log('\n7) Teses + cálculo (contrato realista de veículo)');
const T = require('../services/revisao_bancaria_teses');
const contratoPan = () => ({
  pfpj: 'PF', tipo_operacao: 'financiamento_veiculo', situacao: 'busca_apreensao', parcelas_pagas: 14,
  instituicao: { nome: 'Banco Pan' },
  operacao: { data_contratacao: '2023-05-10', valor_financiado_total: 45000, valor_parcela: 1580, prazo_meses: 48, taxa_juros_mensal_declarada: 2.19, taxa_juros_anual_declarada: 29.68, capitalizacao_expressa: true },
  tarifas: [
    { nome: 'Tarifa de cadastro', valor: 800, financiada: true, trecho: 'Tarifa de cadastro R$ 800,00' },
    { nome: 'Serviços de terceiros', valor: 700, financiada: true, trecho: 'Serviços de terceiros R$ 700,00' },
    { nome: 'Tarifa de avaliação do bem', valor: 450, financiada: true }
  ],
  seguros: [{ tipo: 'prestamista', valor: 1200, financiado: true, havia_opcao_recusar: false, trecho: 'Seguro prestamista contratado com a seguradora parceira' }],
  iof: { valor: 1100, financiado: true },
  encargos_mora: { juros_mora: 1, multa_percentual: 2, comissao_permanencia: false }
});
teste('Itens questionáveis = serviços de terceiros + seguro (cadastro e avaliação ficam "verificar")', () => {
  const q = T.itensQuestionaveis(contratoPan());
  assert.deepStrictEqual(q.map(x => `${x.origem}:${x.indice}`).sort(), ['seguro:0', 'tarifa:1']);
});
teste('Fluxo completo: taxa implícita > declarada, teses e veredito coerentes', () => {
  const d = contratoPan();
  const calc = C.calcular(d, { taxaMediaBacenAM: 2.08, questionaveis: T.itensQuestionaveis(d) });
  const ts = T.aplicarTeses(d, calc);
  const res = Object.fromEntries(ts.teses.map(t => [t.id, t.resultado]));
  assert.strictEqual(res.capitalizacao, 'nao_aplicavel');           // pactuada expressamente
  assert.strictEqual(res.seguro_venda_casada, 'aplicavel');
  assert.strictEqual(res.avaliacao_registro_terceiros, 'aplicavel');
  assert.strictEqual(res.tac_tec, 'verificar');                     // só cadastro
  assert.strictEqual(res.taxa_maior_declarada, 'aplicavel');        // implícita > 2,19%
  assert.strictEqual(res.repeticao_dobro, 'verificar');
  assert.ok(calc.cenarios.B && calc.cenarios.C, 'cenários B e C');
  perto(calc.cenarios.B.principal, 45000 - 1900 - 1100 * 1900 / (45000 - 1100), 1e-9, 'principal B');
  assert.ok(['forte', 'moderada', 'fraca'].includes(calc.veredito.nivel));
  console.log(`      (razão ${calc.razao.toFixed(2)}, economia C R$ ${calc.economia_estimada.toFixed(2)}, veredito ${calc.veredito.nivel}, ${ts.aplicaveis} teses aplicáveis)`);
});
teste('Juros 1,6× a média + busca e apreensão ⇒ juros abusivos e mora descaracterizada aplicáveis', () => {
  const d = contratoPan();
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.5, questionaveis: [] });
  const res = Object.fromEntries(T.aplicarTeses(d, calc).teses.map(t => [t.id, t.resultado]));
  assert.ok(calc.razao >= 1.5);
  assert.strictEqual(res.juros_abusivos, 'aplicavel');
  assert.strictEqual(res.encargos_mora, 'aplicavel');
});
teste('TAC após 30/04/2008 é aplicável; antes, não', () => {
  const d = contratoPan(); d.tarifas = [{ nome: 'TAC - Tarifa de Abertura de Crédito', valor: 500, financiada: true }];
  assert.strictEqual(T.aplicarTeses(d, null).teses.find(t => t.id === 'tac_tec').resultado, 'aplicavel');
  d.operacao.data_contratacao = '2007-06-01';
  assert.strictEqual(T.aplicarTeses(d, null).teses.find(t => t.id === 'tac_tec').resultado, 'nao_aplicavel');
});

console.log('\n8) Análise rápida (leitura da IA → dados do cálculo)');
const AN = require('../services/revisao_analise');
teste('Parcelas pagas estimadas pelos meses desde o 1º vencimento', () => {
  const hoje = new Date(2026, 9, 13);   // 13/10/2026
  assert.strictEqual(AN.estimarPagas({ data_primeiro_vencimento: '2026-06-10', prazo_meses: 48 }, hoje), 5);   // jun..out
  assert.strictEqual(AN.estimarPagas({ data_primeiro_vencimento: '2026-06-20', prazo_meses: 48 }, hoje), 4);   // out ainda não venceu
  assert.strictEqual(AN.estimarPagas({ data_primeiro_vencimento: '2020-01-10', prazo_meses: 24 }, hoje), 24);  // limitado ao prazo
  assert.strictEqual(AN.estimarPagas({ prazo_meses: 24 }, hoje), null);
});
teste('montarDados usa a classificação da IA e marca as parcelas como estimadas', () => {
  const d = AN.montarDados({ classificacao: { tipo_operacao: 'consignado', subtipo: 'inss', pfpj: 'PF' }, instituicao: { nome: 'Banco X' }, operacao: { valor_financiado_total: 10000, valor_parcela: 400, prazo_meses: 36, data_primeiro_vencimento: '2025-01-05' }, tarifas: [{ nome: 'TAC', valor: 500 }] });
  assert.strictEqual(d.tipo_operacao, 'consignado'); assert.strictEqual(d.subtipo, 'inss'); assert.strictEqual(d.pfpj, 'PF');
  assert.ok(d.parcelas_pagas > 0 && d.parcelas_pagas_estimadas === true);
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.8, questionaveis: T.itensQuestionaveis(d) });
  assert.ok(calc.taxa.efetiva_am > 0 && calc.veredito.nivel);
});
teste('Sem classificação: CNPJ vira PJ e operação "outro"', () => {
  const d = AN.montarDados({ contratante: { cpf_cnpj: '12.345.678/0001-90' }, operacao: {} });
  assert.strictEqual(d.pfpj, 'PJ'); assert.strictEqual(d.tipo_operacao, 'outro'); assert.strictEqual(d.parcelas_pagas, null);
});

console.log('\n9) Valor incontroverso, parcelas do extrato e cálculo simplificado');
teste('Valor incontroverso = parcela revisada do cenário principal', () => {
  const d = contratoPan();
  const calc = C.calcular(d, { taxaMediaBacenAM: 2.08, questionaveis: T.itensQuestionaveis(d) });
  const vi = calc.valor_incontroverso;
  assert.ok(vi && vi.cenario === calc.cenario_principal);
  perto(vi.parcela_mensal, calc.cenarios[calc.cenario_principal].parcela_revisada, 1e-9, 'parcela');
  assert.ok(vi.parcela_mensal < 1580);
  assert.strictEqual(vi.parcelas_restantes, 48 - 14);
});
teste('Sem cenário de revisão ⇒ sem valor incontroverso', () => {
  const d = { pfpj: 'PF', tipo_operacao: 'emprestimo_pessoal', operacao: { valor_financiado_total: 10000, valor_parcela: 450, prazo_meses: 24 } };
  const calc = C.calcular(d, { taxaMediaBacenAM: 9, questionaveis: [] });   // média acima do contrato
  assert.strictEqual(calc.valor_incontroverso, null);
});
teste('Cartão, cheque especial e imobiliário avisam "cálculo simplificado"', () => {
  for (const t of ['cartao_credito', 'cheque_especial', 'financiamento_imobiliario']) {
    const calc = C.calcular({ tipo_operacao: t, operacao: { valor_financiado_total: 10000, valor_parcela: 500, prazo_meses: 24 } }, { taxaMediaBacenAM: 2 });
    assert.ok(calc.alertas.some(a => /simplificado/i.test(a)), t);
  }
  const v = C.calcular({ tipo_operacao: 'financiamento_veiculo', operacao: { valor_financiado_total: 10000, valor_parcela: 500, prazo_meses: 24 } }, { taxaMediaBacenAM: 2 });
  assert.ok(!v.alertas.some(a => /simplificado/i.test(a)), 'veículo não');
});
teste('Parcelas do extrato valem mais que a estimativa pela data', () => {
  const d = AN.montarDados({ operacao: { prazo_meses: 48, data_primeiro_vencimento: '2023-06-10' }, pagamentos: { parcelas_pagas: 20, parcelas_em_atraso: 2, documento_origem: 'extrato' } });
  assert.strictEqual(d.parcelas_pagas, 20); assert.strictEqual(d.parcelas_pagas_estimadas, false);
  assert.strictEqual(d.parcelas_pagas_origem, 'extrato'); assert.strictEqual(d.situacao, 'atrasado');
});

console.log('\n10) CET real × CET informado');
teste('TIR confere com a taxa da Price quando recebido = financiado', () => {
  const tab = C.tabelaPrice(10000, 0.02, 24);
  perto(C.taxaInternaRetorno(10000, tab.map(l => l.parcela)), 0.02, 1e-10, 'tir');
});
teste('Liberado menor que o financiado ⇒ CET real acima da taxa de juros', () => {
  const d = contratoPan(); d.operacao.valor_liberado = 41000; d.operacao.cet_mensal = 2.30;
  const calc = C.calcular(d, { taxaMediaBacenAM: 2.08, questionaveis: [] });
  assert.ok(calc.cet && calc.cet.real_am > calc.taxa.efetiva_am, 'CET > juros');
  assert.strictEqual(calc.cet.recebido_liquido, 41000);
  assert.ok(calc.cet.real_maior_que_declarado, 'real > 2,30% declarado');
  const ts = T.aplicarTeses(d, calc).teses.find(t => t.id === 'cet_informado');
  assert.strictEqual(ts.resultado, 'aplicavel');
});
teste('Tarifa paga à parte reduz o que o cliente recebeu', () => {
  const d = contratoPan(); d.operacao.valor_liberado = 41000; d.tarifas = [{ nome: 'Cadastro', valor: 600, financiada: false }];
  const calc = C.calcular(d, { taxaMediaBacenAM: 2.08, questionaveis: [] });
  assert.strictEqual(calc.cet.recebido_liquido, 40400);
});
teste('Sem CET no contrato ⇒ "verificar"; sem valor liberado ⇒ sem CET', () => {
  const d = contratoPan(); d.operacao.valor_liberado = 41000; delete d.operacao.cet_mensal;
  const calc = C.calcular(d, { taxaMediaBacenAM: 2.08, questionaveis: [] });
  assert.strictEqual(T.aplicarTeses(d, calc).teses.find(t => t.id === 'cet_informado').resultado, 'verificar');
  assert.strictEqual(C.calcular(contratoPan(), { taxaMediaBacenAM: 2.08 }).cet, null);
});

console.log('\n11) Pago a mais corrigido pelo IPCA');
teste('Fator do IPCA começa no mês seguinte ao pagamento', () => {
  const ipca = { '2026-01': 1, '2026-02': 1, '2026-03': 1 };
  perto(C.fatorIPCA(ipca, '2026-01', '2026-03'), 1.01 * 1.01, 1e-12, 'fev+mar');
  perto(C.fatorIPCA(ipca, '2026-03', '2026-03'), 1, 1e-12, 'mês corrente sem correção');
  assert.strictEqual(C.somarMeses('2025-11', 3), '2026-02');
});
teste('Corrigido = soma das diferenças pagas × fator de cada mês', () => {
  const d = contratoPan(); d.operacao.data_primeiro_vencimento = '2025-01-10'; d.parcelas_pagas = 3;
  const ipca = {}; for (let m = 1; m <= 12; m++) ipca[`2025-${String(m).padStart(2, '0')}`] = 0.5;
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.5, questionaveis: [], ipcaMensal: ipca });   // 1,58× a média: juros revisáveis
  const ic = calc.indebito_corrigido, cp = calc.cenarios[calc.cenario_principal];
  perto(ic.nominal, cp.total_pago_a_mais, 1e-6, 'nominal = pago a mais');
  const dif = cp.parcela_contratada - cp.parcela_revisada;
  const esperado = dif * (Math.pow(1.005, 11) + Math.pow(1.005, 10) + Math.pow(1.005, 9));   // jan, fev, mar → até dez
  perto(ic.corrigido, esperado, 1e-6, 'corrigido');
  assert.ok(ic.sem_juros_de_mora && ic.ate_mes === '2025-12');
});
teste('Sem IPCA (BACEN fora) ⇒ sem valor corrigido, nunca número inventado', () => {
  assert.strictEqual(C.calcular(contratoPan(), { taxaMediaBacenAM: 2.08 }).indebito_corrigido, null);
});

console.log('\n12) Citações só da lista conferida no STJ');
teste('Toda Súmula/Tema citado nas teses foi conferido na base oficial do STJ (13/10/2026)', () => {
  const CONFERIDAS = { sumulas: [297, 382, 472, 539, 541, 565, 566], temas: [27, 28, 246, 247, 618, 619, 620, 958, 972] };
  const txt = T.TESES.map(t => t.fundamento).join(' ') + ' ' + T.FUNDAMENTO_GERAL;
  const sum = [...txt.matchAll(/Súmulas? (\d+)/g)].map(m => Number(m[1]));
  const tem = [...txt.matchAll(/Temas? ([\d, e]+)/g)].flatMap(m => m[1].split(/,| e /).map(x => Number(x.trim())).filter(Boolean));
  const fora = [...sum.filter(n => !CONFERIDAS.sumulas.includes(n)).map(n => 'Súmula ' + n), ...tem.filter(n => !CONFERIDAS.temas.includes(n)).map(n => 'Tema ' + n)];
  assert.deepStrictEqual(fora, [], 'citação não conferida: ' + fora.join(', '));
  assert.ok(sum.length >= 6 && tem.length >= 8);
});

console.log('\n13) Contrato de LIMITE de crédito (GiroCaixa): falta dado ≠ inviável');
const exGiro = () => ({
  classificacao: { tipo_operacao: 'ccb_capital_giro', pfpj: 'PJ' },
  operacao: { tipo: 'Cédula de Crédito Bancário - GIROCAIXA Fácil (Limite de Crédito pré-aprovado)', valor_financiado_total: 150000, data_contratacao: '2025-06-17', capitalizacao_expressa: true,
    clausula_capitalizacao_trecho: 'juros capitalizados mensalmente praticados pela CAIXA, podendo ser fixados entre a taxa mínima de 2,26% ao mês e a taxa máxima de 100,00% ao mês, além de IOF' }
});
teste('Faixa de juros lida do trecho (2,26% a 100,00% a.m.)', () => {
  assert.deepStrictEqual(AN.faixaDoTrecho(exGiro().operacao.clausula_capitalizacao_trecho), { min: 2.26, max: 100 });
  assert.strictEqual(AN.faixaDoTrecho('taxa de 1,99% ao mês'), null);
});
teste('Limite não vira valor financiado; estrutura = limite_de_credito', () => {
  const d = AN.montarDados(exGiro());
  assert.strictEqual(d.operacao.estrutura, 'limite_de_credito');
  assert.strictEqual(d.operacao.limite_credito, 150000);
  assert.strictEqual(d.operacao.valor_financiado_total, null);
  assert.strictEqual(d.operacao.taxa_minima_mensal, 2.26);
});
teste('Sem o demonstrativo ⇒ FALTAM DADOS com o que pedir, e o piso comparado com o BACEN', () => {
  const d = AN.montarDados(exGiro());
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.75 });
  AN.limiteDeCredito(d, calc, { ok: true, valor_am: 1.75 });
  assert.strictEqual(calc.veredito.nivel, 'incompleto');
  assert.ok(/LIMITE de crédito/.test(calc.veredito.motivo) && calc.veredito.pedir_documentos.length === 2);
  perto(calc.limite.razao_piso, 2.26 / 1.75, 1e-9, 'razão do piso');
  assert.ok(calc.alertas.some(a => /MÍNIMA do contrato \(2,26% a\.m\.\) já é 1,29×/.test(a)));
  const jr = T.aplicarTeses(d, calc).teses.find(t => t.id === 'juros_abusivos');
  assert.ok(/piso da faixa \(2,26% a\.m\.\) é 1,29× a média BACEN \(1,75% a\.m\.\)/.test(jr.detalhe), jr.detalhe);
});
teste('Contrato comum sem taxa: a tese diz que falta a taxa do CONTRATO, não a do BACEN', () => {
  const d = { operacao: { valor_financiado_total: 45000, prazo_meses: 48 } };
  const calc = C.calcular(d, { taxaMediaBacenAM: 2 });
  const jr = T.aplicarTeses(d, calc).teses.find(t => t.id === 'juros_abusivos');
  assert.ok(/taxa do contrato não foi encontrada/.test(jr.detalhe), jr.detalhe);
});
teste('Com o demonstrativo da operação, o limite calcula normalmente', () => {
  const ex = exGiro();
  Object.assign(ex.operacao, { estrutura: 'limite_de_credito', limite_credito: 150000, valor_financiado_total: 80000, prazo_meses: 36, valor_parcela: C.parcelaPrice(80000, 0.0326, 36) });
  const d = AN.montarDados(ex);
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.75 });
  AN.limiteDeCredito(d, calc, { ok: true, valor_am: 1.75 });
  assert.strictEqual(calc.veredito.nivel, 'forte');
  assert.strictEqual(d.operacao.valor_financiado_total, 80000);
});

console.log('\n14) Diagnóstico estratégico (caso GiroCaixa, validado 15/10/2026)');
const DG = require('../services/revisao_diagnostico');
const clausulasGiro = () => ({
  taxa_reduzida_condicionada: { presente: true, perde_por_atraso: true, perde_por_cancelar_debito: true, aviso_previo: false, clausula: 'Cl. 7ª §§3º-4º', trecho: 'o redutor será cancelado, sem necessidade de comunicação prévia' },
  debito_em_limite_rotativo: { autorizado: true, revogavel: true, clausula: 'Cl. 7ª' },
  garantia_dividas_futuras: { presente: true, clausula: 'Cl. 9ª §4º' },
  limite_aumentado_pelo_banco: { presente: true, clausula: 'Cl. 2ª p.ú.' },
  vencimento_antecipado: { presente: true, sem_notificacao: true, cruzado_outras_operacoes: true, por_fato_de_avalista: true, por_debito_fiscal: true, clausula: 'Cl. 11ª' },
  fundo_garantidor: { tipo: 'FGM', percentual: 80, devedor_segue_cobrado: true, honra_atualiza_pela_selic: true, clausula: 'Cl. 18ª' },
  liquidacao_antecipada: { presente: true, cita_res_3516: true, clausula: 'Cl. 8ª' },
  canal_renegociacao: { presente: true, contato: '0800 726 8068, opção 8', clausula: 'Cl. 17ª' },
  juros_mora_sobre_juros: { presente: true, clausula: 'Cl. 12ª III' },
  honorarios_extrajudiciais_percentual: 10, avalistas_quantidade: 2, aval_com_anuencia_conjuge: true, renuncia_beneficio_ordem: true,
  foro: 'justica_federal', vigencia_dias: 7200,
  prazos_de_risco: [{ evento: 'Bloqueio do limite', dias: 5, clausula: 'Cl. 4ª p.ú.' }]
});
const diagGiro = (extra = {}) => {
  const ex = exGiro(); ex.clausulas = clausulasGiro(); ex.instituicao = { nome: 'CAIXA ECONOMICA FEDERAL' }; ex.garantia = { tipo: 'aval' }; Object.assign(ex, extra);
  const d = AN.montarDados(ex);
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.75 });
  AN.limiteDeCredito(d, calc, { ok: true, valor_am: 1.75 });
  return DG.montarDiagnostico(d, calc, { ok: true, valor_am: 1.75 }, T.aplicarTeses(d, calc));
};
teste('Limite sem taxa provada: achado ALTO pela Súmula 530, com a defesa do banco', () => {
  const g = diagGiro();
  assert.strictEqual(g.achados[0].id, 'taxa_em_faixa');
  assert.strictEqual(g.achados[0].forca, 'alta');
  assert.ok(/Súmula 530/.test(g.achados[0].base) && g.achados[0].defesa_banco);
  assert.ok(/Súmula 530/.test(g.resumo.join(' ')));
});
teste('O que NÃO é abuso: piso 1,29× a média, capitalização expressa, CDC em capital de giro PJ', () => {
  const g = diagGiro();
  const t = g.nao_e_abuso.map(x => x.titulo).join(' | ');
  assert.ok(/piso/.test(t) && /capitalizados/.test(t) && /Consumidor/.test(t), t);
  assert.strictEqual(g.estrutura.cdc.aplica, false);
});
teste('Esta semana: revogar SÓ o débito no rotativo (sem perder o redutor) e pedir documentos com protocolo', () => {
  const g = diagGiro();
  assert.ok(/SÓ o débito/.test(g.esta_semana[0].acao) && /desconto na taxa/.test(g.esta_semana[0].porque));
  assert.ok(g.esta_semana.some(x => /protocolo/.test(x.acao)));
  assert.ok(g.esta_semana.some(x => /0800 726 8068/.test(x.acao)));
});
teste('Garantias: avalistas, execução direta, Súmula 581, dívidas futuras por ~20 anos', () => {
  const g = diagGiro().garantias.join(' ');
  assert.ok(/2 avalista/.test(g) && /cônjuge/.test(g) && /Súmula 581/.test(g) && /cerca de 20 anos/.test(g) && /benefício de ordem/.test(g), g);
});
teste('Alavancas: quitação Res. 3.516, FGM pela Selic; linha do tempo começa no bloqueio de 5 dias', () => {
  const g = diagGiro();
  const neg = g.caminhos[0].como.join(' ');
  assert.ok(/3\.516/.test(neg) && /FGM \(80%\)/.test(neg) && /Selic/.test(neg), neg);
  assert.strictEqual(g.linha_do_tempo[0].dias, 5);
  assert.strictEqual(g.maior_prejuizo.length, 3);
});
teste('Com comprovante de saque a 4% a.m. (2,29×): juros viram achado ALTO e a revisional tem base', () => {
  const g = diagGiro({ operacoes_do_limite: [{ data: '2025-07-01', valor_liberado: 50000, taxa_mensal: 4, prazo_meses: 36 }] });
  assert.ok(!g.achados.some(a => a.id === 'taxa_em_faixa'));
  const j = g.achados.find(a => a.id === 'juros_acima_media');
  assert.ok(j && j.forca === 'alta', JSON.stringify(j));
  assert.ok(/Há base/.test(g.caminhos[2].quando));
});
teste('Saque a 2,3% a.m. (1,31×): o tamanho da taxa entra em "não é abuso"', () => {
  const g = diagGiro({ operacoes_do_limite: [{ data: '2025-07-01', valor_liberado: 50000, taxa_mensal: 2.3 }] });
  assert.ok(g.nao_e_abuso.some(x => /1,31×/.test(x.titulo)));
  assert.ok(/não sustenta/.test(g.resumo.join(' ')));
});
teste('Toda Súmula/Tema citado no diagnóstico está na lista conferida', () => {
  const OK = { sumulas: [297, 381, 472, 530, 539, 541, 581], temas: [648, 1085] };
  const txt = require('fs').readFileSync(require('path').join(__dirname, '../services/revisao_diagnostico.js'), 'utf8');
  const sum = [...txt.matchAll(/Súmulas? (\d+)/g)].map(m => Number(m[1]));
  const tem = [...txt.matchAll(/Temas? (\d+)/g)].map(m => Number(m[1]));
  const fora = [...sum.filter(n => !OK.sumulas.includes(n)).map(n => 'Súmula ' + n), ...tem.filter(n => !OK.temas.includes(n)).map(n => 'Tema ' + n)];
  assert.deepStrictEqual(fora, [], 'citação não conferida: ' + fora.join(', '));
});

console.log('\n15) Tetos LEGAIS: a lei vence a média do BACEN');
const TT = require('../services/revisao_tetos');
const teseDe = (d, calc, id) => T.aplicarTeses(d, calc).teses.find(t => t.id === id);
teste('Cheque especial PF a 12% a.m. em 2023: acima do teto de 8% ⇒ forte, mesmo sem saldo/prazo', () => {
  const d = { pfpj: 'PF', tipo_operacao: 'cheque_especial', operacao: { data_contratacao: '2023-03-01', taxa_juros_mensal_declarada: 12 } };
  const calc = C.calcular(d, { taxaMediaBacenAM: 7.43 });
  assert.strictEqual(calc.teto.id, 'cheque_especial_8');
  assert.strictEqual(calc.teto.excedido, true);
  assert.strictEqual(calc.veredito.nivel, 'forte');
  assert.strictEqual(teseDe(d, calc, 'teto_legal').resultado, 'aplicavel');
  assert.ok(/Res\. CMN 4\.765\/2019, art\. 3º/.test(teseDe(d, calc, 'teto_legal').fundamento));
});
teste('Cheque especial PF a 7,5% a.m.: dentro do teto; PJ não tem teto', () => {
  const pf = C.calcular({ pfpj: 'PF', tipo_operacao: 'cheque_especial', operacao: { data_contratacao: '2023-03-01', taxa_juros_mensal_declarada: 7.5 } }, {});
  assert.strictEqual(pf.teto.excedido, false);
  const pj = C.calcular({ pfpj: 'PJ', tipo_operacao: 'cheque_especial', operacao: { data_contratacao: '2023-03-01', taxa_juros_mensal_declarada: 12 } }, {});
  assert.strictEqual(pj.teto, null);
});
teste('Cartão parcelado depois de 03/01/2024: juros acima do valor original ⇒ excesso e cenário pelo teto', () => {
  // R$ 1.000 em 12x de R$ 190 ⇒ juros de R$ 1.280 > R$ 1.000
  const d = { pfpj: 'PF', tipo_operacao: 'cartao_credito', subtipo: 'parcelado', parcelas_pagas: 3, operacao: { data_contratacao: '2024-06-10', valor_financiado_total: 1000, valor_parcela: 190, prazo_meses: 12 } };
  const calc = C.calcular(d, { taxaMediaBacenAM: 25 });          // média alta: só o teto revisa
  assert.strictEqual(calc.teto.excedido, true);
  perto(calc.teto.excesso, 280, 1e-9, 'excesso');
  assert.strictEqual(calc.cenarios.A.nome, 'Juros pelo teto legal');
  perto(calc.cenarios.A.parcela_revisada, 2000 / 12, 1e-6, 'parcela no teto = 2·PV/n');
  assert.strictEqual(calc.veredito.nivel, 'forte');
});
teste('Cartão: operação antes de 03/01/2024 não tem o teto', () => {
  const calc = C.calcular({ tipo_operacao: 'cartao_credito', operacao: { data_contratacao: '2023-11-10', valor_financiado_total: 1000, valor_parcela: 190, prazo_meses: 12 } }, {});
  assert.strictEqual(calc.teto, null);
});
teste('Pronampe: Selic 10,4% + 6% ⇒ teto ~17% a.a.; a média de capital de giro fica de fora', () => {
  const d = { pfpj: 'PJ', tipo_operacao: 'ccb_capital_giro', programa: 'pronampe', operacao: { data_contratacao: '2024-05-10', valor_financiado_total: 100000, valor_parcela: 4000, prazo_meses: 36 } };
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.7, selicAA: 10.4 });
  perto(calc.teto.teto_aa, 1.104 * 1.06 - 1, 1e-12, 'teto composto');
  assert.strictEqual(calc.teto.excedido, true);                    // 4000 em 36x de 100k ⇒ ~2,3% a.m. ⇒ >17% a.a.
  assert.strictEqual(calc.razao, null);
  assert.ok(calc.bacen.ignorada);
  assert.strictEqual(calc.cenarios.A.nome, 'Juros pelo teto legal');
  assert.strictEqual(teseDe(d, calc, 'juros_abusivos').resultado, 'verificar');
});
teste('Pronampe pós-fixado: Selic + 7% a.a. passa do máximo; Selic + 5% não. Até 2020 o máximo é 1,25%', () => {
  const base = (spread, data) => ({ tipo_operacao: 'ccb_capital_giro', programa: 'pronampe', operacao: { data_contratacao: data, indexador: 'selic', spread_anual: spread } });
  assert.strictEqual(C.calcular(base(7, '2023-01-10'), {}).teto.excedido, true);
  assert.strictEqual(C.calcular(base(5, '2023-01-10'), {}).teto.excedido, false);
  assert.strictEqual(C.calcular(base(5, '2020-08-10'), {}).teto.excedido, true);
});
teste('Pronampe sem a Selic do mês: "verificar", nunca teto estimado', () => {
  const calc = C.calcular({ tipo_operacao: 'ccb_capital_giro', operacao: { tipo: 'CCB Pronampe', data_contratacao: '2024-05-10', valor_financiado_total: 100000, valor_parcela: 4000, prazo_meses: 36 } }, { taxaMediaBacenAM: 1.7 });
  assert.strictEqual(calc.teto.id, 'pronampe');                  // achado pelo nome do produto
  assert.strictEqual(calc.teto.excedido, null);
  assert.strictEqual(calc.teto.teto_aa, null);
});
teste('FCO: linha regulada sem teto automático — a média não decide o veredito', () => {
  const d = { pfpj: 'PJ', tipo_operacao: 'ccb_capital_giro', programa: 'fco', operacao: { data_contratacao: '2024-05-10', valor_financiado_total: 100000, valor_parcela: 4000, prazo_meses: 36 } };
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.0 });           // 2,3× a média: sem a regra sairia "forte"
  assert.strictEqual(calc.razao, null);
  assert.ok(!calc.cenarios.A);
  assert.strictEqual(calc.veredito.nivel, 'fraca');
  assert.ok(/Linha regulada/.test(calc.veredito.motivo));
  assert.strictEqual(teseDe(d, calc, 'teto_legal').resultado, 'verificar');
});
teste('Operador marcou "nenhum programa": o nome do produto não reativa o Pronampe', () => {
  assert.strictEqual(TT.programaDoContrato({ operacao: { tipo: 'CCB Pronampe' }, campos_editados: ['programa'] }), null);
  assert.strictEqual(TT.programaDoContrato({ operacao: { tipo: 'CCB Pronampe' } }), 'pronampe');
});
teste('Linha comum (veículo): sem teto, tese "não se aplica" e cenário A pela média como antes', () => {
  const d = contratoPan();
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.5 });
  assert.strictEqual(calc.teto, null);
  assert.strictEqual(teseDe(d, calc, 'teto_legal').resultado, 'nao_aplicavel');
  assert.strictEqual(calc.cenarios.A.nome, 'Juros pela taxa média do BACEN');
});

console.log('\n16) Roteiro da CCB e CET');
teste('Honorários extrajudiciais de 20% em CCB ⇒ aplicável (Lei 10.931, art. 28, § 1º, IV); 10% ⇒ dentro', () => {
  const d = (h) => ({ tipo_operacao: 'ccb_capital_giro', operacao: {}, clausulas: { honorarios_extrajudiciais_percentual: h } });
  assert.strictEqual(teseDe(d(20), null, 'honorarios_ccb').resultado, 'aplicavel');
  assert.strictEqual(teseDe(d(10), null, 'honorarios_ccb').resultado, 'nao_aplicavel');
  assert.strictEqual(teseDe({ tipo_operacao: 'emprestimo_pessoal', operacao: {}, clausulas: { honorarios_extrajudiciais_percentual: 20 } }, null, 'honorarios_ccb').resultado, 'verificar');
});
teste('CET: contrato desde 01/02/2021 cita a Res. 4.881; anterior, a 3.517', () => {
  const sem = (data) => teseDe({ operacao: { data_contratacao: data, valor_financiado_total: 10000, valor_liberado: 10000, valor_parcela: 1000, prazo_meses: 12 } },
    C.calcular({ operacao: { data_contratacao: data, valor_financiado_total: 10000, valor_liberado: 10000, valor_parcela: 1000, prazo_meses: 12 } }, {}), 'cet_informado').detalhe;
  assert.ok(/4\.881/.test(sem('2023-05-10')) && !/3\.517/.test(sem('2023-05-10')));
  assert.ok(/3\.517/.test(sem('2019-05-10')));
});

console.log('\n17) Relatório interno: placar e HTML');
const DH = require('../services/revisao_diagnostico_html');
teste('GiroCaixa sem comprovantes ⇒ FALTA DOCUMENTO, sem número inventado, próximo passo com aviso do advogado', () => {
  const g = diagGiro();
  assert.strictEqual(g.placar.decisao.codigo, 'documentos');
  assert.strictEqual(g.placar.em_jogo.length, 0);
  assert.ok(/Demonstrativo|comprovante/i.test(g.placar.falta), g.placar.falta);
  assert.ok(g.placar.proximo.confirmar_advogado && !/confirmar com o advogado/.test(g.placar.proximo.acao));
  assert.deepStrictEqual(g.placar.em_30s.map(x => x.tipo), ['argumento', 'risco', 'nao_prometer']);
  assert.ok(!/Consumidor/.test(g.placar.em_30s[2].texto));        // o CDC já está no rodapé
});
teste('Veículo com juros 1,6× a média ⇒ VALE ENTRAR e o dinheiro em jogo vem do cálculo', () => {
  const d = contratoPan();
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.5, questionaveis: T.itensQuestionaveis(d) });
  const g = DG.montarDiagnostico(d, calc, { ok: true, valor_am: 1.5 }, T.aplicarTeses(d, calc));
  assert.strictEqual(g.placar.decisao.codigo, 'entrar');
  const eco = g.placar.em_jogo.find(x => x.rotulo === 'Economia estimada');
  perto(eco.valor, calc.economia_estimada, 1e-9, 'economia');
  assert.ok(g.placar.em_jogo.some(x => x.de != null && x.de > x.valor), 'parcela hoje → revisada');
});
teste('Cheque especial acima de 8% ⇒ VALE ENTRAR pelo teto, e o resumo cita o teto', () => {
  const d = { pfpj: 'PF', tipo_operacao: 'cheque_especial', operacao: { data_contratacao: '2023-03-01', taxa_juros_mensal_declarada: 12 } };
  const calc = C.calcular(d, {});
  const g = DG.montarDiagnostico(d, calc, null, T.aplicarTeses(d, calc));
  assert.strictEqual(g.placar.decisao.codigo, 'entrar');
  assert.ok(/8% a\.m\./.test(g.resumo.join(' ')));
});
teste('Busca e apreensão: prazo de defesa vira o "fazer agora" e o maior risco; melhor argumento é o que vale mais', () => {
  const d = contratoPan();
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.5, questionaveis: T.itensQuestionaveis(d) });
  const g = DG.montarDiagnostico(d, calc, { ok: true, valor_am: 1.5 }, T.aplicarTeses(d, calc));
  assert.ok(/HOJE/.test(g.placar.proximo.acao) && /5 dias/.test(g.placar.proximo.acao));
  assert.ok(/^Perdido o prazo/.test(g.placar.proximo.porque) && !/art\.$/.test(g.placar.proximo.porque));
  assert.ok(/Busca e apreensão/.test(g.placar.em_30s.find(x => x.tipo === 'risco').texto));
  const juros = g.achados.find(a => a.id === 'juros_acima_media');
  perto(juros.impacto.valor, calc.cenarios.A.economia_total, 1e-9, 'impacto dos juros = cenário A');
  assert.ok(/Juros .* vale cerca de R\$/.test(g.placar.em_30s[0].texto), g.placar.em_30s[0].texto);
  assert.ok(!g.maior_prejuizo.some(x => /a média do mercado/.test(x)));   // juros é argumento, não risco
});
teste('Revisão sem cálculo ainda (conferência) ⇒ FALTA CALCULAR, nunca "vale negociar"', () => {
  const g = diagGiro(); delete g.placar;
  assert.strictEqual(DG.placar(g, null).decisao.rotulo, 'FALTA CALCULAR');
});
teste('Diagnóstico antigo (sem placar gravado) ganha placar na hora', () => {
  const g = diagGiro(); delete g.placar;
  const html = DH.renderizar(g, { veredito: { nivel: 'incompleto' } });
  assert.ok(/FALTA DOCUMENTO/.test(html));
});
teste('HTML: tarja interna, ordem placar → argumentos → plano, sem undefined/NaN e com escape', () => {
  const g = diagGiro();
  g.achados[0].trecho = '<script>x</script>';
  const html = DH.renderizar(g, null);
  assert.ok(/USO INTERNO/.test(html));
  const i = (t) => html.indexOf(t);
  assert.ok(i('Vale a pena?') < i('Em 30 segundos') && i('Em 30 segundos') < i('Argumentos (') && i('Argumentos (') < i('Riscos para o cliente') && i('Riscos para o cliente') < i('>Plano<'));
  assert.ok(!/undefined|NaN|\[object/.test(html));
  assert.ok(!/<script>x/.test(html) && /&lt;script&gt;x/.test(html));
  assert.ok(!/Direito de desist/.test(DH.renderizar({ ...g, linha_do_tempo: [{ evento: 'Direito de desistência', dias: 7 }] }, null)));
});
teste('Página do PDF interno abre todos os argumentos', () => {
  const pag = DH.paginaImpressao(DH.renderizar(diagGiro(), null), 'Teste');
  assert.ok(/Não enviar ao cliente/.test(pag));
  assert.ok(!/<details class="arg"/.test(pag) && /<details open class="arg"/.test(pag));
});

console.log('\n18) Honestidade do cenário principal: juros só com tese que se sustenta');
teste('Juros 1,14× a média + tarifas/seguro: principal = B; a redução dos juros é só referência', () => {
  const d = contratoPan();
  const calc = C.calcular(d, { taxaMediaBacenAM: 2.08, questionaveis: T.itensQuestionaveis(d) });
  assert.strictEqual(calc.juros_revisaveis, false);
  assert.strictEqual(calc.cenario_principal, 'B');
  assert.strictEqual(calc.cenario_otimista, null);                  // 1,14× < 1,2×: nem otimista
  perto(calc.economia_estimada, calc.cenarios.B.economia_total, 1e-9, 'economia = B');
});
teste('Juros 1,3× a média: principal = B e o C vira "cenário otimista"', () => {
  const d = contratoPan();
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.82, questionaveis: T.itensQuestionaveis(d) });
  assert.ok(calc.razao >= 1.2 && calc.razao < 1.5, String(calc.razao));
  assert.strictEqual(calc.cenario_principal, 'B');
  assert.strictEqual(calc.cenario_otimista, 'C');
  assert.ok(calc.economia_otimista > calc.economia_estimada);
});
teste('Juros 1,58× a média: tese se sustenta ⇒ principal = C, sem otimista', () => {
  const d = contratoPan();
  const calc = C.calcular(d, { taxaMediaBacenAM: 1.5, questionaveis: T.itensQuestionaveis(d) });
  assert.strictEqual(calc.juros_revisaveis, true);
  assert.strictEqual(calc.cenario_principal, 'C');
  assert.strictEqual(calc.cenario_otimista, null);
});
teste('Só juros a 1,3× (sem tarifas): sem economia prometida, otimista = A, veredito moderada', () => {
  const calc = C.calcular({ operacao: { valor_financiado_total: 30000, valor_parcela: 1300, prazo_meses: 36, data_contratacao: '2024-02-10' } }, { taxaMediaBacenAM: 1.95 });
  assert.ok(calc.razao >= 1.2 && calc.razao < 1.5, String(calc.razao));
  assert.strictEqual(calc.cenario_principal, null);
  assert.strictEqual(calc.economia_estimada, 0);
  assert.strictEqual(calc.cenario_otimista, 'A');
  assert.strictEqual(calc.veredito.nivel, 'moderada');
  assert.strictEqual(calc.valor_incontroverso, null);
});

console.log(`\n${ok} passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
