const express = require('express');
const router = express.Router();
const { autenticar } = require('./auth');
const { pool } = require('../db');
const { executarConsultaCompleta } = require('../services/consultas');
const { gerarDossie } = require('../services/pdf');
const { notificarClienteConcluido, notificarOperadorNovoPedido } = require('../services/whatsapp');

const PRECOS = {
  dossie_pf: 197,
  dossie_pj: 397,
  due_diligence: 997,
  analise_devedor: 250,
  investigacao_patrimonial: 497
};

const PRAZOS = {
  dossie_pf: 2,
  dossie_pj: 2,
  due_diligence: 24,
  analise_devedor: 2,
  investigacao_patrimonial: 4
};

// Listar pedidos
router.get('/', autenticar, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    let query = 'SELECT p.*, u.nome as operador_nome FROM pedidos p LEFT JOIN usuarios u ON p.operador_id = u.id';
    const params = [];
    if (status) { query += ' WHERE p.status = $1'; params.push(status); }
    query += ' ORDER BY p.criado_em DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, (page - 1) * limit);
    const result = await pool.query(query, params);
    const count = await pool.query('SELECT COUNT(*) FROM pedidos' + (status ? ' WHERE status = $1' : ''), status ? [status] : []);
    res.json({ pedidos: result.rows, total: parseInt(count.rows[0].count), page: parseInt(page) });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Criar pedido (link de pagamento gerado manualmente ou via MP)
router.post('/', autenticar, async (req, res) => {
  try {
    const { tipo, cliente_nome, cliente_email, cliente_whatsapp, alvo_nome, alvo_documento, alvo_tipo } = req.body;
    if (!tipo || !cliente_nome || !alvo_nome || !alvo_documento) {
      return res.status(400).json({ erro: 'Campos obrigatórios: tipo, cliente_nome, alvo_nome, alvo_documento' });
    }
    const valor = PRECOS[tipo];
    if (!valor) return res.status(400).json({ erro: 'Tipo inválido' });

    const prazoHoras = PRAZOS[tipo] || 2;
    const prazo = new Date(Date.now() + prazoHoras * 60 * 60 * 1000);

    const result = await pool.query(
      `INSERT INTO pedidos (tipo, status, cliente_nome, cliente_email, cliente_whatsapp, alvo_nome, alvo_documento, alvo_tipo, valor, prazo_entrega, operador_id)
       VALUES ($1, 'aguardando_pagamento', $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [tipo, cliente_nome, cliente_email, cliente_whatsapp, alvo_nome, alvo_documento, alvo_tipo, valor, prazo, req.usuario.id]
    );

    const pedido = result.rows[0];
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao) VALUES ($1, $2, $3)', [pedido.id, req.usuario.id, 'Pedido criado']);

    res.json(pedido);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Buscar pedido por ID
router.get('/:id', autenticar, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT p.*, u.nome as operador_nome FROM pedidos p LEFT JOIN usuarios u ON p.operador_id = u.id WHERE p.id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Pedido não encontrado' });
    const dados = await pool.query('SELECT * FROM dados_consulta WHERE pedido_id = $1', [req.params.id]);
    res.json({ ...result.rows[0], dados: dados.rows });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Marcar como pago (manual ou via webhook)
router.patch('/:id/pago', autenticar, async (req, res) => {
  try {
    const { mp_payment_id } = req.body;
    await pool.query(
      `UPDATE pedidos SET status = 'pago', pago_em = NOW(), mp_payment_id = $1, atualizado_em = NOW() WHERE id = $2`,
      [mp_payment_id || 'manual', req.params.id]
    );
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao) VALUES ($1, $2, $3)',
      [req.params.id, req.usuario.id, 'Pagamento confirmado']);
    const p = await pool.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
    await notificarOperadorNovoPedido(p.rows[0]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Iniciar análise (operador clica em "Iniciar")
router.patch('/:id/iniciar', autenticar, async (req, res) => {
  try {
    await pool.query(
      `UPDATE pedidos SET status = 'em_andamento', iniciado_em = NOW(), operador_id = $1, atualizado_em = NOW() WHERE id = $2`,
      [req.usuario.id, req.params.id]
    );
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao) VALUES ($1, $2, $3)',
      [req.params.id, req.usuario.id, 'Análise iniciada']);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Executar consultas automáticas
router.post('/:id/consultar', autenticar, async (req, res) => {
  try {
    const pResult = await pool.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
    if (pResult.rows.length === 0) return res.status(404).json({ erro: 'Pedido não encontrado' });
    const pedido = pResult.rows[0];

    // Orquestrador: executa todas as fontes em paralelo
    const resultados = await executarConsultaCompleta(pedido);

    // Salva cada fonte no banco
    for (const [fonte, dados] of Object.entries(resultados)) {
      await pool.query(
        'INSERT INTO dados_consulta (pedido_id, fonte, dados) VALUES ($1, $2, $3)',
        [pedido.id, fonte, JSON.stringify(dados)]
      );
    }

    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao) VALUES ($1, $2, $3)',
      [pedido.id, req.usuario.id, 'Consultas automáticas executadas (Direct Data + Datajud CNJ + CNPJá + Transparência)']);

    res.json({ ok: true, resultados });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Gerar PDF e concluir
router.post('/:id/concluir', autenticar, async (req, res) => {
  try {
    const { observacoes } = req.body;
    const pResult = await pool.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
    const pedido = pResult.rows[0];
    const dadosResult = await pool.query('SELECT * FROM dados_consulta WHERE pedido_id = $1', [pedido.id]);

    if (observacoes) {
      await pool.query('UPDATE pedidos SET observacoes = $1 WHERE id = $2', [observacoes, pedido.id]);
      pedido.observacoes = observacoes;
    }

    const { url } = await gerarDossie(pedido, dadosResult.rows);
    await pool.query(
      `UPDATE pedidos SET status = 'concluido', concluido_em = NOW(), relatorio_url = $1, atualizado_em = NOW() WHERE id = $2`,
      [url, pedido.id]
    );
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao) VALUES ($1, $2, $3)',
      [pedido.id, req.usuario.id, 'Relatório gerado e pedido concluído']);

    await notificarClienteConcluido(pedido, url);

    res.json({ ok: true, url });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Salvar dados manuais
router.post('/:id/dados', autenticar, async (req, res) => {
  try {
    const { fonte, dados } = req.body;
    await pool.query(
      'INSERT INTO dados_consulta (pedido_id, fonte, dados) VALUES ($1, $2, $3)',
      [req.params.id, fonte, JSON.stringify(dados)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Dashboard stats
router.get('/dashboard/stats', autenticar, async (req, res) => {
  try {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const [total, hoje_count, em_andamento, concluidos, receita] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM pedidos'),
      pool.query('SELECT COUNT(*) FROM pedidos WHERE criado_em >= $1', [hoje]),
      pool.query("SELECT COUNT(*) FROM pedidos WHERE status IN ('pago', 'em_andamento')"),
      pool.query("SELECT COUNT(*) FROM pedidos WHERE status = 'concluido'"),
      pool.query("SELECT SUM(valor) FROM pedidos WHERE status != 'cancelado' AND pago_em >= $1", [new Date(hoje.getFullYear(), hoje.getMonth(), 1)])
    ]);
    res.json({
      total: parseInt(total.rows[0].count),
      hoje: parseInt(hoje_count.rows[0].count),
      em_andamento: parseInt(em_andamento.rows[0].count),
      concluidos: parseInt(concluidos.rows[0].count),
      receita_mes: parseFloat(receita.rows[0].sum || 0)
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
