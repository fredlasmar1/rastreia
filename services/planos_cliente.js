/**
 * RASTREIA — Plano de cota mensal por CLIENTE (mensalista)
 *
 * Espelha services/planos_usuario.js, mas no nível do CLIENTE (tabela clientes).
 * Cada cliente pode ter um plano mensal: uma cota de consultas/dossiês inclusos.
 * O operador (solo) registra cada entrega com debitar() — o sistema controla o
 * saldo do mês e zera o contador automaticamente na virada do mês (reset preguiçoso).
 *
 * Colunas em `clientes` (ver db/schema.sql):
 *   plano_nome             VARCHAR  — rótulo do plano (Essencial/Profissional/Conta-chave/Personalizado)
 *   plano_cota_mensal      INT      — 0 = sem plano, >0 = limite mensal
 *   plano_consultas_usadas INT      — contador do ciclo atual
 *   plano_ciclo_inicio     DATE     — 1º dia do mês do ciclo vigente
 *   plano_valor_mensal     NUMERIC  — mensalidade (referência comercial)
 */

const { pool } = require('../db');

function primeiroDiaMesAtual() {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), 1);
}

function mesmoMesAno(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
}

// Reset preguiçoso: se o ciclo é de um mês anterior, zera o contador.
async function resetarSeNecessario(clienteId) {
  const r = await pool.query(
    'SELECT id, plano_cota_mensal, plano_consultas_usadas, plano_ciclo_inicio FROM clientes WHERE id = $1 AND ativo = true',
    [clienteId]
  );
  if (!r.rows.length) return null;
  const c = r.rows[0];
  const inicio = c.plano_ciclo_inicio ? new Date(c.plano_ciclo_inicio) : null;
  if (Number(c.plano_cota_mensal) > 0 && (!inicio || !mesmoMesAno(inicio, new Date()))) {
    const upd = await pool.query(
      `UPDATE clientes SET plano_consultas_usadas = 0, plano_ciclo_inicio = $1, atualizado_em = NOW()
        WHERE id = $2
        RETURNING id, plano_nome, plano_cota_mensal, plano_consultas_usadas, plano_ciclo_inicio, plano_valor_mensal`,
      [primeiroDiaMesAtual(), clienteId]
    );
    return upd.rows[0];
  }
  return c;
}

async function statusPlano(clienteId) {
  await resetarSeNecessario(clienteId);
  const r = await pool.query(
    'SELECT plano_nome, plano_cota_mensal, plano_consultas_usadas, plano_ciclo_inicio, plano_valor_mensal FROM clientes WHERE id = $1 AND ativo = true',
    [clienteId]
  );
  if (!r.rows.length) return null;
  const u = r.rows[0];
  const cota = Number(u.plano_cota_mensal || 0);
  const usadas = Number(u.plano_consultas_usadas || 0);
  return {
    plano_nome: u.plano_nome || null,
    cota_mensal: cota,
    consultas_usadas: usadas,
    restantes: Math.max(cota - usadas, 0),
    ciclo_inicio: u.plano_ciclo_inicio,
    valor_mensal: Number(u.plano_valor_mensal || 0),
    ativo: cota > 0
  };
}

// Define/edita o plano do cliente. cota=0 remove o plano.
async function definirPlano(clienteId, { plano_nome, cota_mensal, valor_mensal }) {
  const cota = Math.max(0, parseInt(cota_mensal, 10) || 0);
  const valor = Math.max(0, parseFloat(valor_mensal) || 0);
  const nome = cota > 0 ? (plano_nome || 'Personalizado') : null;
  // Ao ativar um plano sem ciclo definido, inicia o ciclo no mês atual.
  const r = await pool.query(
    `UPDATE clientes
        SET plano_nome = $1,
            plano_cota_mensal = $2,
            plano_valor_mensal = $3,
            plano_ciclo_inicio = CASE WHEN $2 > 0 AND plano_ciclo_inicio IS NULL THEN $4 ELSE plano_ciclo_inicio END,
            plano_consultas_usadas = CASE WHEN $2 = 0 THEN 0 ELSE plano_consultas_usadas END,
            atualizado_em = NOW()
      WHERE id = $5 AND ativo = true
      RETURNING id`,
    [nome, cota, valor, primeiroDiaMesAtual(), clienteId]
  );
  if (!r.rows.length) return { ok: false, erro: 'Cliente não encontrado' };
  return { ok: true, status: await statusPlano(clienteId) };
}

// Registra 1 consulta entregue (debita da cota). Atômico.
async function debitar(clienteId) {
  await resetarSeNecessario(clienteId);
  const r = await pool.query(
    `UPDATE clientes
        SET plano_consultas_usadas = plano_consultas_usadas + 1, atualizado_em = NOW()
      WHERE id = $1 AND ativo = true
        AND plano_cota_mensal > 0
        AND plano_consultas_usadas < plano_cota_mensal
      RETURNING plano_cota_mensal, plano_consultas_usadas`,
    [clienteId]
  );
  if (!r.rows.length) {
    const s = await statusPlano(clienteId);
    if (!s || !s.ativo) return { ok: false, erro: 'Cliente sem plano ativo.' };
    return { ok: false, erro: 'Cota mensal esgotada.', status: s };
  }
  return { ok: true, status: await statusPlano(clienteId) };
}

// Desfaz 1 consulta (corrige erro). Não deixa negativo.
async function creditar(clienteId) {
  await pool.query(
    `UPDATE clientes
        SET plano_consultas_usadas = GREATEST(plano_consultas_usadas - 1, 0), atualizado_em = NOW()
      WHERE id = $1 AND ativo = true`,
    [clienteId]
  );
  return { ok: true, status: await statusPlano(clienteId) };
}

// Zera o contador do ciclo manualmente.
async function resetar(clienteId) {
  await pool.query(
    `UPDATE clientes SET plano_consultas_usadas = 0, plano_ciclo_inicio = $1, atualizado_em = NOW()
      WHERE id = $2 AND ativo = true`,
    [primeiroDiaMesAtual(), clienteId]
  );
  return { ok: true, status: await statusPlano(clienteId) };
}

module.exports = { statusPlano, definirPlano, debitar, creditar, resetar, resetarSeNecessario };
