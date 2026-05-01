/**
 * RASTREIA — Plano de cota mensal por usuário (operador)
 *
 * Cada usuário do sistema pode ter um plano com cota mensal de consultas.
 * Quando uma consulta é cobrada "do plano", debitamos 1 da cota; ao virar o
 * mês, o contador zera automaticamente (reset preguiçoso, no primeiro acesso
 * do novo ciclo).
 *
 * Colunas relevantes em usuarios:
 *   plano_cota_mensal      INT  — 0 = sem plano, >0 = limite mensal
 *   plano_consultas_usadas INT  — contador do ciclo atual
 *   plano_ciclo_inicio     DATE — 1º dia do mês do ciclo atual
 */

const { pool } = require('../db');

function primeiroDiaMesAtual() {
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
}

function mesmoMesAno(d1, d2) {
  if (!d1 || !d2) return false;
  const a = new Date(d1);
  const b = new Date(d2);
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

// Carrega o usuário e, se o ciclo virou (mês mudou) ou nunca foi iniciado,
// reseta consultas_usadas e ajusta ciclo_inicio para o 1º dia do mês atual.
async function resetarSeNecessario(usuarioId) {
  const r = await pool.query(
    'SELECT id, plano_cota_mensal, plano_consultas_usadas, plano_ciclo_inicio FROM usuarios WHERE id = $1',
    [usuarioId]
  );
  if (!r.rows.length) return null;
  const u = r.rows[0];

  const inicioMes = primeiroDiaMesAtual();
  const cicloAtual = u.plano_ciclo_inicio;
  const precisaResetar = !cicloAtual || !mesmoMesAno(cicloAtual, inicioMes);

  if (precisaResetar) {
    const upd = await pool.query(
      `UPDATE usuarios SET plano_consultas_usadas = 0, plano_ciclo_inicio = $1
        WHERE id = $2
        RETURNING id, plano_cota_mensal, plano_consultas_usadas, plano_ciclo_inicio`,
      [inicioMes, usuarioId]
    );
    return upd.rows[0];
  }
  return u;
}

async function statusPlano(usuarioId) {
  const u = await resetarSeNecessario(usuarioId);
  if (!u) return { cota_mensal: 0, consultas_usadas: 0, restantes: 0, ciclo_inicio: null };
  const cota = Number(u.plano_cota_mensal || 0);
  const usadas = Number(u.plano_consultas_usadas || 0);
  return {
    cota_mensal: cota,
    consultas_usadas: usadas,
    restantes: Math.max(cota - usadas, 0),
    ciclo_inicio: u.plano_ciclo_inicio
  };
}

async function podeDebitarPlano(usuarioId) {
  const s = await statusPlano(usuarioId);
  if (!s.cota_mensal || s.cota_mensal <= 0) {
    return { ok: false, restantes: 0, cota: 0, erro: 'Sem plano ativo. Procure um administrador.' };
  }
  if (s.restantes <= 0) {
    return { ok: false, restantes: 0, cota: s.cota_mensal, erro: 'Cota mensal do plano esgotada. Renova no próximo mês.' };
  }
  return { ok: true, restantes: s.restantes, cota: s.cota_mensal };
}

// Debita 1 consulta. Atômico: usa UPDATE condicional para evitar passar do limite
// mesmo com chamadas concorrentes.
async function debitarPlano(usuarioId) {
  await resetarSeNecessario(usuarioId);
  const r = await pool.query(
    `UPDATE usuarios
        SET plano_consultas_usadas = plano_consultas_usadas + 1
      WHERE id = $1
        AND plano_cota_mensal > 0
        AND plano_consultas_usadas < plano_cota_mensal
      RETURNING plano_cota_mensal, plano_consultas_usadas`,
    [usuarioId]
  );
  if (!r.rows.length) {
    return { ok: false, restantes: 0, erro: 'Cota esgotada ou sem plano ativo' };
  }
  const { plano_cota_mensal, plano_consultas_usadas } = r.rows[0];
  return {
    ok: true,
    restantes: Math.max(plano_cota_mensal - plano_consultas_usadas, 0),
    cota: plano_cota_mensal,
    usadas: plano_consultas_usadas
  };
}

module.exports = { resetarSeNecessario, statusPlano, podeDebitarPlano, debitarPlano };
