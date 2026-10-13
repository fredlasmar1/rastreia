/**
 * Teste AO VIVO da taxa média BACEN (API pública, gratuita).
 * Rodar: node scripts/test-bacen-taxas.js
 */
const { buscarTaxaMedia, taxaManual } = require('../services/bacen_taxas');
(async () => {
  const casos = [
    { rotulo: 'Veículo PF, contrato 2023-05-10', p: { tipoOperacao: 'financiamento_veiculo', pfpj: 'PF', dataContratacao: '2023-05-10', banco: { nome: 'Banco Pan' } } },
    { rotulo: 'Capital de giro PJ, 2024-01-20', p: { tipoOperacao: 'ccb_capital_giro', pfpj: 'PJ', dataContratacao: '2024-01-20', banco: { nome: 'Banco do Brasil' } } },
    { rotulo: 'Consignado INSS, 2025-03-01', p: { tipoOperacao: 'consignado', subtipo: 'inss', pfpj: 'PF', dataContratacao: '2025-03-01' } },
    { rotulo: 'Mês ainda sem dado (2026-10) ⇒ recua', p: { tipoOperacao: 'financiamento_veiculo', pfpj: 'PF', dataContratacao: '2026-10-05' } },
    { rotulo: 'Sem data ⇒ erro claro', p: { tipoOperacao: 'financiamento_veiculo' } }
  ];
  let falhas = 0;
  for (const c of casos) {
    const r = await buscarTaxaMedia(c.p);
    console.log(`\n${c.rotulo}`);
    if (!r.ok) { console.log(`  → ${r.erro}`); if (c.p.dataContratacao) falhas++; continue; }
    console.log(`  série ${r.serie_am}/${r.serie_aa} (${r.chave_serie}) mês ${r.mes_referencia}${r.recuou_meses ? ` (recuou ${r.recuou_meses})` : ''}: ${r.valor_am}% a.m. · ${Number(r.valor_aa).toFixed(2)}% a.a. [${r.valor_aa_origem}]`);
    if (r.olinda) console.log(`  Olinda (semana ${r.olinda.semana}): ${r.olinda.total_instituicoes} instituições, faixa ${r.olinda.menor_am}–${r.olinda.maior_am}% a.m.${r.olinda.banco ? ` · ${r.olinda.banco.nome} em ${r.olinda.banco.posicao}º com ${r.olinda.banco.taxa_am}%` : ' · banco não localizado'}`);
  }
  const m = taxaManual({ valorAm: 1.85, mesReferencia: '2023-05', fonte: 'site BACEN', usuario: 'operador' });
  console.log(`\nManual: ${m.valor_am}% a.m. ⇒ ${m.valor_aa.toFixed(2)}% a.a., origem ${m.origem}`);
  console.log(falhas ? `\n${falhas} falha(s)` : '\nOK');
  process.exit(falhas ? 1 : 0);
})();
