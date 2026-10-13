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
teste('Faltando parcela e taxa ⇒ inviável', () => {
  const r = C.calcular({ operacao: { valor_financiado_total: 45000, prazo_meses: 48 } }, {});
  assert.strictEqual(r.veredito.nivel, 'inviavel');
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

console.log(`\n${ok} passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
