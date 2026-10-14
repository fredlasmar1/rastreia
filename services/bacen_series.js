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
 * AMPLIAÇÃO (13/10/2026): modalidades que faltavam (desconto de duplicatas,
 * conta garantida, vendor, compror, ACC, arrendamento, outros bens, composição
 * de dívidas…) a partir do catálogo curado de Edilson Aguiais (OAB-GO 59.889),
 * github.com/edilsonaguiais/sgs-peritos (MIT); cada código conferido na API
 * SGS: valor de 08/2026 e (1 + mensal)^12 − 1 ≈ anual.
 *
 * `olinda`: nome da modalidade no serviço taxaJuros (taxa por instituição),
 * usado só para mostrar a posição do banco no mês — não entra no cálculo.
 * `reserva`: chave usada quando a série vem zerada/sem dado (ex.: o BCB não
 * tem operações de arrendamento de veículos PF — série 25474 = 0,00%).
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
    financiamento_bens: { am: 25472, aa: 20750, nome: 'Taxa média mensal de juros - Pessoas físicas - Aquisição de outros bens', conferido: '6,14% a.m. / 104,50% a.a. (08/2026)', olinda: null },
    arrendamento_mercantil: { am: 25476, aa: 20754, nome: 'Taxa média mensal de juros - Pessoas físicas - Arrendamento mercantil total', conferido: '1,28% a.m. / 16,51% a.a. (08/2026)', olinda: null },
    arrendamento_mercantil_veiculo: { am: 25474, aa: 20752, nome: 'Taxa média mensal de juros - Pessoas físicas - Arrendamento mercantil de veículos', conferido: '0,00% (08/2026 — sem operações; usa a de aquisição de veículos)', olinda: null, reserva: 'financiamento_veiculo' },
    arrendamento_mercantil_outros: { am: 25475, aa: 20753, nome: 'Taxa média mensal de juros - Pessoas físicas - Arrendamento mercantil de outros bens', conferido: '1,28% a.m. / 16,51% a.a. (08/2026)', olinda: null },
    desconto_recebiveis: { am: 25480, aa: 20755, nome: 'Taxa média mensal de juros - Pessoas físicas - Desconto de cheques', conferido: '3,94% a.m. / 58,95% a.a. (08/2026)', olinda: null },
    renegociacao: { am: 25465, aa: 20743, nome: 'Taxa média mensal de juros - Pessoas físicas - Crédito pessoal não consignado vinculado à composição de dívidas', conferido: '2,89% a.m. / 40,69% a.a. (08/2026)', olinda: null },
    outro: { am: 25470, aa: 20748, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas físicas - Crédito pessoal total', conferido: '3,58% a.m. / 52,59% a.a. (08/2026)', olinda: null }
  },
  PJ: {
    ccb_capital_giro: { am: 25442, aa: 20723, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas jurídicas - Capital de giro com prazo superior a 365 dias', conferido: '1,71% a.m. / 22,55% a.a. (08/2026)', olinda: 'Capital de giro com prazo superior a 365 dias - Prefixado' },
    ccb_capital_giro_ate_365: { am: 25441, aa: 20722, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas jurídicas - Capital de giro com prazo de até 365 dias', conferido: '1,70% a.m. / 22,38% a.a. (08/2026)', olinda: 'Capital de giro com prazo até 365 dias - Prefixado' },
    financiamento_veiculo: { am: 25447, aa: 20728, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas jurídicas - Aquisição de veículos', conferido: '1,45% a.m. / 18,82% a.a. (08/2026)', olinda: null },
    cheque_especial: { am: 25446, aa: 20727, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas jurídicas - Cheque especial', conferido: '13,45% a.m. / 354,78% a.a. (08/2026)', olinda: null },
    ccb_capital_giro_rotativo: { am: 25443, aa: 20724, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Capital de giro rotativo', conferido: '2,87% a.m. / 40,41% a.a. (08/2026)', olinda: null },
    conta_garantida: { am: 25445, aa: 20726, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Conta garantida', conferido: '3,78% a.m. / 56,15% a.a. (08/2026)', olinda: null },
    desconto_recebiveis: { am: 25438, aa: 20719, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Desconto de duplicatas e recebíveis', conferido: '1,43% a.m. / 18,60% a.a. (08/2026)', olinda: null },
    desconto_recebiveis_cheques: { am: 25439, aa: 20720, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Desconto de cheques', conferido: '2,30% a.m. / 31,37% a.a. (08/2026)', olinda: null },
    antecipacao_cartao: { am: 25440, aa: 20721, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Antecipação de faturas de cartão de crédito', conferido: '1,21% a.m. / 15,49% a.a. (08/2026)', olinda: null },
    financiamento_bens: { am: 25448, aa: 20729, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Aquisição de outros bens', conferido: '1,49% a.m. / 19,41% a.a. (08/2026)', olinda: null },
    arrendamento_mercantil: { am: 25452, aa: 20733, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Arrendamento mercantil total', conferido: '1,34% a.m. / 17,28% a.a. (08/2026)', olinda: null },
    arrendamento_mercantil_veiculo: { am: 25450, aa: 20731, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Arrendamento mercantil de veículos', conferido: '1,37% a.m. / 17,73% a.a. (08/2026)', olinda: null, reserva: 'financiamento_veiculo' },
    arrendamento_mercantil_outros: { am: 25451, aa: 20732, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Arrendamento mercantil de outros bens', conferido: '1,33% a.m. / 17,19% a.a. (08/2026)', olinda: null },
    vendor: { am: 25453, aa: 20734, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Vendor', conferido: '1,42% a.m. / 18,39% a.a. (08/2026)', olinda: null },
    compror: { am: 25454, aa: 20735, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Compror', conferido: '1,32% a.m. / 17,07% a.a. (08/2026)', olinda: null },
    cambio: { am: 25458, aa: 20736, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Adiantamento sobre contratos de câmbio (ACC)', conferido: '0,44% a.m. / 5,44% a.a. (08/2026)', olinda: null },
    comercio_exterior_importacao: { am: 25459, aa: 20737, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Financiamento a importações', conferido: '1,09% a.m. / 13,90% a.a. (08/2026)', olinda: null },
    comercio_exterior_exportacao: { am: 25460, aa: 20738, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Financiamento a exportações', conferido: '1,12% a.m. / 14,30% a.a. (08/2026)', olinda: null },
    cartao_credito: { am: 25455, aa: 22019, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Cartão de crédito rotativo', conferido: '9,69% a.m. / 203,50% a.a. (08/2026)', olinda: null },
    cartao_credito_parcelado: { am: 25456, aa: 22020, nome: 'Taxa média mensal de juros - Pessoas jurídicas - Cartão de crédito parcelado', conferido: '8,16% a.m. / 156,43% a.a. (08/2026)', olinda: null },
    // Operação não identificada: média geral das operações PJ com recursos livres
    outro: { am: 25437, aa: 20718, nome: 'Taxa média mensal de juros das operações de crédito com recursos livres - Pessoas jurídicas - Total', conferido: '1,82% a.m. / 24,19% a.a. (08/2026)', olinda: null }
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
