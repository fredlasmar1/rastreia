// services/pedido_alvos.js
//
// V3 — Tabela pedido_alvos: 1 linha por alvo consultado em um pedido de
// Due Diligence Imobiliária. Cada alvo dispara as consultas externas
// (DirectData, Escavador, etc.) uma vez. A IA pode extrair múltiplos
// proprietários dos documentos (matrícula/escritura) e cada um vira um alvo.
//
// Idempotência: insert ON CONFLICT DO NOTHING por (pedido_id, documento).

const { pool } = require('../db');

const MAX_ALVOS = 5; // limite duro: pedidos com >5 proprietários geram alerta

function digSafe(s) { return String(s || '').replace(/\D/g, ''); }

function inferirTipoDoc(doc) {
  const d = digSafe(doc);
  if (d.length === 11) return 'cpf';
  if (d.length === 14) return 'cnpj';
  return null;
}

function docLegivel(doc) {
  const d = digSafe(doc);
  return d.length === 11 || d.length === 14;
}

// Insere um alvo em pedido_alvos. Idempotente (não duplica documento).
// Retorna { id, criado: true|false } ou null se documento inválido.
async function adicionarAlvo(pedidoId, { nome, documento, origem = 'manual', principal = false }) {
  const docLimpo = digSafe(documento);
  if (!docLegivel(docLimpo)) return null;
  const tipo = inferirTipoDoc(docLimpo);
  const r = await pool.query(
    `INSERT INTO pedido_alvos (pedido_id, nome, documento, tipo_documento, origem, principal)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (pedido_id, documento) DO NOTHING
     RETURNING id`,
    [pedidoId, (nome || '').toString().trim() || null, docLimpo, tipo, origem, !!principal]
  );
  if (r.rows.length) return { id: r.rows[0].id, criado: true };
  return { criado: false };
}

// Lista alvos do pedido (principal primeiro, depois por id).
async function listarAlvos(pedidoId) {
  const r = await pool.query(
    `SELECT id, nome, documento, tipo_documento, origem, principal, criado_em
       FROM pedido_alvos
      WHERE pedido_id = $1
      ORDER BY principal DESC, id ASC`,
    [pedidoId]
  );
  return r.rows;
}

// Garante que há pelo menos 1 linha em pedido_alvos refletindo o alvo principal
// do pedido (alvo_documento). Idempotente. Usado quando o pedido é criado com
// CPF informado manualmente (compatibilidade — fluxo antigo) ou quando o
// operador adiciona alvo via UI.
async function sincronizarAlvoPrincipal(pedido) {
  if (!pedido?.alvo_documento) return null;
  return adicionarAlvo(pedido.id, {
    nome: pedido.alvo_nome,
    documento: pedido.alvo_documento,
    origem: 'manual',
    principal: true
  });
}

// Atualiza pedidos.alvo_documento/alvo_nome/alvo_tipo a partir do primeiro alvo
// em pedido_alvos. Garante compat com PDF/listagens que ainda leem do pedido.
async function atualizarAlvoPrincipalEmPedido(pedidoId) {
  const r = await pool.query(
    `SELECT nome, documento, tipo_documento
       FROM pedido_alvos
      WHERE pedido_id = $1
      ORDER BY principal DESC, id ASC
      LIMIT 1`,
    [pedidoId]
  );
  if (!r.rows.length) return;
  const a = r.rows[0];
  const tipoMaiusculo = a.tipo_documento === 'cnpj' ? 'PJ' : 'PF';
  await pool.query(
    `UPDATE pedidos
        SET alvo_documento = COALESCE(NULLIF(alvo_documento, ''), $1),
            alvo_nome = COALESCE(NULLIF(alvo_nome, ''), NULLIF($2, '')),
            alvo_tipo = COALESCE(NULLIF(alvo_tipo, ''), $3),
            atualizado_em = NOW()
      WHERE id = $4`,
    [a.documento, a.nome || '', tipoMaiusculo, pedidoId]
  );
}

// Conta quantos alvos um pedido tem (cap em MAX_ALVOS).
async function contarAlvos(pedidoId) {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM pedido_alvos WHERE pedido_id = $1', [pedidoId]);
  return r.rows[0]?.n || 0;
}

module.exports = {
  MAX_ALVOS,
  adicionarAlvo,
  listarAlvos,
  sincronizarAlvoPrincipal,
  atualizarAlvoPrincipalEmPedido,
  contarAlvos,
  digSafe,
  docLegivel,
  inferirTipoDoc
};
