require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { erro: 'Muitas requisições' } }));

// Rotas API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/pedidos', require('./routes/pedidos'));

// Webhook Mercado Pago
app.post('/webhook/mp', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const body = JSON.parse(req.body);
    if (body.type === 'payment' && body.data?.id) {
      const { pool } = require('./db');
      const mpId = String(body.data.id);
      // Buscar pedido pelo external_reference (id do pedido)
      await pool.query(
        `UPDATE pedidos SET status = 'pago', pago_em = NOW(), mp_payment_id = $1, atualizado_em = NOW()
         WHERE mp_payment_id = $1 OR (status = 'aguardando_pagamento' AND id::text = $2)`,
        [mpId, body.data.external_reference || '']
      );
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook MP erro:', e);
    res.sendStatus(500);
  }
});

// Servir frontend para todas as rotas não-API
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/webhook')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`🔍 RASTREIA rodando na porta ${PORT}`);
  console.log(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
