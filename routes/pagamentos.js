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
const planosUsuario = require('../services/planos_usuario');
const emailService = require('../services/email');

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

// ─── POST /api/pedidos/:id/pagamento-alternativo ────────────────────
// Cobra o pedido sem passar pelo Mercado Pago. Aceita 'dinheiro' ou 'plano'.
// Qualquer usuário autenticado pode usar. Em 'plano', debita 1 da cota mensal
// do operador logado; falha com 400 se não houver plano ou cota esgotada.
async function pagamentoAlternativo(req, res) {
  try {
    const forma = (req.body?.forma || '').toLowerCase();
    if (!['dinheiro', 'plano'].includes(forma)) {
      return res.status(400).json({ erro: "Campo 'forma' deve ser 'dinheiro' ou 'plano'" });
    }

    const r = await pool.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ erro: 'Pedido não encontrado' });
    const pedido = r.rows[0];

    if (pedido.status === 'concluido') {
      return res.status(400).json({ erro: 'Pedido já concluído' });
    }
    if (pedido.status !== 'aguardando_pagamento') {
      return res.status(400).json({ erro: `Pedido não está aguardando pagamento (status atual: ${pedido.status})` });
    }

    let restantesPlano = null;
    if (forma === 'plano') {
      const verif = await planosUsuario.podeDebitarPlano(req.usuario.id);
      if (!verif.ok) {
        return res.status(400).json({
          erro: verif.erro || 'Plano não disponível',
          cota: verif.cota,
          restantes: verif.restantes
        });
      }
      const deb = await planosUsuario.debitarPlano(req.usuario.id);
      if (!deb.ok) {
        return res.status(400).json({ erro: deb.erro || 'Não foi possível debitar do plano' });
      }
      restantesPlano = deb.restantes;
    }

    const mpRef = forma === 'dinheiro' ? 'dinheiro' : 'plano';
    await pool.query(
      `UPDATE pedidos
          SET status = 'pago', pago_em = NOW(), mp_payment_id = $1,
              forma_pagamento = $2, atualizado_em = NOW()
        WHERE id = $3`,
      [mpRef, forma, pedido.id]
    );
    await pool.query(
      'INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)',
      [pedido.id, req.usuario.id, 'Pagamento confirmado', `forma=${forma}`]
    );

    // Pipeline pós-pagamento (consultas + PDF) em background — não bloqueia a resposta.
    liberarPedidoPago(pedido.id).catch((e) => {
      console.warn('[pagamentos] pipeline alternativo falhou:', e.message);
    });

    const resp = { ok: true, status: 'pago', forma };
    if (restantesPlano !== null) resp.plano_restantes = restantesPlano;
    res.json(resp);
  } catch (e) {
    console.error('[pagamentos] alternativo erro:', e);
    res.status(500).json({ erro: 'Erro ao processar pagamento alternativo' });
  }
}

// ─── POST /api/pedidos/:id/enviar-email-pagamento ───────────────────
// Envia o link de pagamento (init_point do MP) por email para o cliente.
async function enviarEmailPagamento(req, res) {
  try {
    const email = (req.body?.email || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ erro: 'Email inválido' });
    }
    if (!emailService.configurado()) {
      return res.status(503).json({
        erro: 'SMTP não configurado',
        mensagem: 'Defina SMTP_HOST, SMTP_USER e SMTP_PASS nas variáveis de ambiente.'
      });
    }

    const r = await pool.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ erro: 'Pedido não encontrado' });
    const pedido = r.rows[0];

    if (!pedido.mp_init_point) {
      return res.status(400).json({ erro: 'Pedido sem link de pagamento gerado. Crie a cobrança via MercadoPago primeiro.' });
    }

    const nomeProduto = PRODUTOS[pedido.tipo]?.nome || pedido.tipo;
    await emailService.enviarLinkPagamento({
      para: email,
      nomeCliente: pedido.cliente_nome,
      valor: pedido.valor,
      link: pedido.mp_init_point,
      numeroPedido: pedido.numero,
      nomeProduto
    });

    await pool.query(
      'INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)',
      [pedido.id, req.usuario?.id || null, 'Link de pagamento enviado por email', `para=${email}`]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[pagamentos] email erro:', e);
    res.status(500).json({ erro: 'Erro ao enviar email', mensagem: e.message });
  }
}

router.post('/pedidos/:id/pagamento', autenticar, criarPagamento);
router.get('/pedidos/:id/pagamento/status', autenticar, statusPagamento);
router.post('/pedidos/:id/pagamento-alternativo', autenticar, pagamentoAlternativo);
router.post('/pedidos/:id/enviar-email-pagamento', autenticar, enviarEmailPagamento);

module.exports = router;
module.exports.webhookMP = webhookMP;
