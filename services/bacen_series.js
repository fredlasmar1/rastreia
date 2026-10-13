/**
 * RASTREIA — Mapa "tipo de operação + PF/PJ → séries SGS do Banco Central"
 * (taxa média de juros das NOVAS operações, ponderada pelas concessões).
 *
 * VALIDAÇÃO (13/10/2026): cada código foi conferido pelo nome oficial e pelo
 * valor de ago/2026 — portal dadosabertos.bcb.gov.br (até o WAF bloquear) e o
 * espelho de metadados do SGS hedgehog.quantilica.com/series/{codigo} — e o
 * valor puxado da própria API SGS (api.bcb.gov.br/dados/serie/bcdata.sgs.{c}).
 * A série anual foi conferida contra a mensal capitalizada (ex.: veículos PF
 * 1,97% a.m. ⇒ (1,0197^12 − 1) = 26,4% ≈ série 20749 = 26,42% a.a.).
 *
 * `olinda`: nome da modalidade no serviço taxaJuros (taxa por instituição),
 * usado só para mostrar a posição do banco no mês — não entra no cálculo.
 */
const VALIDADO_EM = '2026-10-13';

const SERIES = {
  PF: {
    financiamento_veiculo: { am: 25471, aa: 20749, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas físicas - Aquisição de veículos', conferido: '1,97% a.m. / 26,42% a.a. (08/2026)', olinda: 'Aquisição de veículos - Prefixado' },
    emprestimo_pessoal: { am: 25464, aa: 20742, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas físicas - Crédito pessoal não consignado', conferido: '6,39% a.m. / 110,22% a.a. (08/2026)', olinda: 'Crédito pessoal não consignado - Prefixado' },
    consignado: { am: 25469, aa: 20747, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas físicas - Crédito pessoal consignado total', conferido: '2,14% a.m. / 29,00% a.a. (08/2026)', olinda: null },
    consignado_inss: { am: 25468, aa: 20746, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas físicas - Crédito pessoal consignado para aposentados e pensionistas do INSS', conferido: '1,82% a.m. / 24,12% a.a. (08/2026)', olinda: 'Crédito pessoal consignado INSS - Prefixado' },
    consignado_publico: { am: 25467, aa: 20745, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas físicas - Crédito pessoal consignado para trabalhadores do setor público', conferido: '1,82% a.m. / 24,14% a.a. (08/2026)', olinda: 'Crédito pessoal consignado público - Prefixado' },
    consignado_privado: { am: 25466, aa: 20744, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas físicas - Crédito pessoal consignado para trabalhadores do setor privado', conferido: '3,79% a.m. / 56,34% a.a. (08/2026)', olinda: 'Crédito pessoal consignado privado - Prefixado' },
    cartao_credito: { am: 25477, aa: 22022, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas físicas - Cartão de crédito rotativo', conferido: '15,18% a.m. / 444,89% a.a. (08/2026)', olinda: 'Cartão de crédito - rotativo total - Prefixado' },
    cartao_credito_parcelado: { am: 25478, aa: 22023, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas físicas - Cartão de crédito parcelado', conferido: '9,34% a.m. / 192,08% a.a. (08/2026)', olinda: 'Cartão de crédito - parcelado - Prefixado' },
    cheque_especial: { am: 25463, aa: 20741, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas físicas - Cheque especial', conferido: '7,43% a.m. / 136,41% a.a. (08/2026)', olinda: 'Cheque especial - Prefixado' },
    financiamento_imobiliario: { am: 25497, aa: 20772, nome: 'Taxa média mensal de juros das operações de crédito com recursos direcionados - Pessoas físicas - Financiamento imobiliário com taxas de mercado', conferido: '1,12% a.m. / 14,24% a.a. (08/2026)', olinda: 'Financiamento imobiliário com taxas de mercado - Prefixado' },
    outro: { am: 25470, aa: 20748, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas físicas - Crédito pessoal total', conferido: '3,58% a.m. / 52,59% a.a. (08/2026)', olinda: null }
  },
  PJ: {
    ccb_capital_giro: { am: 25442, aa: 20723, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas jurídicas - Capital de giro com prazo superior a 365 dias', conferido: '1,71% a.m. / 22,55% a.a. (08/2026)', olinda: 'Capital de giro com prazo superior a 365 dias - Prefixado' },
    capital_giro_ate_365: { am: 25441, aa: 20722, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas jurídicas - Capital de giro com prazo de até 365 dias', conferido: '1,70% a.m. / 22,38% a.a. (08/2026)', olinda: 'Capital de giro com prazo até 365 dias - Prefixado' },
    financiamento_veiculo: { am: 25447, aa: 20728, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas jurídicas - Aquisição de veículos', conferido: '1,45% a.m. / 18,82% a.a. (08/2026)', olinda: null },
    cheque_especial: { am: 25446, aa: 20727, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas jurídicas - Cheque especial', conferido: '13,45% a.m. / 354,78% a.a. (08/2026)', olinda: null },
    outro: { am: 25444, aa: 20725, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas jurídicas - Capital de giro total', conferido: '1,73% a.m. / 22,89% a.a. (08/2026)', olinda: null }
  }
};

// tipo de operação (+ subtipo opcional) e PF/PJ → série. Sem mapeamento ⇒ "outro" do segmento.
function serieParaOperacao(tipoOperacao, pfpj = 'PF', subtipo = null) {
  const seg = SERIES[pfpj === 'PJ' ? 'PJ' : 'PF'];
  const chave = subtipo && seg[`${tipoOperacao}_${subtipo}`] ? `${tipoOperacao}_${subtipo}` : tipoOperacao;
  const s = seg[chave] || seg.outro;
  return { chave: seg[chave] ? chave : 'outro', segmento: pfpj === 'PJ' ? 'PJ' : 'PF', ...s };
}

module.exports = { SERIES, VALIDADO_EM, serieParaOperacao };
