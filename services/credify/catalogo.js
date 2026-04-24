// services/credify/catalogo.js
// Catálogo de APIs Credify para consulta veicular — faixa 0 a 10k consultas/mês.
// Valores em R$ (custo bruto pago pela plataforma). NUNCA aparece no PDF do cliente.
// Atualizado conforme tabela recebida em 23/04/2026.
//
// Os valores aqui são REFERÊNCIA INTERNA. O preço cobrado do cliente é definido
// em services/produtos.js (consulta_veicular) e editado pontualmente por pedido.

const CATALOGO_VEICULAR = {
  // ─── IDENTIFICAÇÃO / DECODIFICAÇÃO ───────────────────
  BINNacionalSOnLine: { categoria: 'identificacao', custo: 0.64, descricao: 'Decodificação do chassi — Base Nacional online' },
  DECODIFICAR_CHASSI: { categoria: 'identificacao', custo: 1.23, descricao: 'Decodificação completa do chassi (VIN)', alias: 'DECODIFICAR CHASSI' },
  LOCALIZA_CNH_CPF1: { categoria: 'identificacao', custo: 0.47, descricao: 'Localiza CNH a partir do CPF', alias: 'LOCALIZA CNH CPF1' },
  VeicularBNacional: { categoria: 'identificacao', custo: 0.50, descricao: 'Consulta veicular Base Nacional (batch)' },
  VeicularBNacionalOnLine: { categoria: 'identificacao', custo: 1.17, descricao: 'Consulta veicular Base Nacional em tempo real' },

  // ─── CNH ─────────────────────────────────────────────
  CNHChaveDupla: { categoria: 'cnh', custo: 1.44, descricao: 'Validação CNH por chave dupla' },
  CNHChaveTripla: { categoria: 'cnh', custo: 1.36, descricao: 'Validação CNH por chave tripla' },
  CNHDocumentoAssincrona: { categoria: 'cnh', custo: 1.36, descricao: 'Consulta documento CNH (assíncrona)' },
  CNHDocumentoImagem: { categoria: 'cnh', custo: 0.96, descricao: 'Imagem digitalizada da CNH' },
  CNHPontuacao: { categoria: 'cnh', custo: 0.96, descricao: 'Pontuação atual da CNH' },
  FlagCNH: { categoria: 'cnh', custo: 1.47, descricao: 'Indicadores de irregularidade na CNH' },

  // ─── RESTRIÇÕES / GRAVAMES ──────────────────────────
  Gravame: { categoria: 'restricoes', custo: 2.09, descricao: 'Consulta de gravames (alienação fiduciária, leasing)' },
  Renainf: { categoria: 'restricoes', custo: 0.64, descricao: 'Multas RENAINF (trânsito federal)' },
  RENAJUD: { categoria: 'restricoes', custo: 1.60, descricao: 'Bloqueios judiciais RENAJUD' },

  // ─── HISTÓRICO / PROPRIETÁRIO ───────────────────────
  HistoricoProprietarios: { categoria: 'historico', custo: 8.00, descricao: 'Histórico completo de proprietários do veículo' },
  HistoricoRouboFurto: { categoria: 'historico', custo: 7.31, descricao: 'Histórico de roubo e furto' },
  IndicioSinistroVeicular: { categoria: 'historico', custo: 1.92, descricao: 'Indícios de sinistro (batida, perda total)' },
  LeilaoConjugado: { categoria: 'historico', custo: 13.76, descricao: 'Consulta conjugada em bases de leilão (veículo já foi leiloado?)' },
  PrecificadorFIPE: { categoria: 'historico', custo: 0.57, descricao: 'Valor FIPE do veículo' },
  RecallII: { categoria: 'historico', custo: 0.57, descricao: 'Recalls do fabricante pendentes' },

  // ─── REGISTROS / DETRAN ─────────────────────────────
  Renavam: { categoria: 'registros', custo: 1.06, descricao: 'Dados RENAVAM do veículo' },
  RenavamOnLine: { categoria: 'registros', custo: 1.51, descricao: 'RENAVAM em tempo real' },

  // ─── VEÍCULOS POR CPF/DOCUMENTO ─────────────────────
  VeiculoCPF: { categoria: 'por_cpf', custo: 5.55, descricao: 'Lista veículos vinculados ao CPF' },
  VeiculoDocumentoFrota: { categoria: 'por_cpf', custo: 1.14, descricao: 'Veículos de frota por documento' },
  VeiculoAgregados: { categoria: 'por_cpf', custo: 0.50, descricao: 'Agregados (reboques, carretas)' },
  VeiculoProprietarioPlaca: { categoria: 'por_cpf', custo: 0.64, descricao: 'Proprietário atual por placa' },
  VeiculoProprietarioPlacaHistorico: { categoria: 'por_cpf', custo: 0.85, descricao: 'Histórico de proprietários por placa (variante)' },

  // ─── PACOTES COMBINADOS ─────────────────────────────
  VeiculoEssencial: { categoria: 'pacote', custo: 25.90, descricao: 'Pacote Essencial (combina múltiplas consultas básicas)' },
  VeiculosBDebitosRestricoesProprietario: { categoria: 'pacote', custo: 0.98, descricao: 'Veículos base com débitos, restrições e proprietário', alias: 'Veiculos B. debitos, restrições e proprietario.' },
  VeiculoTotal: { categoria: 'pacote', custo: 31.27, descricao: 'Pacote Total (combina TODAS as consultas disponíveis)' }
};

