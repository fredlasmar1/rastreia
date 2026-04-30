require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway e outros proxies colocam o IP real em X-Forwarded-For.
// Sem trust proxy, express-rate-limit joga erro e conta todos os usuários como o IP do proxy.
app.set('trust proxy', 1);

// Limpar variáveis de ambiente (remover espaços e = no início/fim)
function limparEnv(nome) {
  if (process.env[nome]) {
    process.env[nome] = process.env[nome].replace(/^[\s=]+|[\s]+$/g, '');
  }
}
// Limpar todas as API keys + NODE_ENV (Railway às vezes injeta com '=' no valor)
['CNPJA_API_KEY', 'DIRECTD_TOKEN', 'ESCAVADOR_API_KEY', 'DATAJUD_API_KEY', 'DATAJUS_API_KEY',
 'TRANSPARENCIA_TOKEN', 'MP_ACCESS_TOKEN', 'MERCADOPAGO_ACCESS_TOKEN', 'CPFCNPJ_API_KEY',
 'CNPJWS_API_KEY', 'INFOSIMPLES_TOKEN', 'INFOSIMPLES_CALLBACK_SECRET', 'ONR_API_KEY',
 'SERASA_API_KEY', 'JWT_SECRET', 'NODE_ENV'
].forEach(limparEnv);

// Compatibilizar nomes alternativos de variáveis
if (!process.env.CPFCNPJ_API_KEY && process.env.CNPJWS_API_KEY) {
  process.env.CPFCNPJ_API_KEY = process.env.CNPJWS_API_KEY;
}
if (!process.env.DATAJUD_API_KEY && process.env.DATAJUS_API_KEY) {
  process.env.DATAJUD_API_KEY = process.env.DATAJUS_API_KEY;
}
if (!process.env.MP_ACCESS_TOKEN && process.env.MERCADOPAGO_ACCESS_TOKEN) {
  process.env.MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
}
if (!process.env.INFOSIMPLES_TOKEN && process.env.INFOSIMPLES_CALLBACK_SECRET) {
  process.env.INFOSIMPLES_TOKEN = process.env.INFOSIMPLES_CALLBACK_SECRET;
}

// Validar variáveis de ambiente obrigatórias
console.log('🔄 Iniciando Rastreia...');
console.log(`DATABASE_URL definida: ${!!process.env.DATABASE_URL}`);
console.log(`JWT_SECRET definida: ${!!process.env.JWT_SECRET}`);
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

// Mostra os primeiros/últimos caracteres de cada key para verificar se foi copiada certo
app.get('/api/health/apis/mask', (req, res) => {
  const mask = (v) => {
    if (!v) return null;
    const s = String(v);
    if (s.length < 10) return '***';
    return `${s.substring(0, 4)}...${s.substring(s.length - 4)} (${s.length} chars)`;
  };
  res.json({
    CNPJA_API_KEY: mask(process.env.CNPJA_API_KEY),
    DIRECTD_TOKEN: mask(process.env.DIRECTD_TOKEN),
    ESCAVADOR_API_KEY: mask(process.env.ESCAVADOR_API_KEY),
    DATAJUD_API_KEY: mask(process.env.DATAJUD_API_KEY),
    DATAJUS_API_KEY: mask(process.env.DATAJUS_API_KEY),
    TRANSPARENCIA_TOKEN: mask(process.env.TRANSPARENCIA_TOKEN),
    MP_ACCESS_TOKEN: mask(process.env.MP_ACCESS_TOKEN),
    MERCADOPAGO_ACCESS_TOKEN: mask(process.env.MERCADOPAGO_ACCESS_TOKEN),
    CPFCNPJ_API_KEY: mask(process.env.CPFCNPJ_API_KEY),
    INFOSIMPLES_TOKEN: mask(process.env.INFOSIMPLES_TOKEN),
    INFOSIMPLES_CALLBACK_SECRET: mask(process.env.INFOSIMPLES_CALLBACK_SECRET)
  });
});

