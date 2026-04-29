// ─────────────────────────────────────────────
// CUSTO BRUTO DAS APIS POR PRODUTO (REFERÊNCIA INTERNA)
//
// Catálogo de preços unitários das APIs consumidas por produto,
// usado apenas como referência para o admin negociar o preço de venda.
// NUNCA exibido para o cliente final.
//
// Fonte dos valores: Catálogo DirectData v4.1 (2026) + preços
// públicos de Escavador, InfoSimples e Portal da Transparência.
// ─────────────────────────────────────────────

const { PRODUTOS } = require('./produtos');

// Preço unitário (R$) por chamada de API
const CUSTOS_APIS = {
  // DirectData
  directdata_cpf_plus: 0.36,          // CadastroPessoaFisicaPlus
  directdata_cnpj_plus: 0.36,         // CadastroPessoaJuridicaPlus
  directdata_score_quod: 0.72,        // Score de Crédito – QUOD (PF/PJ)
  directdata_negativacoes: 2.38,      // Detalhamento Negativo (PF/PJ)
  directdata_apontamentos_bv: 3.50,   // Boa Vista Acerta Completo (PF) / Define Limite (PJ) — lista de credores
  directdata_protestos: 0.72,         // Protestos Nacional (Base)
  directdata_nivel_socio: 0.36,       // Nível Socioeconômico e Renda (PF)
  directdata_vinculos: 1.84,          // Vínculos Societários (PF e PJ)
  directdata_obito: 0.36,             // Óbito (PF)

  // Escavador
  escavador_processos: 4.50,          // bloco inicial (+R$ 0,05 a cada 200 itens extras)

  // InfoSimples (DETRAN-GO veículo)
  infosimples_detran_veiculo: 0.26,   // 0,06 + base 0,20

  // Gratuitos / mensalidade fixa
  portal_transparencia: 0.00,         // CEIS/CNEP
  datajud_cnj: 0.00,
  cnpjws_publico: 0.00,
  cnpja_assinatura: 0.00              // mensalidade fixa, não por chamada
};

// Rótulos amigáveis exibidos no detalhamento
const ROTULOS_APIS = {
  directdata_cpf_plus: 'DirectData — Cadastro PF Plus',
  directdata_cnpj_plus: 'DirectData — Cadastro PJ Plus',
  directdata_score_quod: 'DirectData — Score QUOD',
  directdata_negativacoes: 'DirectData — Detalhamento Negativo',
  directdata_apontamentos_bv: 'DirectData — Boa Vista Acerta/Define Limite (apontamentos)',
  directdata_protestos: 'DirectData — Protestos Nacional',
  directdata_nivel_socio: 'DirectData — Nível Socioeconômico',
  directdata_vinculos: 'DirectData — Vínculos Societários',
  directdata_obito: 'DirectData — Óbito',
  escavador_processos: 'Escavador — Processos',
  infosimples_detran_veiculo: 'InfoSimples — DETRAN Veículo',
  portal_transparencia: 'Portal da Transparência (CEIS/CNEP)',
  datajud_cnj: 'Datajud CNJ',
  cnpjws_publico: 'CNPJ.ws (público)',
  cnpja_assinatura: 'CNPJá (assinatura mensal)'
};

// Mapa produto → APIs consumidas (levantamento técnico do sistema)
const APIS_POR_PRODUTO = {
  dossie_pf: [
    'directdata_cpf_plus',
    'directdata_score_quod',
    'directdata_negativacoes',
    'directdata_nivel_socio',
    'directdata_obito',
    'escavador_processos',
    'portal_transparencia',
    'datajud_cnj'
  ],
  dossie_pj: [
    'directdata_cnpj_plus',
    'directdata_score_quod',
    'directdata_negativacoes',
    'directdata_protestos',
    'directdata_vinculos',
    'escavador_processos',
    'portal_transparencia',
    'datajud_cnj'
  ],
  due_diligence: [
    // dossie_pf
    'directdata_cpf_plus',
    'directdata_score_quod',
    'directdata_negativacoes',
    'directdata_nivel_socio',
    'directdata_obito',
    'escavador_processos',
    // dossie_pj
    'directdata_cnpj_plus',
    'directdata_protestos',
    'directdata_vinculos',
    // comuns
    'portal_transparencia',
    'datajud_cnj'
  ],
  analise_devedor: [
    'directdata_cpf_plus',
    'directdata_negativacoes',
    'directdata_protestos',
    'escavador_processos'
  ],
  due_diligence_imobiliaria: [
    'directdata_cpf_plus',
    'directdata_cnpj_plus',
    'directdata_negativacoes',
    'directdata_vinculos',
    'infosimples_detran_veiculo',
    'escavador_processos',
    'portal_transparencia'
  ],
  investigacao_patrimonial: [
    'directdata_cpf_plus',
    'directdata_vinculos',
    'directdata_nivel_socio',
    'infosimples_detran_veiculo',
    'escavador_processos',
    'portal_transparencia',
    'datajud_cnj'
  ],
  consulta_restricoes: [
    // Apenas Direct Data — produto leve focado em restrições financeiras.
    'directdata_cpf_plus',          // identificação básica + situação RF
    'directdata_score_quod',        // score QUOD com faixa
    'directdata_negativacoes',      // SCPC/Serasa via DirectData (Detalhamento Negativo)
    'directdata_apontamentos_bv',   // lista detalhada de credores (Boa Vista Acerta/Define Limite)
    'directdata_protestos'          // protestos em cartório
  ]
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Calcula o custo bruto e a margem para um produto específico
function calcularCustoBruto(produtoKey) {
  const apis = APIS_POR_PRODUTO[produtoKey];
  if (!apis) return null;

  const produto = PRODUTOS[produtoKey];
  const precoVenda = produto?.preco || 0;

  const detalhes = apis.map(api => ({
    api,
    rotulo: ROTULOS_APIS[api] || api,
    preco: CUSTOS_APIS[api] ?? 0
  }));

  const custoBruto = round2(detalhes.reduce((acc, d) => acc + d.preco, 0));
  const margem = round2(precoVenda - custoBruto);
  const margemPct = precoVenda > 0 ? round2((margem / precoVenda) * 100) : 0;

  return {
    produtoKey,
    nome: produto?.nome || produtoKey,
    precoVenda,
    custoBruto,
    margem,
    margemPct,
    detalhes
  };
}

// Calcula para todos os produtos do catálogo
function calcularTodos() {
  return Object.keys(APIS_POR_PRODUTO)
    .map(calcularCustoBruto)
    .filter(Boolean);
}

module.exports = {
  CUSTOS_APIS,
  ROTULOS_APIS,
  APIS_POR_PRODUTO,
  calcularCustoBruto,
  calcularTodos
};