const CATEGORIAS = {
  identificacao: 'Identificação / Decodificação',
  cnh: 'CNH (Carteira de Habilitação)',
  restricoes: 'Restrições e Gravames',
  historico: 'Histórico / Sinistro / Proprietário',
  registros: 'Registros DETRAN / RENAVAM',
  por_cpf: 'Veículos por CPF / Documento',
  pacote: 'Pacotes Combinados'
};

/**
 * Retorna o catálogo agrupado por categoria, ordenado por nome.
 */
function listarPorCategoria() {
  const out = {};
  for (const [nome, info] of Object.entries(CATALOGO_VEICULAR)) {
    const cat = info.categoria;
    if (!out[cat]) out[cat] = { nome: CATEGORIAS[cat], itens: [] };
    out[cat].itens.push({ servico: info.alias || nome, chave: nome, ...info });
  }
  Object.values(out).forEach(g => g.itens.sort((a, b) => a.servico.localeCompare(b.servico)));
  return out;
}

/**
 * Calcula custo bruto somando serviços selecionados.
 * @param {string[]} servicosSelecionados - nomes dos serviços (chaves do catálogo)
 * @returns {object} { total, detalhamento: [{servico, custo, descricao}], alertas }
 */
function calcularCustoBruto(servicosSelecionados) {
  const detalhamento = [];
  const alertas = [];
  let total = 0;
  (servicosSelecionados || []).forEach(nome => {
    const info = CATALOGO_VEICULAR[nome];
    if (!info) {
      alertas.push(`Serviço '${nome}' não está no catálogo`);
      return;
    }
    total += info.custo;
    detalhamento.push({ servico: info.alias || nome, custo: info.custo, descricao: info.descricao });
  });
  return {
    total: Number(total.toFixed(2)),
    total_formatado: `R$ ${total.toFixed(2).replace('.', ',')}`,
    qtd_servicos: detalhamento.length,
    detalhamento,
    alertas
  };
}

/**
 * Tiers comerciais da Consulta Veicular.
 * Básico (R$ 47) — checagem rápida pré-compra.
 * Completo (R$ 97) — dossiê completo com histórico.
 * Premium (R$ 147) — completo + leilão (único que detecta sinistro grave/salvado).
 *
 * O preco_sugerido é o piso de venda. Admin pode ajustar por pedido.
 * O add_on_leilao permite adicionar LeilaoConjugado ao Básico/Completo por +R$ 29.
 */
