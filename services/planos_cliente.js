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
// ── Cota POR PRODUTO (09/10/2026) ───────────────────────────────────────────
// plano_cotas  JSONB  {"consulta_restricoes": 20, "analise_inquilino": 6}
// plano_usadas JSONB  {"consulta_restricoes": 3,  "analise_inquilino": 1}
// Com plano_cotas, cada pedido debita do balde do PRÓPRIO produto — um plano de
// Veicular Simples (R$ 8,90/consulta) não pode ser gasto num Dossiê (custo R$ 22,41).
// Produto fora do plano = cobra avulso. Sem plano_cotas, vale a cota única antiga.
// O crédito não acumula: na virada do mês tudo zera (reset preguiçoso).
const NOMES_PRODUTO = {
  consulta_restricoes: 'Nome Limpo ou Sujo',
  analise_inquilino: 'Análise de Inquilino',
  dossie_pf: 'Dossiê PF',
  dossie_pj: 'Dossiê PJ',
  analise_devedor: 'Análise de Devedor',
  consulta_veicular_simples: 'Veicular Simples',
  consulta_veicular_mediana: 'Veicular Mediana',
  consulta_veicular_completa: 'Veicular Completa'
};

function _cotasValidas(cotas) {
  if (!cotas || typeof cotas !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(cotas)) {
    const n = parseInt(v, 10);
    if (/^[a-z_]+$/.test(k) && n > 0) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

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
      `UPDATE clientes SET plano_consultas_usadas = 0, plano_usadas = '{}'::jsonb, plano_ciclo_inicio = $1, atualizado_em = NOW()
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
    'SELECT plano_nome, plano_cota_mensal, plano_consultas_usadas, plano_ciclo_inicio, plano_valor_mensal, plano_cotas, plano_usadas FROM clientes WHERE id = $1 AND ativo = true',
    [clienteId]
  );
  if (!r.rows.length) return null;
  const u = r.rows[0];
  const cota = Number(u.plano_cota_mensal || 0);
  const usadas = Number(u.plano_consultas_usadas || 0);
  const cotas = _cotasValidas(u.plano_cotas);
  const usadasTipo = u.plano_usadas || {};
  return {
    plano_nome: u.plano_nome || null,
    cota_mensal: cota,
    consultas_usadas: usadas,
    restantes: Math.max(cota - usadas, 0),
    // Por produto (quando o plano define): [{tipo, nome, cota, usadas, restantes}]
    por_produto: cotas ? Object.entries(cotas).map(([tipo, c]) => {
      const us = Number(usadasTipo[tipo] || 0);
      return { tipo, nome: NOMES_PRODUTO[tipo] || tipo, cota: c, usadas: us, restantes: Math.max(c - us, 0) };
    }) : null,
    ciclo_inicio: u.plano_ciclo_inicio,
    valor_mensal: Number(u.plano_valor_mensal || 0),
    ativo: cota > 0
  };
}

// Define/edita o plano do cliente. cota=0 (e sem cotas) remove o plano.
// cotas (opcional): {tipo: quantidade} — então cota_mensal vira a soma.
async function definirPlano(clienteId, { plano_nome, cota_mensal, valor_mensal, cotas }) {
  const porTipo = _cotasValidas(cotas);
  const cota = porTipo
    ? Object.values(porTipo).reduce((a, b) => a + b, 0)
    : Math.max(0, parseInt(cota_mensal, 10) || 0);
  const valor = Math.max(0, parseFloat(valor_mensal) || 0);
  const nome = cota > 0 ? (plano_nome || 'Personalizado') : null;
  // Ao ativar um plano sem ciclo definido, inicia o ciclo no mês atual.
  const r = await pool.query(
    `UPDATE clientes
        SET plano_nome = $1,
            plano_cota_mensal = $2,
            plano_valor_mensal = $3,
            plano_cotas = $6::jsonb,
            plano_ciclo_inicio = CASE WHEN $2 > 0 AND plano_ciclo_inicio IS NULL THEN $4 ELSE plano_ciclo_inicio END,
            plano_consultas_usadas = CASE WHEN $2 = 0 THEN 0 ELSE plano_consultas_usadas END,
            plano_usadas = CASE WHEN $2 = 0 THEN '{}'::jsonb ELSE COALESCE(plano_usadas, '{}'::jsonb) END,
            atualizado_em = NOW()
      WHERE id = $5 AND ativo = true
      RETURNING id`,
    [nome, cota, valor, primeiroDiaMesAtual(), clienteId, porTipo ? JSON.stringify(porTipo) : null]
  );
  if (!r.rows.length) return { ok: false, erro: 'Cliente não encontrado' };
  return { ok: true, status: await statusPlano(clienteId) };
}

// Registra 1 consulta entregue (debita da cota). Atômico.
// tipo: produto do pedido — obrigatório quando o plano tem cota por produto.
async function debitar(clienteId, tipo) {
  await resetarSeNecessario(clienteId);
  const s0 = await statusPlano(clienteId);
  if (!s0 || !s0.ativo) return { ok: false, erro: 'Cliente sem plano ativo.' };

  if (s0.por_produto) {
    const balde = s0.por_produto.find(b => b.tipo === tipo);
    if (!balde) {
      const inclui = s0.por_produto.map(b => b.nome).join(' e ');
      return { ok: false, erro: `O plano ${s0.plano_nome} cobre ${inclui}. ${NOMES_PRODUTO[tipo] || 'Este produto'} é cobrado avulso.`, status: s0 };
    }
    const r = await pool.query(
      `UPDATE clientes
          SET plano_usadas = jsonb_set(COALESCE(plano_usadas, '{}'::jsonb), ARRAY[$2::text],
                to_jsonb(COALESCE((plano_usadas->>$2)::int, 0) + 1)),
              plano_consultas_usadas = plano_consultas_usadas + 1,
              atualizado_em = NOW()
        WHERE id = $1 AND ativo = true
          AND COALESCE((plano_usadas->>$2)::int, 0) < COALESCE((plano_cotas->>$2)::int, 0)
        RETURNING id`,
      [clienteId, tipo]
    );
    if (!r.rows.length) return { ok: false, erro: `Cota de ${balde.nome} esgotada neste mês.`, status: await statusPlano(clienteId) };
    return { ok: true, status: await statusPlano(clienteId) };
  }

  const r = await pool.query(
    `UPDATE clientes
        SET plano_consultas_usadas = plano_consultas_usadas + 1, atualizado_em = NOW()
      WHERE id = $1 AND ativo = true
        AND plano_cota_mensal > 0
        AND plano_consultas_usadas < plano_cota_mensal
      RETURNING plano_cota_mensal, plano_consultas_usadas`,
    [clienteId]
  );
  if (!r.rows.length) return { ok: false, erro: 'Cota mensal esgotada.', status: await statusPlano(clienteId) };
  return { ok: true, status: await statusPlano(clienteId) };
}

// Desfaz 1 consulta (corrige erro). Não deixa negativo.
async function creditar(clienteId, tipo) {
  if (tipo) {
    await pool.query(
      `UPDATE clientes
          SET plano_usadas = jsonb_set(COALESCE(plano_usadas, '{}'::jsonb), ARRAY[$2::text],
                to_jsonb(GREATEST(COALESCE((plano_usadas->>$2)::int, 0) - 1, 0))),
              plano_consultas_usadas = GREATEST(plano_consultas_usadas - 1, 0),
              atualizado_em = NOW()
        WHERE id = $1 AND ativo = true AND COALESCE((plano_usadas->>$2)::int, 0) > 0`,
      [clienteId, tipo]
    );
  } else {
    await pool.query(
      `UPDATE clientes
          SET plano_consultas_usadas = GREATEST(plano_consultas_usadas - 1, 0), atualizado_em = NOW()
        WHERE id = $1 AND ativo = true`,
      [clienteId]
    );
  }
  return { ok: true, status: await statusPlano(clienteId) };
}

// Zera o contador do ciclo manualmente.
async function resetar(clienteId) {
  await pool.query(
    `UPDATE clientes SET plano_consultas_usadas = 0, plano_usadas = '{}'::jsonb, plano_ciclo_inicio = $1, atualizado_em = NOW()
      WHERE id = $2 AND ativo = true`,
    [primeiroDiaMesAtual(), clienteId]
  );
  return { ok: true, status: await statusPlano(clienteId) };
}

module.exports = { statusPlano, definirPlano, debitar, creditar, resetar, resetarSeNecessario, NOMES_PRODUTO };
