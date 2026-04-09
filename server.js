require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Validar variáveis de ambiente obrigatórias
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`❌ Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`);
  process.exit(1);
}

// Middlewares
const allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [];
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting geral
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { erro: 'Muitas requisições' } }));

// Rate limiting restrito para login (anti brute-force)
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { erro: 'Muitas tentativas de login. Tente novamente em 15 minutos.' } }));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Rotas API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/pedidos', require('./routes/pedidos'));

// Webhook Mercado Pago
app.post('/webhook/mp', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const body = JSON.parse(req.body.toString());
    if (body.type === 'payment' && body.data?.id) {
      const { pool } = require('./db');
      const mpId = String(body.data.id);
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

    // Criar admin padrão via variáveis de ambiente (se não existir)
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_SENHA) {
      const bcrypt = require('bcryptjs');
      const existing = await pool.query('SELECT id FROM usuarios WHERE email = $1', [process.env.ADMIN_EMAIL]);
      if (existing.rows.length === 0) {
        const hash = await bcrypt.hash(process.env.ADMIN_SENHA, 10);
        await pool.query(
          'INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4)',
          ['Administrador', process.env.ADMIN_EMAIL, hash, 'admin']
        );
        console.log('✅ Admin criado via variáveis de ambiente');
      }
    }
  } catch (e) {
    console.error('❌ Erro ao inicializar banco:', e.message);
    console.error('DATABASE_URL definida:', !!process.env.DATABASE_URL);
  }
  app.listen(PORT, () => {
    console.log(`🔍 RASTREIA rodando na porta ${PORT}`);
    console.log(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    const apis = ['DIRECTD_TOKEN', 'CPFCNPJ_API_KEY', 'CNPJA_API_KEY', 'ESCAVADOR_API_KEY', 'TRANSPARENCIA_TOKEN', 'DATAJUD_API_KEY'];
    console.log(`📡 APIs: ${apis.map(k => `${k}=${!!process.env[k]}`).join(' | ')}`);
  });
}

iniciar();
