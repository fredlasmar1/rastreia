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
//
// V3: para Due Diligence Imobiliária podem haver até 5 alvos. Cada alvo extra
// usa sufixo _N (receita_federal_2, processos_3, …). Removemos o sufixo aqui
// para reaproveitar as mesmas regras de mapeamento.
function chavesPorFonte(fonte, dados) {
  const c = [];
  // Remove sufixo _N (ex: receita_federal_3 → receita_federal). Funciona para qualquer N.
  const fonteCanon = String(fonte || '').replace(/_(\d+)$/, '');
  const ok = dados && dados.disponivel !== false && !dados.erro;
  switch (fonteCanon) {
    case 'receita_federal':
      // PJ usa CNPJa (grátis), PF usa DirectData Plus
      if (dados?.tipo === 'PJ' || dados?.razao_social) c.push('cnpja');
      else if (dados?.nome) c.push('directd_pf_plus');
      break;
    case 'processos':
      // Direct Data é a fonte primária; Escavador é a 2ª opção; Datajud (grátis) o fallback
      if (dados?.fonte?.toLowerCase().includes('direct data')) c.push('directd_processos');
      else if (dados?.fonte?.toLowerCase().includes('escavador')) c.push('escavador_processos');
      else if (dados?.fonte?.toLowerCase().includes('datajud')) c.push('datajud');
      break;
    case 'score_credito':
      if (dados?.score !== undefined && dados?.score !== null) c.push('directd_score_quod');
      break;
    case 'negativacoes':
      if (dados?.status !== undefined) c.push('directd_negativacoes');
      // A Boa Vista (PF/PJ) é decidida em calcularCustoPedido, que sabe o tipo do alvo.
      break;
    case 'protestos':
      if (ok) c.push('directd_protestos');
      break;
    case 'perfil_economico':
      if (ok) c.push('directd_perfil_economico');
      break;
    case 'vinculos':
      // Quando VinculosSocietarios falha, os dados vêm do AML — mas a chamada foi feita.
      if (dados) c.push('directd_vinculos');
      break;
    case 'aml':
      if (dados) c.push('directd_aml');
      break;
    case 'veiculos':
      // consultarVeiculos = InfoSimples DETRAN-GO (não é a Consulta Veicular por placa)
      if (dados) c.push('infosimples_detran_go');
      break;
    case 'historico_veiculos_proprietario':
      if (dados) c.push('directd_historico_veiculos');
      break;
    case 'imoveis_rurais':
      if (ok) c.push('infosimples_sigef');
      break;
    case 'veiculo_placa':
      if (dados && dados.disponivel !== false) c.push('directd_veiculos');
      break;
    case 'proprietarios_placa':
      // Credify roda em paralelo mesmo no tier Básico (o resultado vem null, mas é pago)
      c.push('credify_historico_proprietario');
      break;
    case 'pgfn': case 'cndt': case 'fgts': case 'inpi': case 'inpi_patentes': case 'ceis': case 'cepim':
      if (dados) c.push('infosimples_certidao');
      break;
    case 'socios_enriquecidos':
      if (Array.isArray(dados) && dados.length) {
        c.push('directd_qsa_pj');
        for (const s of dados) {
          if (s?.tem_cpf) c.push('directd_pf_plus', 'directd_score_quod', 'directd_processos');
        }
      }
      break;
    case 'transparencia':
      if (dados && dados.disponivel !== false) c.push('transparencia');
      break;
    case 'analise_ia_imovel':
      // Marcador artificial: emitido em calcularCustoPedido() abaixo
      // sempre que o pedido tiver análise IA concluída.
      if (dados?.concluida) c.push('claude_analise_imovel');
      break;
  }
  // Pacotes Credify (consulta_veicular_simples/mediana/completa): a linha `pacote` diz qual foi.
  if (fonteCanon === 'pacote' && typeof dados === 'string') {
    const k = { simples: 'credify_pacote_simples', mediana: 'credify_pacote_mediana', completa: 'credify_pacote_completa' }[dados];
    if (k) c.push(k);
  }
  return c;
}

