const express = require('express');
const router = express.Router();
const { autenticar } = require('./auth');
const { pool } = require('../db');
const planosCliente = require('../services/planos_cliente');

// Listar clientes (com busca por nome/cnpj)
router.get('/', autenticar, async (req, res) => {
  try {
    const { busca } = req.query;
    let query = 'SELECT * FROM clientes WHERE ativo = true';
    const params = [];
    if (busca) {
      params.push(`%${busca}%`);
      query += ` AND (nome ILIKE $1 OR cnpj ILIKE $1 OR empresa ILIKE $1)`;
    }
    query += ' ORDER BY nome ASC';
    const result = await pool.query(query, params);
    res.json({ clientes: result.rows });
  } catch (e) {
    console.error('Erro ao listar clientes:', e.message);
    res.status(500).json({ erro: 'Erro ao listar clientes' });
  }
});

// Buscar cliente por ID
router.get('/:id', autenticar, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clientes WHERE id = $1 AND ativo = true', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Cliente nao encontrado' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Erro ao buscar cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao buscar cliente' });
  }
});

// Criar cliente
router.post('/', autenticar, async (req, res) => {
  try {
    const { nome, email, whatsapp, cnpj, empresa, nicho, endereco, observacoes } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Nome e obrigatorio' });
    const result = await pool.query(
      `INSERT INTO clientes (nome, email, whatsapp, cnpj, empresa, nicho, endereco, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [nome.trim(), email || null, whatsapp || null, cnpj || null, empresa || null, nicho || null, endereco || null, observacoes || null]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Erro ao criar cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao criar cliente' });
  }
});

// Atualizar cliente
router.patch('/:id', autenticar, async (req, res) => {
  try {
    const { nome, email, whatsapp, cnpj, empresa, nicho, endereco, observacoes } = req.body;
    if (nome !== undefined && !nome.trim()) return res.status(400).json({ erro: 'Nome nao pode ser vazio' });
    const result = await pool.query(
      `UPDATE clientes SET
        nome = COALESCE($1, nome),
        email = COALESCE($2, email),
        whatsapp = COALESCE($3, whatsapp),
        cnpj = COALESCE($4, cnpj),
        empresa = COALESCE($5, empresa),
        nicho = COALESCE($6, nicho),
        endereco = COALESCE($7, endereco),
        observacoes = COALESCE($8, observacoes),
        atualizado_em = NOW()
       WHERE id = $9 AND ativo = true
       RETURNING *`,
      [nome || null, email || null, whatsapp || null, cnpj || null, empresa || null, nicho || null, endereco || null, observacoes || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Cliente nao encontrado' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Erro ao atualizar cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao atualizar cliente' });
  }
});

// Soft delete
router.delete('/:id', autenticar, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE clientes SET ativo = false, atualizado_em = NOW() WHERE id = $1 AND ativo = true RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Cliente nao encontrado' });
    res.json({ ok: true });
  } catch (e) {
    console.error('Erro ao excluir cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao excluir cliente' });
  }
});

// ─── Plano mensal do cliente (mensalista) ───────────────────────────
// GET status do plano (com reset preguiçoso do ciclo)
router.get('/:id/plano', autenticar, async (req, res) => {
  try {
    const s = await planosCliente.statusPlano(req.params.id);
    if (!s) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json(s);
  } catch (e) {
    console.error('Erro status plano cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao obter plano' });
  }
});

// Define/edita o plano (cota=0 remove). { plano_nome, cota_mensal, valor_mensal }
router.patch('/:id/plano', autenticar, async (req, res) => {
  try {
    const out = await planosCliente.definirPlano(req.params.id, req.body || {});
    if (!out.ok) return res.status(400).json({ erro: out.erro });
    res.json(out.status);
  } catch (e) {
    console.error('Erro definir plano cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao definir plano' });
  }
});

// Registra 1 consulta entregue (debita da cota)
router.post('/:id/plano/debitar', autenticar, async (req, res) => {
  try {
    const out = await planosCliente.debitar(req.params.id);
    if (!out.ok) return res.status(400).json({ erro: out.erro, status: out.status });
    res.json(out.status);
  } catch (e) {
    console.error('Erro debitar plano cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao registrar consulta' });
  }
});

// Desfaz 1 consulta (corrige erro)
router.post('/:id/plano/creditar', autenticar, async (req, res) => {
  try {
    const out = await planosCliente.creditar(req.params.id);
    res.json(out.status);
  } catch (e) {
    console.error('Erro creditar plano cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao desfazer consulta' });
  }
});

// Zera o ciclo manualmente
router.post('/:id/plano/resetar', autenticar, async (req, res) => {
  try {
    const out = await planosCliente.resetar(req.params.id);
    res.json(out.status);
  } catch (e) {
    console.error('Erro resetar plano cliente:', e.message);
    res.status(500).json({ erro: 'Erro ao resetar ciclo' });
  }
});

module.exports = router;
