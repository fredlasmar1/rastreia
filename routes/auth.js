const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'Email e senha obrigatórios' });

    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND ativo = true', [email]);
    if (result.rows.length === 0) return res.status(401).json({ erro: 'Credenciais inválidas' });

    const usuario = result.rows[0];
    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida) return res.status(401).json({ erro: 'Credenciais inválidas' });

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, perfil: usuario.perfil, nome: usuario.nome },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil } });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// Criar usuário (admin only)
router.post('/usuarios', autenticar, admin, async (req, res) => {
  try {
    const { nome, email, senha, perfil } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios' });
    if (senha.length < 6) return res.status(400).json({ erro: 'Senha deve ter no mínimo 6 caracteres' });
    if (!['admin', 'operador'].includes(perfil || 'operador')) {
      return res.status(400).json({ erro: "Perfil deve ser 'admin' ou 'operador'" });
    }
    const hash = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      'INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4) RETURNING id, nome, email, perfil, ativo, criado_em',
      [nome.trim(), email.trim().toLowerCase(), hash, perfil || 'operador']
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: e.code === '23505' ? 'Email já cadastrado' : 'Erro ao criar usuário' });
  }
});

// Listar usuários (admin only)
router.get('/usuarios', autenticar, admin, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, nome, email, perfil, ativo, criado_em FROM usuarios ORDER BY criado_em DESC'
    );
    res.json({ usuarios: r.rows });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao listar usuários' });
  }
});

// Atualizar usuário: nome/perfil/ativo/senha (admin only)
router.patch('/usuarios/:id', autenticar, admin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, perfil, ativo, senha } = req.body;

    // Não permite desativar a si mesmo
    if (id === req.usuario.id && ativo === false) {
      return res.status(400).json({ erro: 'Você não pode desativar sua própria conta' });
    }

    const campos = [];
    const valores = [];
    let idx = 1;

    if (typeof nome === 'string' && nome.trim()) {
      campos.push(`nome = $${idx++}`); valores.push(nome.trim());
    }
    if (perfil !== undefined) {
      if (!['admin', 'operador'].includes(perfil)) {
        return res.status(400).json({ erro: "Perfil deve ser 'admin' ou 'operador'" });
      }
      campos.push(`perfil = $${idx++}`); valores.push(perfil);
    }
    if (typeof ativo === 'boolean') {
      campos.push(`ativo = $${idx++}`); valores.push(ativo);
    }
    if (typeof senha === 'string' && senha.length > 0) {
      if (senha.length < 6) return res.status(400).json({ erro: 'Senha deve ter no mínimo 6 caracteres' });
      const hash = await bcrypt.hash(senha, 10);
      campos.push(`senha_hash = $${idx++}`); valores.push(hash);
    }

    if (campos.length === 0) {
      return res.status(400).json({ erro: 'Nada para atualizar' });
    }

    valores.push(id);
    const result = await pool.query(
      `UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${idx}
       RETURNING id, nome, email, perfil, ativo, criado_em`,
      valores
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Erro ao atualizar usuário:', e);
    res.status(500).json({ erro: 'Erro ao atualizar usuário' });
  }
});

// Trocar senha
router.post('/trocar-senha', autenticar, async (req, res) => {
  try {
    const { senha_atual, nova_senha } = req.body;
    if (!senha_atual || !nova_senha) return res.status(400).json({ erro: 'Senha atual e nova senha são obrigatórias' });
    if (nova_senha.length < 6) return res.status(400).json({ erro: 'Nova senha deve ter no mínimo 6 caracteres' });
    const result = await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    const valida = await bcrypt.compare(senha_atual, result.rows[0].senha_hash);
    if (!valida) return res.status(400).json({ erro: 'Senha atual incorreta' });
    const hash = await bcrypt.hash(nova_senha, 10);
    await pool.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, req.usuario.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao trocar senha' });
  }
});

function autenticar(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ erro: 'Não autenticado' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

function admin(req, res, next) {
  if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Acesso negado' });
  next();
}

module.exports = router;
module.exports.autenticar = autenticar;
module.exports.admin = admin;