// Health check das APIs externas — mostra quais estão configuradas
app.get('/api/health/apis', (req, res) => {
  res.json({
    // Dados cadastrais
    CNPJA_API_KEY: !!process.env.CNPJA_API_KEY,
    DIRECTD_TOKEN: !!process.env.DIRECTD_TOKEN,
    // Processos
    ESCAVADOR_API_KEY: !!process.env.ESCAVADOR_API_KEY,
    DATAJUD_API_KEY: !!(process.env.DATAJUD_API_KEY || process.env.DATAJUS_API_KEY),
    // Listas negras
    TRANSPARENCIA_TOKEN: !!process.env.TRANSPARENCIA_TOKEN,
    // Imobiliário
    ONR_API_KEY: !!process.env.ONR_API_KEY,
    INFOSIMPLES: !!(process.env.INFOSIMPLES_TOKEN || process.env.INFOSIMPLES_CALLBACK_SECRET),
    // Pagamentos
    MERCADOPAGO: !!(process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN),
    // WhatsApp
    EVOLUTION_API: !!process.env.EVOLUTION_API_KEY,
    // Outros
    SERASA_API_KEY: !!process.env.SERASA_API_KEY
  });
});

// Teste real das APIs (admin) — faz uma chamada em cada API e retorna o status
app.get('/api/health/apis/teste', async (req, res) => {
  const axios = require('axios');
  const results = {};

  // Teste CNPJá
  if (process.env.CNPJA_API_KEY) {
    try {
      const r = await axios.get('https://api.cnpja.com/office/00000000000191', {
        headers: { Authorization: process.env.CNPJA_API_KEY },
        timeout: 10000
      });
      results.CNPJA = { ok: true, status: r.status };
    } catch (e) {
      results.CNPJA = { ok: false, erro: e.response?.status || e.message };
    }
  } else results.CNPJA = { ok: false, erro: 'não configurado' };

  // Teste Direct Data
  if (process.env.DIRECTD_TOKEN) {
    try {
      const r = await axios.get('https://apiv3.directd.com.br/api/CadastroPessoaFisicaPlus', {
        params: { Cpf: '11111111111', Token: process.env.DIRECTD_TOKEN },
        timeout: 10000
      });
      results.DIRECTD = { ok: true, status: r.status };
    } catch (e) {
      results.DIRECTD = { ok: e.response?.status === 400, status: e.response?.status, erro: e.response?.data?.mensagem || e.message };
    }
  } else results.DIRECTD = { ok: false, erro: 'não configurado' };

  // Teste Escavador (usa endpoint /me que é rápido e só valida o token)
  if (process.env.ESCAVADOR_API_KEY) {
    try {
      const r = await axios.get('https://api.escavador.com/api/v2/usuario', {
        headers: { Authorization: `Bearer ${process.env.ESCAVADOR_API_KEY}` },
        timeout: 30000
      });
      results.ESCAVADOR = { ok: true, status: r.status };
    } catch (e) {
      results.ESCAVADOR = { ok: false, erro: e.response?.status || e.message };
    }
  } else results.ESCAVADOR = { ok: false, erro: 'não configurado' };

  // Teste Datajud
  const datajudKey = process.env.DATAJUD_API_KEY || process.env.DATAJUS_API_KEY;
  if (datajudKey) {
    try {
      const r = await axios.post('https://api-publica.datajud.cnj.jus.br/api_publica_tjgo/_search',
        { query: { match_all: {} }, size: 1 },
        { headers: { Authorization: `ApiKey ${datajudKey}`, 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      results.DATAJUD = { ok: true, status: r.status };
    } catch (e) {
      results.DATAJUD = { ok: false, erro: e.response?.status || e.message };
    }
  } else results.DATAJUD = { ok: false, erro: 'não configurado' };

  // Teste Transparência
  if (process.env.TRANSPARENCIA_TOKEN) {
    try {
      const r = await axios.get('https://api.portaldatransparencia.gov.br/api-de-dados/ceis', {
        params: { pagina: 1 },
        headers: { 'chave-api-dados': process.env.TRANSPARENCIA_TOKEN },
        timeout: 10000
      });
      results.TRANSPARENCIA = { ok: true, status: r.status };
    } catch (e) {
      results.TRANSPARENCIA = { ok: false, erro: e.response?.status || e.message };
    }
  } else results.TRANSPARENCIA = { ok: false, erro: 'não configurado' };

  // Teste CPF.CNPJ
  if (process.env.CPFCNPJ_API_KEY) {
    try {
      const r = await axios.get(`https://api.cpfcnpj.com.br/${process.env.CPFCNPJ_API_KEY}/9/00000000000`, { timeout: 15000 });
      results.CPFCNPJ = { ok: true, status: r.status };
    } catch (e) {
      results.CPFCNPJ = { ok: e.response?.status !== 401, status: e.response?.status, erro: e.response?.data?.message || e.message };
    }
  } else results.CPFCNPJ = { ok: false, erro: 'nao configurado' };

  // Teste Direct Data Score (usa Cnpj para teste com CNPJ do BB)
  if (process.env.DIRECTD_TOKEN) {
    try {
      const r = await axios.get('https://apiv3.directd.com.br/api/Score', {
        params: { Cnpj: '00000000000191', Token: process.env.DIRECTD_TOKEN },
        timeout: 20000
      });
      const scoreData = r.data?.retorno?.pessoaJuridica || r.data?.retorno?.pessoaFisica || {};
      results.DD_SCORE = { ok: true, status: r.status, score_keys: Object.keys(scoreData), amostra: JSON.stringify(scoreData).substring(0, 300) };
    } catch (e) {
      results.DD_SCORE = { ok: false, status: e.response?.status, msg: e.response?.data?.metaDados?.mensagem || e.message };
    }
  } else results.DD_SCORE = { ok: false, erro: 'nao configurado' };

  // Teste Direct Data DetalhamentoNegativo
  if (process.env.DIRECTD_TOKEN) {
    try {
      const r = await axios.get('https://apiv3.directd.com.br/api/DetalhamentoNegativo', {
        params: { Cnpj: '00000000000191', Token: process.env.DIRECTD_TOKEN },
        timeout: 20000
      });
      const negData = r.data?.retorno?.pessoaJuridica || r.data?.retorno?.pessoaFisica || {};
      results.DD_NEGATIVACOES = { ok: true, status: r.status, neg_keys: Object.keys(negData), amostra: JSON.stringify(negData).substring(0, 300) };
    } catch (e) {
      results.DD_NEGATIVACOES = { ok: false, status: e.response?.status, msg: e.response?.data?.metaDados?.mensagem || e.message };
    }
  } else results.DD_NEGATIVACOES = { ok: false, erro: 'nao configurado' };

  // Teste Mercado Pago
  const mpToken = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (mpToken) {
    try {
      const r = await axios.get('https://api.mercadopago.com/users/me', {
        headers: { Authorization: `Bearer ${mpToken}` },
        timeout: 10000
      });
      results.MERCADOPAGO = { ok: true, status: r.status, nickname: r.data.nickname };
    } catch (e) {
      results.MERCADOPAGO = { ok: false, erro: e.response?.status || e.message };
    }
  } else results.MERCADOPAGO = { ok: false, erro: 'não configurado' };

  res.json(results);
});

// Diagnostico do Escavador: roda a chamada real e devolve status/raw.
// Uso: /api/health/apis/escavador-debug?cpf=39067621811&nome=Victoria%20Farias
app.get('/api/health/apis/escavador-debug', async (req, res) => {
  const axios = require('axios');
  const cpf = (req.query.cpf || '').replace(/\D/g, '');
  const nome = req.query.nome || '';
  if (!cpf) return res.status(400).json({ erro: 'Passe ?cpf=numeros' });
  if (!process.env.ESCAVADOR_API_KEY) return res.status(400).json({ erro: 'ESCAVADOR_API_KEY nao configurada' });
  try {
    const r = await axios.get(`https://api.escavador.com/api/v2/envolvido/processos?cpf_cnpj=${cpf}`, {
      headers: { Authorization: `Bearer ${process.env.ESCAVADOR_API_KEY}`, Accept: 'application/json' },
      timeout: 20000,
      maxRedirects: 0,
      validateStatus: () => true
    });
    const items = r.data?.items || [];
    const preview = items.slice(0, 5).map(p => ({
      numero_cnj: p.numero_cnj, classe: p.classe?.nome, polo_ativo: p.titulo_polo_ativo, polo_passivo: p.titulo_polo_passivo, tribunal: p.fontes?.[0]?.nome || p.tribunal?.sigla
    }));
    res.json({
      cpf, nome, status: r.status,
      content_type: r.headers['content-type'],
      total_items: items.length,
      data_keys: typeof r.data === 'object' ? Object.keys(r.data || {}) : typeof r.data,
      raw_preview: typeof r.data === 'string' ? r.data.slice(0, 500) : null,
      items_preview: preview,
      token_prefix: (process.env.ESCAVADOR_API_KEY || '').slice(0, 24) + '...'
    });
  } catch (e) {
    res.status(500).json({ erro: e.message, status: e.response?.status, data: e.response?.data });
  }
});

// Monitor de falhas operacionais de APIs externas (saldo/token/quota)
const monitorApi = require('./services/monitorApi');
const { autenticar: _autMon, admin: _admMon } = require('./routes/auth');
app.get('/api/admin/status-apis', _autMon, _admMon, (req, res) => {
  try {
    res.json(monitorApi.obterStatus());
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});
app.post('/api/admin/status-apis/limpar', _autMon, _admMon, (req, res) => {
  try {
    monitorApi.limpar();
    res.json({ ok: true, mensagem: 'Histórico de falhas limpo.' });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Rotas API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/pedidos', require('./routes/pedidos'));
app.use('/api/assinaturas', require('./routes/assinaturas'));
app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/admin/custos', require('./routes/custos'));

// Webhook Mercado Pago
app.post('/webhook/mp', express.json(), async (req, res) => {
  try {
    const body = req.body;
    if (body.type === 'payment' && body.data?.id) {
      const { consultarPagamento } = require('./services/mercadopago');
      const { notificarOperadorNovoPedido } = require('./services/whatsapp');
      const { pool } = require('./db');

      const pagamento = await consultarPagamento(body.data.id);
      if (pagamento && pagamento.status === 'approved') {
        const pedidoId = pagamento.external_reference;
        const update = await pool.query(
          `UPDATE pedidos SET status = 'pago', pago_em = NOW(), mp_payment_id = $1, atualizado_em = NOW()
           WHERE id = $2 AND status = 'aguardando_pagamento'
           RETURNING *`,
          [String(body.data.id), pedidoId]
        );
        if (update.rows[0]) {
          await pool.query('INSERT INTO logs (pedido_id, acao) VALUES ($1, $2)',
            [pedidoId, 'Pagamento confirmado via webhook MP']);
          await notificarOperadorNovoPedido(update.rows[0]);
        }
      }
    }
    res.sendStatus(200); // sempre 200 para o MP não retentar
  } catch (e) {
    console.error('Webhook MP erro:', e.message);
    res.sendStatus(200);
  }
});

// Servir PDF — regenera se arquivo não existir (Railway ephemeral storage)
// BUG #2: tenta primeiro RELATORIOS_DIR (Railway Volume) e cai no caminho antigo
// public/relatorios para compat com PDFs gerados antes da migração para volume.
const storagePaths = require('./services/storage_paths');
app.get('/relatorios/:filename', async (req, res) => {
  // Bloquear path traversal (../../ etc)
  const fname = path.basename(req.params.filename);
  const candidatos = [
    path.join(storagePaths.RELATORIOS_DIR, fname),
    path.join(__dirname, 'public', 'relatorios', fname)
  ];
  for (const candidato of candidatos) {
    if (fs.existsSync(candidato)) return res.sendFile(candidato);
  }
  // Arquivo não existe (apagado no deploy). Tentar regenerar.
  try {
    const { pool } = require('./db');
    const { gerarDossie } = require('./services/pdf');
    // Extrair ID do pedido pelo relatorio_url salvo no banco
    const relUrl = `/relatorios/${req.params.filename}`;
    const pedidoResult = await pool.query(
      "SELECT * FROM pedidos WHERE relatorio_url = $1 AND deletado_em IS NULL",
      [relUrl]
    );
    if (pedidoResult.rows.length === 0) return res.status(404).send('Pedido nao encontrado. Gere o relatorio novamente.');
    const pedido = pedidoResult.rows[0];
    const dadosResult = await pool.query('SELECT * FROM dados_consulta WHERE pedido_id = $1', [pedido.id]);
    const { filepath } = await gerarDossie(pedido, dadosResult.rows);
    res.sendFile(filepath);
  } catch (e) {
    console.error('[PDF Regen] Erro:', e.message);
    res.status(404).send('PDF nao disponivel. Gere novamente pelo painel.');
  }
});

// Servir frontend para todas as rotas não-API
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/webhook')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Inicializar banco e subir servidor
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
    const statusAPIs = {
      CNPJA: !!process.env.CNPJA_API_KEY,
      DIRECTD: !!process.env.DIRECTD_TOKEN,
      ESCAVADOR: !!process.env.ESCAVADOR_API_KEY,
      DATAJUD: !!(process.env.DATAJUD_API_KEY || process.env.DATAJUS_API_KEY),
      TRANSPARENCIA: !!process.env.TRANSPARENCIA_TOKEN,
      ONR: !!process.env.ONR_API_KEY,
      INFOSIMPLES: !!(process.env.INFOSIMPLES_TOKEN || process.env.INFOSIMPLES_CALLBACK_SECRET),
      MERCADOPAGO: !!(process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN),
      EVOLUTION: !!process.env.EVOLUTION_API_KEY
    };
    console.log(`📡 APIs: ${Object.entries(statusAPIs).map(([k, v]) => `${k}=${v ? '✅' : '❌'}`).join(' | ')}`);
  });
}

iniciar();
