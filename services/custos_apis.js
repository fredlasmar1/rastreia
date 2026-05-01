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

  // InfoSimples — Due Diligence Empresarial (estimativa ~R$ 0,80/consulta)
  infosimples_cnd_federal: 0.80,
  infosimples_cnd_estadual: 0.80,
  infosimples_cnd_municipal: 0.80,
  infosimples_cndt: 0.80,
  infosimples_fgts: 0.80,
  infosimples_inpi: 0.80,
  infosimples_veiculos_pj: 0.80,

  // Gratuitos / mensalidade fixa
  portal_transparencia: 0.00,         // CEIS/CNEP
  portal_transparencia_contratos: 0.00, // contratos públicos (gov.br)
  datajud_cnj: 0.00,
  cnpjws_publico: 0.00,
  cnpja_assinatura: 0.00,             // mensalidade fixa, não por chamada

  // Credify — Consulta Veicular (catálogo 23/04/2026)
  credify_veicular_bnacional_online: 1.17,   // VeicularBNacionalOnLine
  credify_gravame: 2.09,                     // Gravame
  credify_renainf: 0.64,                     // Renainf
  credify_renajud: 1.60,                     // RENAJUD
  credify_historico_proprietarios: 8.00,     // HistoricoProprietarios
  credify_indicio_sinistro: 1.92,            // IndicioSinistroVeicular
  credify_veiculo_total: 31.27               // VeiculoTotal (pacote)
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
  infosimples_cnd_federal: 'InfoSimples — CND Federal (PGFN/RFB)',
  infosimples_cnd_estadual: 'InfoSimples — CND Estadual (SEFAZ)',
  infosimples_cnd_municipal: 'InfoSimples — CND Municipal (Prefeitura)',
  infosimples_cndt: 'InfoSimples — CND Trabalhista (TST/CNDT)',
  infosimples_fgts: 'InfoSimples — Regularidade FGTS (Caixa)',
  infosimples_inpi: 'InfoSimples — Marcas e Patentes (INPI)',
  infosimples_veiculos_pj: 'InfoSimples — Veículos PJ (DETRAN)',
  portal_transparencia: 'Portal da Transparência (CEIS/CNEP)',
  portal_transparencia_contratos: 'Portal da Transparência — Contratos públicos',
  datajud_cnj: 'Datajud CNJ',
  cnpjws_publico: 'CNPJ.ws (público)',
  cnpja_assinatura: 'CNPJá (assinatura mensal)',
  credify_veicular_bnacional_online: 'Credify — Veicular Base Nacional (online)',
  credify_gravame: 'Credify — Gravame',
  credify_renainf: 'Credify — Renainf (multas)',
  credify_renajud: 'Credify — RENAJUD',
  credify_historico_proprietarios: 'Credify — Histórico de Proprietários',
  credify_indicio_sinistro: 'Credify — Indício de Sinistro',
  credify_veiculo_total: 'Credify — VeiculoTotal (pacote completo)'
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
    // PJ — alvo principal
    'directdata_cnpj_plus',
    'directdata_score_quod',
    'directdata_negativacoes',
    'directdata_apontamentos_bv',
    'directdata_protestos',
    'directdata_vinculos',
    'escavador_processos',
    'portal_transparencia',
    'datajud_cnj',
    // Sócios (cruzamento PF — assume 2 sócios médios)
    'directdata_cpf_plus',
    'directdata_score_quod',
    'directdata_negativacoes',
    'directdata_nivel_socio',
    'directdata_obito',
    'escavador_processos',
    // Novas fontes InfoSimples para DD Empresarial
    'infosimples_cnd_federal',
    'infosimples_cnd_estadual',
    'infosimples_cnd_municipal',
    'infosimples_cndt',
    'infosimples_fgts',
    'infosimples_inpi',
    'infosimples_veiculos_pj',
    'portal_transparencia_contratos'
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
  ],
  // Consulta Veicular — apenas Credify (regra inviolável)
  consulta_veicular_simples: [
    'credify_veicular_bnacional_online',
    'credify_gravame',
    'credify_renainf'
  ],
  consulta_veicular_mediana: [
    'credify_veicular_bnacional_online',
    'credify_gravame',
    'credify_renainf',
    'credify_renajud',
    'credify_historico_proprietarios',
    'credify_indicio_sinistro'
  ],
  consulta_veicular_completa: [
    'credify_veiculo_total'
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