const TIERS_VEICULAR = {
  basico: {
    nome: 'Básico',
    slug: 'basico',
    preco_sugerido: 47.00,
    descricao: 'Checagem essencial pré-compra: proprietário, financiamento, multas, bloqueio judicial e FIPE.',
    publico: 'Comprador pessoal fazendo primeira olhada no carro usado',
    servicos: [
      'VeicularBNacionalOnLine',
      'Gravame',
      'Renainf',
      'RENAJUD',
      'PrecificadorFIPE'
    ]
  },
  completo: {
    nome: 'Completo',
    slug: 'completo',
    preco_sugerido: 97.00,
    descricao: 'Dossiê completo: tudo do Básico + histórico de proprietários, roubo/furto, indícios de sinistro e recall.',
    publico: 'Lojistas, despachantes, consultores de compra e compradores sérios',
    servicos: [
      'VeicularBNacionalOnLine',
      'Gravame',
      'Renainf',
      'RENAJUD',
      'PrecificadorFIPE',
      'HistoricoProprietarios',
      'HistoricoRouboFurto',
      'IndicioSinistroVeicular',
      'RecallII'
    ]
  },
  premium: {
    nome: 'Premium',
    slug: 'premium',
    preco_sugerido: 147.00,
    descricao: 'Premium com Leilão: tudo do Completo + consulta em bases de leilão (detecta sinistro grave, salvado e recuperação de seguradora) + decodificação profunda do chassi.',
    publico: 'Compra de alto valor, due diligence judicial, seguradoras, financeiras e quem não pode errar',
    servicos: [
      'VeicularBNacionalOnLine',
      'Gravame',
      'Renainf',
      'RENAJUD',
      'PrecificadorFIPE',
      'HistoricoProprietarios',
      'HistoricoRouboFurto',
      'IndicioSinistroVeicular',
      'RecallII',
      'LeilaoConjugado',
      'DECODIFICAR_CHASSI'
    ]
  }
};

// Add-ons avulsos (itens extras que o admin pode anexar a qualquer tier)
const ADDONS_VEICULAR = {
  leilao: {
    nome: 'Consulta em bases de leilão',
    descricao: 'Detecta se o veículo passou por leilão de sinistro, salvado ou recuperação de seguradora. Item mais valioso para evitar surpresas.',
    preco_adicional: 29.00,
    servicos: ['LeilaoConjugado']
  },
  cnh_proprietario: {
    nome: 'Validação da CNH do proprietário',
    descricao: 'Valida a CNH do atual proprietário (pontuação + flags de irregularidade).',
    preco_adicional: 15.00,
    servicos: ['CNHPontuacao', 'FlagCNH']
  },
  veiculos_por_cpf: {
    nome: 'Outros veículos do proprietário',
    descricao: 'Lista todos os veículos vinculados ao CPF do proprietário. Útil em investigação patrimonial.',
    preco_adicional: 19.00,
    servicos: ['VeiculoCPF']
  }
};

/**
 * Retorna a configuração de um tier, incluindo cálculo de custo e margem.
 * @param {string} slug - 'basico' | 'completo' | 'premium'
 * @returns {object|null}
 */
function obterTier(slug) {
  const tier = TIERS_VEICULAR[slug];
  if (!tier) return null;
  const calc = calcularCustoBruto(tier.servicos);
  const margem = calcularMargem(tier.preco_sugerido, calc.total);
  return { ...tier, ...calc, margem };
}

/**
 * Lista os 3 tiers com custo, margem e descrição pronta para UI.
 */
function listarTiers() {
  return Object.keys(TIERS_VEICULAR).map(slug => obterTier(slug));
}

/**
 * Lista add-ons disponíveis com custo calculado.
 */
function listarAddons() {
  return Object.entries(ADDONS_VEICULAR).map(([slug, addon]) => {
    const calc = calcularCustoBruto(addon.servicos);
    return {
      slug,
      ...addon,
      custo_bruto: calc.total,
      margem: calcularMargem(addon.preco_adicional, calc.total)
    };
  });
}

/**
 * Compat: mantém pacotePadraoVeicular() apontando para o Completo.
 */
function pacotePadraoVeicular() {
  return [...TIERS_VEICULAR.completo.servicos];
}

/**
 * Margem do pedido: venda - custo bruto.
 */
function calcularMargem(precoVenda, custoBruto) {
  const margem = Number((precoVenda - custoBruto).toFixed(2));
  const pct = precoVenda > 0 ? Number(((margem / precoVenda) * 100).toFixed(1)) : 0;
  return { margem, margem_pct: pct, preco_venda: precoVenda, custo_bruto: custoBruto };
}

module.exports = {
  CATALOGO_VEICULAR,
  CATEGORIAS,
  TIERS_VEICULAR,
  ADDONS_VEICULAR,
  listarPorCategoria,
  listarTiers,
  listarAddons,
  obterTier,
  calcularCustoBruto,
  pacotePadraoVeicular,
  calcularMargem
};
