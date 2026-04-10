/**
 * RASTREIA — Planos de Assinatura por Nicho
 *
 * Cada nicho tem 3 níveis (starter / profissional / premium)
 * com diferentes quantidades de consultas inclusas.
 */

const PLANOS = {
  imobiliario: {
    starter:      { preco: 797,  consultas: 5,   nome: 'Imobiliário Starter' },
    profissional: { preco: 1797, consultas: 10,  nome: 'Imobiliário Profissional' },
    premium:      { preco: 3497, consultas: 999, nome: 'Imobiliário Premium' }
  },
  clinica: {
    starter:      { preco: 597,  consultas: 10,  nome: 'Clínica Starter' },
    profissional: { preco: 997,  consultas: 35,  nome: 'Clínica Profissional' },
    premium:      { preco: 1997, consultas: 999, nome: 'Clínica Premium' }
  },
  escola: {
    starter:      { preco: 697,  consultas: 20,  nome: 'Escola Starter' },
    profissional: { preco: 1197, consultas: 60,  nome: 'Escola Profissional' },
    premium:      { preco: 2497, consultas: 999, nome: 'Escola Premium' }
  },
  concessionaria: {
    starter:      { preco: 597,  consultas: 20,  nome: 'Concessionária Starter' },
    profissional: { preco: 1197, consultas: 65,  nome: 'Concessionária Profissional' },
    premium:      { preco: 2497, consultas: 999, nome: 'Concessionária Premium' }
  },
  crediario: {
    starter:      { preco: 397,  consultas: 30,  nome: 'Crediário Starter' },
    profissional: { preco: 797,  consultas: 110, nome: 'Crediário Profissional' },
    premium:      { preco: 1497, consultas: 999, nome: 'Crediário Premium' }
  },
  industrial: {
    starter:      { preco: 797,  consultas: 15,  nome: 'Industrial Starter' },
    profissional: { preco: 1797, consultas: 999, nome: 'Industrial Profissional' },
    premium:      { preco: 3497, consultas: 999, nome: 'Industrial Premium' }
  },
  advocacia: {
    parceiro:     { preco: 597,  consultas: 20,  nome: 'Advocacia Parceiro' },
    parceiro_pro: { preco: 1197, consultas: 999, nome: 'Advocacia Parceiro Pro' }
  }
};

const TAXAS = {
  extrajudicial: { starter: 0.10, profissional: 0.08, premium: 0.07, parceiro: 0.10, parceiro_pro: 0.08 },
  judicial:      { starter: 0.20, profissional: 0.18, premium: 0.15, parceiro: 0.20, parceiro_pro: 0.18 }
};

function buscarPlano(nicho, plano) {
  return PLANOS[nicho]?.[plano] || null;
}

module.exports = { PLANOS, TAXAS, buscarPlano };
