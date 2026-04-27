// Rotas do painel de custos brutos por API (admin)
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { autenticar, admin } = require('./auth');
const { listarCustos, atualizarCusto, calcularCustoPedido, estimarCustoProduto, APIS_POR_PRODUTO } = require('../services/custos');
const { calcularCustoBruto, calcularTodos } = require('../services/custos_apis');
const credifyCatalogo = require('../services/credify/catalogo');

// GET /api/admin/custos/produtos  -> custo bruto / margem de TODOS os produtos
// Referência interna de precificação (catálogo fixo em services/custos_apis.js)
router.get('/produtos', autenticar, admin, (req, res) => {
  try {
    res.json({ produtos: calcularTodos() });
  } catch (e) {
    console.error('[custos] produtos:', e);
    res.status(500).json({ erro: 'Erro ao calcular custos por produto' });
  }
});

// GET /api/admin/custos/produtos/:produtoKey  -> custo bruto / margem de um produto
router.get('/produtos/:produtoKey', autenticar, admin, (req, res) => {
  try {
    const resultado = calcularCustoBruto(req.params.produtoKey);
    if (!resultado) return res.status(404).json({ erro: 'Produto desconhecido' });
    res.json(resultado);
  } catch (e) {
    console.error('[custos] produto:', e);
    res.status(500).json({ erro: 'Erro ao calcular custo do produto' });
  }
});

// GET /api/admin/custos  -> lista todos os custos cadastrados
router.get('/', autenticar, admin, async (req, res) => {
  try {
    const custos = await listarCustos();
    res.json({ custos });
  } catch (e) {
    console.error('[custos] listar:', e);
    res.status(500).json({ erro: 'Erro ao listar custos' });
  }
});

// PUT /api/admin/custos/:chave  -> atualiza valor de um custo
router.put('/:chave', autenticar, admin, async (req, res) => {
  try {
    const { valor_brl, fonte } = req.body;
    await atualizarCusto(req.params.chave, valor_brl, fonte || null);
    res.json({ ok: true });
  } catch (e) {
    console.error('[custos] atualizar:', e);
    res.status(400).json({ erro: e.message || 'Erro ao atualizar custo' });
  }
});

// GET /api/admin/custos/pedido/:id -> custo bruto de um pedido especifico
router.get('/pedido/:id', autenticar, async (req, res) => {
  try {
    // operador e admin podem ver o custo bruto (nunca vai pro cliente)
    const dados = await pool.query(
      'SELECT fonte, dados FROM dados_consulta WHERE pedido_id = $1',
      [req.params.id]
    );
    const resultado = await calcularCustoPedido(dados.rows);
    res.json(resultado);
  } catch (e) {
    console.error('[custos] custo pedido:', e);
    res.status(500).json({ erro: 'Erro ao calcular custo do pedido' });
  }
});

// GET /api/admin/custos/estimativa  -> estimativa de custo para TODOS os produtos
// Usado no /novo-pedido.html para mostrar custo ao lado do preço sugerido
router.get('/estimativa', autenticar, async (req, res) => {
  try {
    const tipos = Object.keys(APIS_POR_PRODUTO);
    const out = {};
    for (const tipo of tipos) {
      out[tipo] = await estimarCustoProduto(tipo);
    }
    res.json({ estimativas: out });
  } catch (e) {
    console.error('[custos] estimativa:', e);
    res.status(500).json({ erro: 'Erro ao calcular estimativas' });
  }
});

// GET /api/admin/custos/estimativa/:tipo  -> estimativa de um produto específico
router.get('/estimativa/:tipo', autenticar, async (req, res) => {
  try {
    const est = await estimarCustoProduto(req.params.tipo);
    if (!est) return res.status(404).json({ erro: 'Produto desconhecido' });
    res.json(est);
  } catch (e) {
    console.error('[custos] estimativa produto:', e);
    res.status(500).json({ erro: 'Erro ao calcular estimativa' });
  }
});

// ─── CATÁLOGO CREDIFY VEICULAR ──────────────────────────────

// GET /api/admin/custos/credify/catalogo  -> catálogo completo agrupado
router.get('/credify/catalogo', autenticar, admin, (req, res) => {
  try {
    const catalogo = credifyCatalogo.listarPorCategoria();
    const padrao = credifyCatalogo.pacotePadraoVeicular();
    const calculoPadrao = credifyCatalogo.calcularCustoBruto(padrao);
    const margem = credifyCatalogo.calcularMargem(97, calculoPadrao.total);
    res.json({
      catalogo,
      pacote_padrao: {
        servicos: padrao,
        ...calculoPadrao,
        margem
      },
      total_servicos: Object.keys(credifyCatalogo.CATALOGO_VEICULAR).length,
      atualizado_em: '2026-04-23',
      faixa: '0 a 10k consultas/mês'
    });
  } catch (e) {
    console.error('[credify] catálogo:', e);
    res.status(500).json({ erro: 'Erro ao listar catálogo Credify' });
  }
});

// GET /api/admin/custos/credify/tiers  -> retorna os 3 tiers comerciais + add-ons
router.get('/credify/tiers', autenticar, admin, (req, res) => {
  try {
    res.json({
      tiers: credifyCatalogo.listarTiers(),
      addons: credifyCatalogo.listarAddons(),
      atualizado_em: '2026-04-23',
      observacao: 'Preços sugeridos (admin pode ajustar por pedido). Custo bruto é INTERNO — nunca vai para o cliente.'
    });
  } catch (e) {
    console.error('[credify] tiers:', e);
    res.status(500).json({ erro: 'Erro ao listar tiers' });
  }
});

// GET /api/admin/custos/credify/tier/:slug  -> retorna detalhes de um tier específico
router.get('/credify/tier/:slug', autenticar, admin, (req, res) => {
  try {
    const tier = credifyCatalogo.obterTier(req.params.slug);
    if (!tier) return res.status(404).json({ erro: 'Tier não encontrado (use: basico, completo ou premium)' });
    res.json(tier);
  } catch (e) {
    console.error('[credify] tier:', e);
    res.status(500).json({ erro: 'Erro ao obter tier' });
  }
});

// POST /api/admin/custos/credify/calcular  -> calcula custo de um pacote sob medida
// body: { servicos: ['HistoricoProprietarios', 'Gravame', ...], preco_venda: 97 }
router.post('/credify/calcular', autenticar, admin, (req, res) => {
  try {
    const { servicos, preco_venda } = req.body || {};
    if (!Array.isArray(servicos)) return res.status(400).json({ erro: 'servicos deve ser array' });
    const calculo = credifyCatalogo.calcularCustoBruto(servicos);
    const resposta = { ...calculo };
    if (typeof preco_venda === 'number' && preco_venda >= 0) {
      resposta.margem = credifyCatalogo.calcularMargem(preco_venda, calculo.total);
    }
    res.json(resposta);
  } catch (e) {
    console.error('[credify] calcular:', e);
    res.status(500).json({ erro: 'Erro ao calcular custo' });
  }
});

module.exports = router;
