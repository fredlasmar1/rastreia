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

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

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

// Inicializar banco e subir servidor
const fs = require('fs');
const { pool } = require('./db');

async function iniciar() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Conexão com banco OK');
    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ Tabelas criadas/verificadas');
  } catch (e) {
    console.error('❌ Erro ao inicializar banco:', e.message);
    console.error('DATABASE_URL definida:', !!process.env.DATABASE_URL);
  }
  app.listen(PORT, () => {
    console.log(`🔍 RASTREIA rodando na porta ${PORT}`);
    console.log(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📡 APIs: DIRECTD_TOKEN=${!!process.env.DIRECTD_TOKEN} | CPFCNPJ_API_KEY=${!!process.env.CPFCNPJ_API_KEY} | CNPJA_API_KEY=${!!process.env.CNPJA_API_KEY} | ESCAVADOR_API_KEY=${!!process.env.ESCAVADOR_API_KEY} | TRANSPARENCIA_TOKEN=${!!process.env.TRANSPARENCIA_TOKEN}`);
  });
}

iniciar();
