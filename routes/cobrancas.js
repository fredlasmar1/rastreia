/**
 * RASTREIA — /api/cobrancas: parcelas de pedido, lote, mensalidades e assinaturas.
 * Regras em services/cobrancas.js; links e assinaturas pelo Mercado Pago.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { autenticar } = require('./auth');
const cob = require('../services/cobrancas');

const erro500 = (res, onde, e) => { console.error(`[cobrancas] ${onde}:`, e); res.status(500).json({ erro: 'Erro ao processar a cobrança' }); };

// Lista (abertas por padrão), com o pedido/cliente de cada cobrança
router.get('/', autenticar, async (req, res) => {
  try {
    const st = ['aberta', 'paga', 'cancelada'].includes(req.query.status) ? req.query.status : (req.query.status === 'todas' ? null : 'aberta');
    const r = await pool.query(
      `SELECT c.*, p.numero AS pedido_numero, p.cliente_nome, p.cliente_whatsapp, p.tipo AS pedido_tipo, p.status AS pedido_status,
              cl.nome AS cliente_cadastro, cl.whatsapp AS cliente_cadastro_whatsapp
         FROM cobrancas c LEFT JOIN pedidos p ON p.id = c.pedido_id LEFT JOIN clientes cl ON cl.id = c.cliente_id
        ${st ? 'WHERE c.status = $1' : ''}
        ORDER BY (c.status = 'aberta') DESC, c.vencimento NULLS LAST, c.criado_em DESC LIMIT 300`, st ? [st] : []);
    const resumo = (await pool.query(
      `SELECT status, COUNT(*)::int n, COALESCE(SUM(valor),0)::float total,
              COUNT(*) FILTER (WHERE status = 'aberta' AND vencimento < CURRENT_DATE)::int vencidas
         FROM cobrancas GROUP BY status`)).rows;
    res.json({ cobrancas: r.rows, resumo });
  } catch (e) { erro500(res, 'lista', e); }
});

// Pedidos em aberto (para montar um lote)
router.get('/pedidos-em-aberto', autenticar, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.numero, p.tipo, p.cliente_nome, p.cliente_whatsapp, p.alvo_nome, p.valor, p.criado_em, p.mp_init_point,
              (SELECT COUNT(*) FROM cobrancas c WHERE c.pedido_id = p.id AND c.status = 'aberta')::int AS cobrancas_abertas
         FROM pedidos p
        WHERE p.status = 'aguardando_pagamento' AND p.deletado_em IS NULL AND p.valor > 0
        ORDER BY p.criado_em DESC LIMIT 200`);
    res.json({ pedidos: r.rows });
  } catch (e) { erro500(res, 'pedidos-em-aberto', e); }
});

// Cobranças de um pedido
router.get('/pedido/:id', autenticar, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM cobrancas WHERE pedido_id = $1 ORDER BY numero NULLS FIRST, criado_em', [req.params.id]);
    res.json({ cobrancas: r.rows });
  } catch (e) { erro500(res, 'pedido', e); }
});

// Dividir um pedido em parcelas mensais
router.post('/pedido/:id/parcelar', autenticar, async (req, res) => {
  try {
    const { parcelas, primeiro_vencimento } = req.body || {};
    const out = await cob.parcelarPedido(req.params.id, { parcelas, primeiroVencimento: primeiro_vencimento, usuarioId: req.usuario.id });
    res.status(out.ok ? 200 : 400).json(out);
  } catch (e) { erro500(res, 'parcelar', e); }
});

// Lote: { pedido_ids: [...] } e/ou { clientes: [{ cliente_id, valor, descricao }] }
router.post('/lote', autenticar, async (req, res) => {
  try {
    const { pedido_ids, clientes, vencimento } = req.body || {};
    if (!(Array.isArray(pedido_ids) && pedido_ids.length) && !(Array.isArray(clientes) && clientes.length)) return res.status(400).json({ erro: 'Escolha pedidos ou clientes.' });
    res.json(await cob.criarLote({ pedido_ids: pedido_ids || [], clientes: clientes || [], vencimento, usuarioId: req.usuario.id }));
  } catch (e) { erro500(res, 'lote', e); }
});

// Regerar o link (venceu ou o cliente perdeu)
router.post('/:id/link', autenticar, async (req, res) => {
  try {
    const c = (await pool.query("SELECT c.*, p.cliente_email FROM cobrancas c LEFT JOIN pedidos p ON p.id = c.pedido_id WHERE c.id = $1", [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ erro: 'Cobrança não encontrada' });
    if (c.status !== 'aberta') return res.status(400).json({ erro: 'A cobrança não está em aberto.' });
    const out = await cob.gerarLink(c, { payerEmail: c.cliente_email });
    res.status(out.ok ? 200 : 502).json(out);
  } catch (e) { erro500(res, 'link', e); }
});

// Recebido fora do Mercado Pago (dinheiro, Pix direto)
router.post('/:id/baixa-manual', autenticar, async (req, res) => {
  try {
    const out = await cob.baixar(req.params.id, { forma: 'manual', usuarioId: req.usuario.id });
    res.json(out);
  } catch (e) { erro500(res, 'baixa', e); }
});

router.post('/:id/cancelar', autenticar, async (req, res) => {
  try {
    const r = await pool.query("UPDATE cobrancas SET status = 'cancelada' WHERE id = $1 AND status = 'aberta' RETURNING pedido_id, descricao", [req.params.id]);
    if (!r.rows.length) return res.status(400).json({ erro: 'Só dá para cancelar cobrança em aberto.' });
    if (r.rows[0].pedido_id) await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)', [r.rows[0].pedido_id, req.usuario.id, 'Cobrança cancelada', r.rows[0].descricao]);
    res.json({ ok: true });
  } catch (e) { erro500(res, 'cancelar', e); }
});

// ── Assinatura mensal no cartão (clientes de plano) ─────────────────────────
router.get('/assinaturas', autenticar, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, nome, email, whatsapp, plano_nome, plano_valor_mensal, plano_cota_mensal, plano_cotas,
              mp_preapproval_id, assinatura_status, assinatura_link, assinatura_ultimo_pagamento
         FROM clientes
        WHERE ativo = true AND (COALESCE(plano_valor_mensal, 0) > 0 OR plano_cotas IS NOT NULL OR COALESCE(plano_cota_mensal, 0) > 0 OR mp_preapproval_id IS NOT NULL)
        ORDER BY nome`);
    res.json({ clientes: r.rows });
  } catch (e) { erro500(res, 'assinaturas', e); }
});

router.post('/assinaturas/:clienteId', autenticar, async (req, res) => {
  try {
    const out = await cob.criarAssinatura(req.params.clienteId, { valor: (req.body || {}).valor });
    res.status(out.ok ? 200 : 400).json(out);
  } catch (e) { erro500(res, 'criar-assinatura', e); }
});

router.post('/assinaturas/:clienteId/atualizar', autenticar, async (req, res) => {
  try {
    const c = (await pool.query('SELECT mp_preapproval_id FROM clientes WHERE id = $1', [req.params.clienteId])).rows[0];
    if (!c || !c.mp_preapproval_id) return res.status(400).json({ erro: 'Cliente sem assinatura.' });
    res.json(await cob.atualizarStatusAssinatura(c.mp_preapproval_id));
  } catch (e) { erro500(res, 'atualizar-assinatura', e); }
});

router.delete('/assinaturas/:clienteId', autenticar, async (req, res) => {
  try {
    if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Somente admin cancela assinatura.' });
    const out = await cob.cancelarAssinatura(req.params.clienteId);
    res.status(out.ok ? 200 : 400).json(out);
  } catch (e) { erro500(res, 'cancelar-assinatura', e); }
});

module.exports = router;
