// ─────────────────────────────────────────────
// CUSTO BRUTO POR PEDIDO
// Lê a tabela api_custos + inspeciona dados_consulta
// para calcular exatamente quais APIs foram chamadas em cada pedido.
// Valores são editáveis pelo admin em /custos-api.html.
// NUNCA aparece no PDF do cliente — só no painel admin/operador.
// ─────────────────────────────────────────────

const { pool } = require('../db');

// Lista todos os custos cadastrados (para a tela admin)
async function listarCustos() {
  const r = await pool.query('SELECT chave, rotulo, valor_brl, fonte, confianca, atualizado_em FROM api_custos ORDER BY rotulo');
  return r.rows.map(row => ({
    ...row,
    valor_brl: Number(row.valor_brl)
  }));
}

// Atualiza o valor de um custo (admin)
// Marca confianca='manual' para que o seed do schema.sql nao sobrescreva no proximo boot
async function atualizarCusto(chave, valor_brl, fonte = null) {
  const v = Number(valor_brl);
  if (!isFinite(v) || v < 0) throw new Error('Valor inválido');
  await pool.query(
    `UPDATE api_custos
        SET valor_brl = $1,
            fonte = COALESCE($2, fonte),
            confianca = 'manual',
            atualizado_em = NOW()
      WHERE chave = $3`,
    [v, fonte, chave]
  );
}

// Retorna {chave: valor} para lookup rápido
async function mapaCustos() {
  const r = await pool.query('SELECT chave, valor_brl FROM api_custos');
  return Object.fromEntries(r.rows.map(x => [x.chave, Number(x.valor_brl)]));
}

// Mapa: fonte dos dados_consulta  →  chave(s) api_custos que foram efetivamente chamadas
// Algumas fontes disparam várias APIs (ex: DirectData PF Plus também chama cadastro base)
function chavesPorFonte(fonte, dados) {
  const c = [];
  switch (fonte) {
    case 'receita_federal':
      // PJ usa CNPJa (grátis), PF usa DirectData Plus
      if (dados?.tipo === 'PJ' || dados?.razao_social) c.push('cnpja');
      else if (dados?.nome) c.push('directd_pf_plus');
      break;
    case 'processos':
      // Escavador é a fonte primária; Datajud só se Escavador falhou
      if (dados?.fonte?.toLowerCase().includes('escavador')) c.push('escavador_processos');
      else if (dados?.fonte?.toLowerCase().includes('datajud')) c.push('datajud');
      break;
    case 'score_credito':
      if (dados?.score !== undefined && dados?.score !== null) c.push('directd_score_quod');
      break;
    case 'negativacoes':
      if (dados?.status !== undefined) c.push('directd_negativacoes');
      break;
    case 'perfil_economico':
      if (dados && !dados.erro) c.push('directd_perfil_economico');
      break;
    case 'vinculos':
      if (dados?.total > 0 || dados?.socios || dados?.empresas) c.push('directd_vinculos');
      break;
    case 'veiculos':
      if (dados?.total > 0 || dados?.veiculos) c.push('directd_veiculos');
      break;
    case 'veiculo_placa':
      if (dados && dados.disponivel !== false) c.push('directd_veiculos');
      break;
    case 'transparencia':
      if (dados && dados.disponivel !== false) c.push('transparencia');
      break;
    // Alvos secundários (due diligence imobiliaria)
    case 'receita_federal_2':
      if (dados?.tipo === 'PJ' || dados?.razao_social) c.push('cnpja');
      else if (dados?.nome) c.push('directd_pf_plus');
      break;
    case 'processos_2':
      if (dados?.fonte?.toLowerCase().includes('escavador')) c.push('escavador_processos');
      else if (dados?.fonte?.toLowerCase().includes('datajud')) c.push('datajud');
      break;
    case 'score_credito_2':
      if (dados?.score !== undefined && dados?.score !== null) c.push('directd_score_quod');
      break;
    case 'negativacoes_2':
      if (dados?.status !== undefined) c.push('directd_negativacoes');
      break;
    case 'vinculos_2':
      if (dados?.total > 0) c.push('directd_vinculos');
      break;
    case 'analise_ia_imovel':
      // Marcador artificial: emitido em calcularCustoPedido() abaixo
      // sempre que o pedido tiver análise IA concluída.
      if (dados?.concluida) c.push('claude_analise_imovel');
      break;
  }
  return c;
}

// Calcula o custo bruto de um pedido a partir das linhas dados_consulta.
// rows: array de { fonte, dados } (dados em JSONB ou objeto parseado)
async function calcularCustoPedido(rows) {
  const tabela = await mapaCustos();
  const breakdown = [];
  let total = 0;
  for (const row of rows) {
    const dados = typeof row.dados === 'string' ? JSON.parse(row.dados) : row.dados;
    const chaves = chavesPorFonte(row.fonte, dados);
    for (const chave of chaves) {
      const valor = tabela[chave] ?? 0;
      breakdown.push({ fonte: row.fonte, api: chave, valor_brl: valor });
      total += valor;
    }
  }
  return {
    total_brl: Math.round(total * 10000) / 10000,
    breakdown
  };
}

// Mapa: tipo de produto → APIs que serão consumidas em um cenário típico.
// Usado para ESTIMATIVA antes da consulta rodar (exibido no /novo-pedido.html).
// Os valores reais são calculados em calcularCustoPedido() após a consulta.
const APIS_POR_PRODUTO = {
  dossie_pf: ['directd_pf_plus', 'escavador_processos', 'directd_score_quod', 'directd_negativacoes', 'transparencia'],
  dossie_pj: ['cnpja', 'escavador_processos', 'directd_negativacoes', 'transparencia'],
  due_diligence: ['cnpja', 'escavador_processos', 'directd_negativacoes', 'directd_perfil_economico', 'directd_vinculos', 'transparencia'],
  analise_devedor: ['directd_pf_plus', 'escavador_processos', 'directd_negativacoes', 'directd_veiculos', 'directd_vinculos'],
  investigacao_patrimonial: ['directd_pf_plus', 'escavador_processos', 'directd_vinculos', 'directd_veiculos', 'infosimples_detran_go'],
  due_diligence_imobiliaria: [
    'directd_pf_plus', 'escavador_processos', 'directd_score_quod', 'directd_negativacoes', // comprador
    'directd_pf_plus', 'escavador_processos', 'directd_negativacoes', 'directd_veiculos', 'directd_vinculos', // vendedor
    'onr_matricula', // imóvel
    'claude_analise_imovel' // análise IA matrícula+escritura via Claude Sonnet 4.5
  ],
  consulta_veicular: ['directd_veiculos']
};

async function estimarCustoProduto(tipo) {
  const chaves = APIS_POR_PRODUTO[tipo];
  if (!chaves) return null;
  const tabela = await mapaCustos();
  const breakdown = [];
  let total = 0;
  // Agrega chaves repetidas (ex: imobiliária chama directd_pf_plus 2x)
  const contador = {};
  for (const c of chaves) contador[c] = (contador[c] || 0) + 1;
  for (const [chave, qtd] of Object.entries(contador)) {
    const valor_unit = tabela[chave] ?? 0;
    const valor = valor_unit * qtd;
    breakdown.push({ api: chave, qtd, valor_unit, valor_brl: valor });
    total += valor;
  }
  return {
    total_brl: Math.round(total * 10000) / 10000,
    breakdown
  };
}

module.exports = { listarCustos, atualizarCusto, mapaCustos, calcularCustoPedido, estimarCustoProduto, APIS_POR_PRODUTO };
