/**
 * RASTREIA — Rotas de gestão de plano por usuário (operador)
 *
 *   GET  /api/me/plano                                  — autenticado
 *   GET  /api/admin/usuarios/:id/plano                  — admin
 *   PATCH /api/admin/usuarios/:id/plano                 — admin (body: { cota_mensal })
 *   POST /api/admin/usuarios/:id/plano/resetar          — admin
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { autenticar, admin } = require('./auth');
const planosUsuario = require('../services/planos_usuario');

function primeiroDiaMesAtual() {
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
}

// Plano do próprio usuário logado
router.get('/me/plano', autenticar, async (req, res) => {
  try {
    const status = await planosUsuario.statusPlano(req.usuario.id);
    res.json(status);
  } catch (e) {
    console.error('[planos] me/plano:', e);
    res.status(500).json({ erro: 'Erro ao consultar plano' });
  }
});

// GET plano de um usuário (admin)
router.get('/admin/usuarios/:id/plano', autenticar, admin, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, nome, email FROM usuarios WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ erro: 'Usuário não encontrado' });
    const status = await planosUsuario.statusPlano(req.params.id);
    res.json({ usuario: r.rows[0], ...status });
  } catch (e) {
    console.error('[planos] get admin:', e);
    res.status(500).json({ erro: 'Erro ao consultar plano' });
  }
});

// PATCH cota do plano (admin)
router.patch('/admin/usuarios/:id/plano', autenticar, admin, async (req, res) => {
  try {
    const cotaRaw = req.body?.cota_mensal;
    const cota = Number.parseInt(cotaRaw, 10);
    if (!Number.isFinite(cota) || cota < 0) {
      return res.status(400).json({ erro: 'cota_mensal deve ser inteiro >= 0' });
    }
    const atual = await pool.query(
      'SELECT plano_cota_mensal FROM usuarios WHERE id = $1',
      [req.params.id]
    );
    if (!atual.rows.length) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const cotaAtual = Number(atual.rows[0].plano_cota_mensal || 0);
    const params = [cota];
    let setSql = 'plano_cota_mensal = $1, atualizado_em = atualizado_em';
    // Se a cota mudou, reinicia o ciclo (consultas_usadas = 0, ciclo = mês atual).
    if (cota !== cotaAtual) {
      params.push(primeiroDiaMesAtual());
      setSql = `plano_cota_mensal = $1, plano_consultas_usadas = 0, plano_ciclo_inicio = $2`;
    }
    params.push(req.params.id);
    await pool.query(`UPDATE usuarios SET ${setSql} WHERE id = $${params.length}`, params);

    await pool.query(
      'INSERT INTO logs (usuario_id, acao, detalhes) VALUES ($1, $2, $3)',
      [req.usuario.id, 'Plano de usuário atualizado', `usuario=${req.params.id} cota=${cota}`]
    );

    const status = await planosUsuario.statusPlano(req.params.id);
    res.json({ ok: true, ...status });
  } catch (e) {
    console.error('[planos] patch admin:', e);
    res.status(500).json({ erro: 'Erro ao atualizar plano' });
  }
});

// POST reset do contador do plano (admin)
router.post('/admin/usuarios/:id/plano/resetar', autenticar, admin, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE usuarios SET plano_consultas_usadas = 0, plano_ciclo_inicio = $1
        WHERE id = $2 RETURNING id`,
      [primeiroDiaMesAtual(), req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Usuário não encontrado' });
    await pool.query(
      'INSERT INTO logs (usuario_id, acao, detalhes) VALUES ($1, $2, $3)',
      [req.usuario.id, 'Contagem do plano resetada', `usuario=${req.params.id}`]
    );
    const status = await planosUsuario.statusPlano(req.params.id);
    res.json({ ok: true, ...status });
  } catch (e) {
    console.error('[planos] reset admin:', e);
    res.status(500).json({ erro: 'Erro ao resetar plano' });
  }
});

module.exports = router;
