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
 * Sugere pacote padrão para um dossiê veicular (R$ 97 venda).
 * Inclui as consultas mínimas que o mercado exige para dossiê sério.
 */
function pacotePadraoVeicular() {
  return [
    'VeicularBNacionalOnLine',      // identificação
    'Gravame',                       // alienação
    'Renainf',                       // multas
    'RENAJUD',                       // bloqueio judicial
    'HistoricoProprietarios',        // histórico proprietários (Credify)
    'HistoricoRouboFurto',           // roubo/furto
    'IndicioSinistroVeicular',       // sinistro
    'RecallII',                      // recall
    'PrecificadorFIPE'               // FIPE
  ];
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
  listarPorCategoria,
  calcularCustoBruto,
  pacotePadraoVeicular,
  calcularMargem
};
