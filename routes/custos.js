// Rotas do painel de custos brutos por API (admin)
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { autenticar, admin } = require('./auth');
const { listarCustos, atualizarCusto, calcularCustoPedido } = require('../services/custos');

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

module.exports = router;
