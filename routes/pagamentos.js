/**
 * RASTREIA — Rotas de pagamento (Mercado Pago)
 *
 * Endpoints:
 *   POST /api/pedidos/:id/pagamento          (autenticado) — cria a preference, retorna init_point
 *   GET  /api/pedidos/:id/pagamento/status   (autenticado) — status atual do pedido (polling pós-checkout)
 *   POST /api/mercadopago/webhook            (público)     — notificação do MP
 *
 * As duas primeiras vivem sob /api/pedidos para ficarem agrupadas com pedidos.js.
 * O webhook é montado em /api/mercadopago/webhook diretamente em server.js.
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { autenticar } = require('./auth');
const {
  criarPreferenceParaPedido,
  consultarPagamento,
  validarAssinaturaWebhook,
  configurado
} = require('../services/mercadopago');
const { PRODUTOS } = require('../services/produtos');
const { liberarPedidoPago } = require('../services/pipeline_pedido');

// ─── POST /api/pedidos/:id/pagamento ────────────────────────────────
// Cria (ou recria) a preference do MP para um pedido. Retorna init_point.
async function criarPagamento(req, res) {
  try {
    if (!configurado()) {
      return res.status(503).json({
        erro: 'MercadoPago não configurado',
        mensagem: 'Defina MERCADOPAGO_ACCESS_TOKEN nas variáveis de ambiente'
      });
    }

    const r = await pool.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ erro: 'Pedido não encontrado' });
    const pedido = r.rows[0];

    if (pedido.status === 'concluido') {
      return res.status(400).json({ erro: 'Pedido já concluído' });
    }
    if (pedido.status !== 'aguardando_pagamento') {
      // Já está pago ou em andamento — devolve dados, mas não cria nova preference
      return res.json({
        ok: true,
        ja_pago: true,
        status: pedido.status,
        init_point: pedido.mp_init_point || null,
        preference_id: pedido.mp_preference_id || null
      });
    }
    if (!pedido.valor || Number(pedido.valor) <= 0) {
      return res.status(400).json({ erro: 'Pedido sem valor válido' });
    }

    const nomeProduto = PRODUTOS[pedido.tipo]?.nome || pedido.tipo;
    const out = await criarPreferenceParaPedido(pedido, { nomeProduto });
    if (!out.ok) {
      return res.status(502).json({ erro: 'Erro ao criar preference no Mercado Pago', mensagem: out.erro });
    }

    await pool.query(
      'UPDATE pedidos SET mp_preference_id = $1, mp_init_point = $2, atualizado_em = NOW() WHERE id = $3',
      [out.preference_id, out.init_point, pedido.id]
    );
    await pool.query(
      'INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)',
      [pedido.id, req.usuario?.id || null, 'Preference MP criada', `pref=${out.preference_id}`]
    );

    res.json({
      ok: true,
      init_point: out.init_point,
      preference_id: out.preference_id,
      pedido_id: pedido.id
    });
  } catch (e) {
    console.error('[pagamentos] criar erro:', e);
    res.status(500).json({ erro: 'Erro ao criar pagamento' });
  }
}

// ─── GET /api/pedidos/:id/pagamento/status ──────────────────────────
async function statusPagamento(req, res) {
  try {
    const r = await pool.query(
      `SELECT id, status, valor, mp_payment_id, mp_preference_id, mp_init_point,
              pago_em, concluido_em, relatorio_url
         FROM pedidos WHERE id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Pedido não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[pagamentos] status erro:', e);
    res.status(500).json({ erro: 'Erro ao consultar status' });
  }
}

// ─── POST /api/mercadopago/webhook ──────────────────────────────────
// PÚBLICO — chamado pelo Mercado Pago. Sempre devolve 200 (mesmo em erro)
// para o MP não retentar indefinidamente. Idempotente.
async function webhookMP(req, res) {
  // Sempre log primeiro, processamento depois.
  let logId = null;
  try {
    const body = req.body || {};
    const tipo = body.type || body.topic || (req.query && (req.query.type || req.query.topic)) || null;
    const paymentId = body?.data?.id || (req.query && (req.query['data.id'] || req.query.id)) || null;

    const ins = await pool.query(
      `INSERT INTO pagamentos_log (payment_id, tipo, raw, processado)
       VALUES ($1, $2, $3, false) RETURNING id`,
      [paymentId ? String(paymentId) : null, tipo, JSON.stringify(body)]
    );
    logId = ins.rows[0].id;

    // Validação opcional de assinatura (se MERCADOPAGO_WEBHOOK_SECRET estiver setado)
    const assinaturaOk = validarAssinaturaWebhook(req);
    if (assinaturaOk === false) {
      console.warn('[MP webhook] assinatura inválida, ignorando notificação');
      await pool.query('UPDATE pagamentos_log SET erro = $1 WHERE id = $2',
        ['assinatura inválida', logId]);
      return res.sendStatus(200);
    }

    if (tipo !== 'payment' || !paymentId) {
      // Eventos diferentes (merchant_order, plan, etc.) — apenas registramos.
      await pool.query('UPDATE pagamentos_log SET processado = true WHERE id = $1', [logId]);
      return res.sendStatus(200);
    }

    // Responde 200 imediatamente e processa em background. O MP retentaria em 5xx
    // ou em timeout > 22s, e o pipeline de PDF pode levar mais que isso.
    res.sendStatus(200);

    // ─── Processamento assíncrono ───
    (async () => {
      try {
        const pagamento = await consultarPagamento(paymentId);
        if (!pagamento || pagamento.erro) {
          await pool.query('UPDATE pagamentos_log SET erro = $1 WHERE id = $2',
            [pagamento?.erro || 'consultarPagamento falhou', logId]);
          return;
        }

        const status = pagamento.status; // approved | pending | rejected | ...
        const pedidoId = pagamento.external_reference;
        await pool.query(
          'UPDATE pagamentos_log SET status = $1, pedido_id = $2 WHERE id = $3',
          [status, pedidoId || null, logId]
        );

        if (!pedidoId) {
          await pool.query('UPDATE pagamentos_log SET erro = $1 WHERE id = $2',
            ['external_reference ausente', logId]);
          return;
        }

        if (status !== 'approved') {
          await pool.query('UPDATE pagamentos_log SET processado = true WHERE id = $1', [logId]);
          return;
        }

        // Atualiza pedido APENAS se ainda estiver aguardando pagamento (idempotente)
        const upd = await pool.query(
          `UPDATE pedidos
              SET status = 'pago', pago_em = NOW(), mp_payment_id = $1, atualizado_em = NOW()
            WHERE id = $2 AND status = 'aguardando_pagamento'
            RETURNING id`,
          [String(paymentId), pedidoId]
        );

        if (upd.rows.length === 0) {
          // Pedido já estava processado em outra entrega do webhook — idempotência ok.
          await pool.query('UPDATE pagamentos_log SET processado = true, erro = $1 WHERE id = $2',
            ['pedido já processado (idempotente)', logId]);
          return;
        }

        await pool.query(
          'INSERT INTO logs (pedido_id, acao, detalhes) VALUES ($1, $2, $3)',
          [pedidoId, 'Pagamento confirmado via webhook MP', `payment_id=${paymentId}`]
        );

        // Dispara pipeline (consultas + PDF). NÃO awaitamos aqui pra liberar o handler,
        // mas o handler já respondeu 200 — o await abaixo só serve pra logar resultado.
        const out = await liberarPedidoPago(pedidoId);
        if (!out.ok) {
          await pool.query('UPDATE pagamentos_log SET erro = $1 WHERE id = $2',
            [`pipeline: ${out.erro}${out.mensagem ? ' / ' + out.mensagem : ''}`, logId]);
        }
        await pool.query('UPDATE pagamentos_log SET processado = true WHERE id = $1', [logId]);
      } catch (e) {
        console.error('[MP webhook] erro async:', e);
        try {
          if (logId) await pool.query('UPDATE pagamentos_log SET erro = $1 WHERE id = $2',
            [e.message, logId]);
        } catch (_) {}
      }
    })();
  } catch (e) {
    console.error('[MP webhook] erro síncrono:', e);
    if (!res.headersSent) res.sendStatus(200);
  }
}

router.post('/pedidos/:id/pagamento', autenticar, criarPagamento);
router.get('/pedidos/:id/pagamento/status', autenticar, statusPagamento);

module.exports = router;
module.exports.webhookMP = webhookMP;