// Calcula o custo bruto de um pedido a partir das linhas dados_consulta.
// rows: array de { fonte, dados } (dados em JSONB ou objeto parseado)
async function calcularCustoPedido(rows) {
  const tabela = await mapaCustos();
  const breakdown = [];
  let total = 0;
  const parsed = rows.map(r => ({ fonte: r.fonte, dados: typeof r.dados === 'string' ? JSON.parse(r.dados) : r.dados }));
  const sufixo = (f) => (String(f).match(/_(\d+)$/) || [, ''])[1];
  // Tipo de cada alvo (PF/PJ) pela linha receita_federal do mesmo sufixo
  const ehPJ = {};
  for (const { fonte, dados } of parsed) {
    if (String(fonte).replace(/_(\d+)$/, '') === 'receita_federal') {
      ehPJ[sufixo(fonte)] = !!(dados?.tipo === 'PJ' || dados?.razao_social);
    }
  }
  const add = (fonte, chave) => {
    const valor = tabela[chave] ?? 0;
    breakdown.push({ fonte, api: chave, valor_brl: valor });
    total += valor;
  };
  // Boa Vista: uma cobrança por alvo (negativações e o add-on usam a mesma chamada em cache)
  const bvContada = new Set();
  for (const { fonte, dados } of parsed) {
    for (const chave of chavesPorFonte(fonte, dados)) add(fonte, chave);
    const canon = String(fonte).replace(/_(\d+)$/, '');
    const s = sufixo(fonte);
    const chamouBV = (canon === 'negativacoes' && (dados?.boa_vista_consultada || /boa vista/i.test(dados?.fonte || '')))
      || (canon === 'boa_vista' && dados && dados.disponivel !== false);
    if (chamouBV && !bvContada.has(s)) {
      bvContada.add(s);
      add(fonte, ehPJ[s] ? 'directd_boa_vista_pj' : 'directd_boa_vista');
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
// TABELA CHEIA: tudo o que o pipeline pode chamar num pedido normal, inclusive
// a Boa Vista (disparada quando há pendência). Fallbacks (Escavador, cpfcnpj) ficam fora.
const BASE_PF = ['directd_pf_plus', 'directd_processos', 'directd_score_quod', 'directd_negativacoes', 'directd_boa_vista', 'directd_perfil_economico'];
const BASE_PJ = ['cnpja', 'directd_processos', 'directd_score_quod', 'directd_negativacoes', 'directd_boa_vista_pj', 'transparencia'];
const PATRIMONIAL = ['directd_vinculos', 'directd_aml', 'infosimples_detran_go', 'directd_historico_veiculos', 'infosimples_sigef'];
const SOCIO = ['directd_pf_plus', 'directd_score_quod', 'directd_processos']; // por sócio com CPF
const APIS_POR_PRODUTO = {
  // Nome Limpo ou Sujo: sem a Boa Vista (sem lista nominal de credores)
  consulta_restricoes: ['directd_pf_plus', 'directd_score_quod', 'directd_negativacoes', 'directd_protestos'],
  analise_inquilino: BASE_PF,
  dossie_pf: BASE_PF,
  dossie_pj: BASE_PJ,
  analise_devedor: [...BASE_PF, ...PATRIMONIAL],
  investigacao_patrimonial: [...BASE_PF, ...PATRIMONIAL],
  // Due Diligence Empresarial: base PJ + vínculos/AML + 7 certidões InfoSimples + QSA + 2 sócios
  due_diligence: [...BASE_PJ, 'directd_vinculos', 'directd_aml',
    ...Array(7).fill('infosimples_certidao'), 'directd_qsa_pj', ...SOCIO, ...SOCIO],
  // Due Diligence Imobiliária: comprador + vendedor, cada um com o conjunto patrimonial, + IA
  due_diligence_imobiliaria: [...BASE_PF, ...PATRIMONIAL, ...BASE_PF, ...PATRIMONIAL, 'claude_analise_imovel'],
  // Veicular legado (tiers): placa + Credify histórico (pago mesmo no Básico) + histórico por CPF
  consulta_veicular: ['directd_veiculos', 'credify_historico_proprietario', 'directd_historico_veiculos'],
  consulta_veicular_simples: ['credify_pacote_simples'],
  consulta_veicular_mediana: ['credify_pacote_mediana'],
  consulta_veicular_completa: ['credify_pacote_completa']
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
