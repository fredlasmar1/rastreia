const express = require('express');
const router = express.Router();
const { autenticar, admin } = require('./auth');
const { pool } = require('../db');
const { PLANOS, buscarPlano } = require('../services/planos');

// Listar planos disponíveis (público)
router.get('/planos', (req, res) => {
  res.json(PLANOS);
});

// Listar assinaturas (admin)
router.get('/', autenticar, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM assinaturas ORDER BY criado_em DESC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao listar assinaturas' });
  }
});

// Criar assinatura
router.post('/', autenticar, admin, async (req, res) => {
  try {
    const { cliente_nome, cliente_cnpj, cliente_email, cliente_whatsapp, nicho, plano } = req.body;
    if (!cliente_nome || !nicho || !plano) {
      return res.status(400).json({ erro: 'cliente_nome, nicho e plano são obrigatórios' });
    }
    const planoConfig = buscarPlano(nicho, plano);
    if (!planoConfig) {
      return res.status(400).json({ erro: 'Plano ou nicho inválido' });
    }
    const renovacao = new Date();
    renovacao.setMonth(renovacao.getMonth() + 1);

    const result = await pool.query(
      `INSERT INTO assinaturas (
        cliente_nome, cliente_cnpj, cliente_email, cliente_whatsapp,
        nicho, plano, valor_mensal, consultas_inclusas, renovacao_em
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [cliente_nome, cliente_cnpj, cliente_email, cliente_whatsapp, nicho, plano, planoConfig.preco, planoConfig.consultas, renovacao]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao criar assinatura' });
  }
});

// Cancelar assinatura
router.patch('/:id/cancelar', autenticar, admin, async (req, res) => {
  try {
    await pool.query('UPDATE assinaturas SET ativo = false, atualizado_em = NOW() WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao cancelar' });
  }
});

module.exports = router;
