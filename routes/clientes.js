const express = require('express');
const router = express.Router();
const { autenticar } = require('./auth');
const { pool } = require('../db');

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

module.exports = router;
