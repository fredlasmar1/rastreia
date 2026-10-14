/**
 * RASTREIA — Cobranças pelo Mercado Pago (além do link único do pedido).
 *
 *   parcelarPedido   → um pedido dividido em N cobranças mensais (cada uma com link)
 *   criarLote        → vários pedidos em aberto, ou mensalidades de vários clientes, de uma vez
 *   baixar           → chamado pelo webhook (ou baixa manual): marca paga e aplica o efeito
 *                       · parcela/lote de pedido: na 1ª paga, o pedido vira 'pago' e o pipeline roda
 *                       · plano: renova a cota do mês do cliente
 *   assinaturas      → cobrança mensal automática no cartão (preapproval do MP)
 *
 * Todo link aceita Pix, boleto e cartão em até 12x. external_reference:
 * 'cob:<uuid>' (cobrança) ou 'plano:<cliente_id>' (assinatura).
 */
const { pool } = require('../db');
const mp = require('./mercadopago');

const BASE = () => process.env.BASE_URL || 'https://www.recobrorastreia.com.br';
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataPura = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function somarMeses(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const ult = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(d.getDate(), ult));   // 31/01 + 1 mês = 28/02
  return r;
}

async function log(pedidoId, usuarioId, acao, detalhes) {
  if (!pedidoId) return;
  try { await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)', [pedidoId, usuarioId || null, acao, detalhes || null]); } catch (_) {}
}

// Gera (ou regera) o link do MP de uma cobrança. Vale até 10 dias depois do vencimento.
async function gerarLink(cob, { payerEmail } = {}) {
  const venc = cob.vencimento ? dataPura(cob.vencimento instanceof Date ? iso(cob.vencimento) : cob.vencimento) : null;
  const expira = venc ? new Date(venc.getTime() + 10 * 24 * 3600 * 1000) : new Date(Date.now() + 7 * 24 * 3600 * 1000);
  if (expira < new Date()) expira.setTime(Date.now() + 7 * 24 * 3600 * 1000);   // vencida: link novo vale 7 dias
  const out = await mp.criarPreferenceGenerica({
    titulo: cob.descricao || 'Cobrança Recobro', valor: cob.valor, referencia: `cob:${cob.id}`, expiraEm: expira, payerEmail,
    voltarPara: cob.pedido_id ? `${BASE()}/pedido.html?id=${cob.pedido_id}` : BASE()
  });
  if (!out.ok) return out;
  await pool.query('UPDATE cobrancas SET mp_preference_id = $1, mp_init_point = $2 WHERE id = $3', [out.preference_id, out.init_point, cob.id]);
  return { ok: true, init_point: out.init_point };
}

async function inserir(c) {
  const r = await pool.query(
    `INSERT INTO cobrancas (origem, pedido_id, cliente_id, descricao, numero, total, valor, vencimento, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [c.origem, c.pedido_id || null, c.cliente_id || null, c.descricao || null, c.numero || null, c.total || null, c.valor, c.vencimento || null, c.criado_por || null]);
  return r.rows[0];
}

/**
 * Divide um pedido em N cobranças mensais. O valor é dividido em partes iguais
 * (a última absorve o arredondamento). O pedido é liberado quando a 1ª é paga.
 */
async function parcelarPedido(pedidoId, { parcelas, primeiroVencimento, usuarioId }) {
  const n = Math.round(Number(parcelas));
  if (!(n >= 2 && n <= 12)) return { ok: false, erro: 'Escolha de 2 a 12 parcelas.' };
  const p = (await pool.query('SELECT * FROM pedidos WHERE id = $1 AND deletado_em IS NULL', [pedidoId])).rows[0];
  if (!p) return { ok: false, erro: 'Pedido não encontrado' };
  if (p.status !== 'aguardando_pagamento') return { ok: false, erro: 'Só dá para dividir um pedido que ainda não foi pago.' };
  const total = Number(p.valor);
  if (!(total > 0)) return { ok: false, erro: 'Pedido sem valor.' };
  const ja = await pool.query("SELECT 1 FROM cobrancas WHERE pedido_id = $1 AND status <> 'cancelada' LIMIT 1", [pedidoId]);
  if (ja.rows.length) return { ok: false, erro: 'Este pedido já tem cobranças. Cancele as abertas para refazer.' };
  const v1 = dataPura(primeiroVencimento) || new Date();
  // Em centavos: 19,90 / 2 em ponto flutuante dá 9,9499… e virava 9,94 + 9,96
  const centavos = Math.round(total * 100);
  const parteC = Math.floor(centavos / n);
  const criadas = [];
  for (let i = 0; i < n; i++) {
    const valor = (i === n - 1 ? centavos - parteC * (n - 1) : parteC) / 100;
    const cob = await inserir({
      origem: 'parcela', pedido_id: p.id, cliente_id: p.cliente_id, numero: i + 1, total: n, valor,
      vencimento: iso(somarMeses(v1, i)), descricao: `Pedido #${p.numero} — parcela ${i + 1}/${n}`, criado_por: usuarioId
    });
    const l = await gerarLink(cob, { payerEmail: p.cliente_email });
    criadas.push({ ...cob, mp_init_point: l.ok ? l.init_point : null, erro_link: l.ok ? null : l.erro });
  }
  await pool.query("UPDATE pedidos SET forma_pagamento = 'parcelado', atualizado_em = NOW() WHERE id = $1", [p.id]);
  await log(p.id, usuarioId, 'Cobrança dividida em parcelas', `${n}× a partir de ${iso(v1).split('-').reverse().join('/')} — ${brl(total)} (liberado na 1ª parcela paga)`);
  return { ok: true, cobrancas: criadas };
}

/**
 * Lote:
 *   { pedido_ids: [...] }                         → um link para cada pedido em aberto
 *   { clientes: [{ cliente_id, valor, descricao }]} → mensalidade/cobrança avulsa por cliente
 */
async function criarLote({ pedido_ids = [], clientes = [], vencimento, usuarioId }) {
  const venc = vencimento && dataPura(vencimento) ? vencimento : iso(new Date());
  const out = [];
  for (const id of pedido_ids.slice(0, 100)) {
    const p = (await pool.query('SELECT * FROM pedidos WHERE id = $1 AND deletado_em IS NULL', [id])).rows[0];
    if (!p || p.status !== 'aguardando_pagamento' || !(Number(p.valor) > 0)) { out.push({ pedido_id: id, ok: false, erro: 'Pedido não está em aberto' }); continue; }
    const aberta = (await pool.query("SELECT * FROM cobrancas WHERE pedido_id = $1 AND status = 'aberta' ORDER BY numero NULLS FIRST LIMIT 1", [id])).rows[0];
    const cob = aberta || await inserir({ origem: 'lote', pedido_id: p.id, cliente_id: p.cliente_id, valor: p.valor, vencimento: venc, descricao: `Pedido #${p.numero} — ${p.alvo_nome || p.tipo}`, criado_por: usuarioId });
    const l = cob.mp_init_point ? { ok: true, init_point: cob.mp_init_point } : await gerarLink(cob, { payerEmail: p.cliente_email });
    out.push({ pedido_id: p.id, numero: p.numero, cliente: p.cliente_nome, whatsapp: p.cliente_whatsapp, valor: Number(cob.valor), cobranca_id: cob.id, ok: l.ok, link: l.ok ? l.init_point : null, erro: l.ok ? null : l.erro });
  }
  for (const c of clientes.slice(0, 100)) {
    const cli = (await pool.query('SELECT * FROM clientes WHERE id = $1', [c.cliente_id])).rows[0];
    const valor = Number(c.valor ?? cli?.plano_valor_mensal);
    if (!cli || !(valor > 0)) { out.push({ cliente_id: c.cliente_id, ok: false, erro: 'Cliente sem valor de mensalidade' }); continue; }
    const desc = c.descricao || `Mensalidade ${cli.plano_nome || 'plano'} — ${cli.nome}`;
    const cob = await inserir({ origem: 'plano', cliente_id: cli.id, valor, vencimento: venc, descricao: desc, criado_por: usuarioId });
    const l = await gerarLink(cob, { payerEmail: cli.email });
    out.push({ cliente_id: cli.id, cliente: cli.nome, whatsapp: cli.whatsapp, valor, cobranca_id: cob.id, ok: l.ok, link: l.ok ? l.init_point : null, erro: l.ok ? null : l.erro });
  }
  return { ok: true, itens: out };
}

// Renova a cota do mês do plano do cliente (mensalidade paga)
async function renovarPlano(clienteId, origem) {
  await pool.query(
    `UPDATE clientes SET plano_usadas = '{}'::jsonb, plano_consultas_usadas = 0,
            plano_ciclo_inicio = date_trunc('month', NOW())::date, atualizado_em = NOW() WHERE id = $1`, [clienteId]);
  console.log(`[cobrancas] plano do cliente ${clienteId} renovado (${origem})`);
}

/**
 * Baixa uma cobrança (idempotente). forma: 'mercadopago' | 'manual'.
 * Efeito: parcela/lote de pedido → o pedido fica pago na 1ª baixa e o pipeline roda;
 * plano → renova a cota do cliente.
 */
async function baixar(cobId, { paymentId = null, forma = 'mercadopago', usuarioId = null } = {}) {
  const r = await pool.query(
    `UPDATE cobrancas SET status = 'paga', pago_em = NOW(), mp_payment_id = $2, forma_baixa = $3
      WHERE id = $1 AND status = 'aberta' RETURNING *`, [cobId, paymentId ? String(paymentId) : null, forma]);
  if (!r.rows.length) return { ok: true, ja_baixada: true };
  const cob = r.rows[0];
  if (cob.pedido_id) {
    await log(cob.pedido_id, usuarioId, 'Cobrança paga', `${cob.descricao || ''} — ${brl(cob.valor)} (${forma}${paymentId ? ' ' + paymentId : ''})`);
    const up = await pool.query(
      `UPDATE pedidos SET status = 'pago', pago_em = NOW(), mp_payment_id = COALESCE(mp_payment_id, $2),
              forma_pagamento = COALESCE(forma_pagamento, $3), atualizado_em = NOW()
        WHERE id = $1 AND status = 'aguardando_pagamento' RETURNING id`,
      [cob.pedido_id, paymentId ? String(paymentId) : null, cob.origem === 'parcela' ? 'parcelado' : (forma === 'manual' ? 'dinheiro' : 'mercadopago')]);
    if (up.rows.length) {
      const { liberarPedidoPago } = require('./pipeline_pedido');
      liberarPedidoPago(cob.pedido_id).catch(e => console.error('[cobrancas] pipeline:', e.message));
    }
  }
  if (cob.origem === 'plano' && cob.cliente_id) await renovarPlano(cob.cliente_id, `cobrança ${cob.id}`);
  return { ok: true, cobranca: cob };
}

// Pagamento de assinatura (external_reference 'plano:<cliente_id>') aprovado
async function pagamentoDeAssinatura(clienteId, paymentId, valor) {
  const dup = await pool.query('SELECT 1 FROM cobrancas WHERE mp_payment_id = $1', [String(paymentId)]);
  if (dup.rows.length) return { ok: true, ja_baixada: true };
  const cli = (await pool.query('SELECT * FROM clientes WHERE id = $1', [clienteId])).rows[0];
  if (!cli) return { ok: false, erro: 'cliente não encontrado' };
  await pool.query(
    `INSERT INTO cobrancas (origem, cliente_id, descricao, valor, vencimento, status, mp_payment_id, forma_baixa, pago_em)
     VALUES ('plano', $1, $2, $3, CURRENT_DATE, 'paga', $4, 'assinatura', NOW())`,
    [cli.id, `Assinatura ${cli.plano_nome || 'plano'} — ${cli.nome}`, Number(valor) || Number(cli.plano_valor_mensal) || 0, String(paymentId)]);
  await pool.query("UPDATE clientes SET assinatura_status = 'authorized', assinatura_ultimo_pagamento = NOW() WHERE id = $1", [cli.id]);
  await renovarPlano(cli.id, `assinatura, pagamento ${paymentId}`);
  return { ok: true };
}

// ── Assinatura mensal no cartão ────────────────────────────────────────────
async function criarAssinatura(clienteId, { valor } = {}) {
  const cli = (await pool.query('SELECT * FROM clientes WHERE id = $1', [clienteId])).rows[0];
  if (!cli) return { ok: false, erro: 'Cliente não encontrado' };
  const v = Number(valor ?? cli.plano_valor_mensal);
  if (!(v > 0)) return { ok: false, erro: 'Defina o valor da mensalidade do plano antes.' };
  if (!cli.email) return { ok: false, erro: 'O Mercado Pago exige o e-mail do cliente para a assinatura. Cadastre o e-mail.' };
  if (cli.mp_preapproval_id && ['pending', 'authorized'].includes(cli.assinatura_status)) return { ok: true, ja_existe: true, link: cli.assinatura_link, status: cli.assinatura_status };
  const out = await mp.criarAssinatura({ titulo: `Plano ${cli.plano_nome || 'mensal'} — Recobro`, valor: v, referencia: `plano:${cli.id}`, payerEmail: cli.email, voltarPara: BASE() });
  if (!out.ok) return out;
  await pool.query('UPDATE clientes SET mp_preapproval_id = $1, assinatura_status = $2, assinatura_link = $3, plano_valor_mensal = $4 WHERE id = $5',
    [out.preapproval_id, out.status || 'pending', out.init_point, v, cli.id]);
  return { ok: true, link: out.init_point, status: out.status || 'pending' };
}

async function atualizarStatusAssinatura(preapprovalId) {
  const r = await mp.consultarAssinatura(preapprovalId);
  if (!r.ok) return r;
  const ref = String(r.dados.external_reference || '');
  const clienteId = ref.startsWith('plano:') ? ref.slice(6) : null;
  if (clienteId) await pool.query('UPDATE clientes SET assinatura_status = $1 WHERE id = $2 AND mp_preapproval_id = $3', [r.dados.status, clienteId, preapprovalId]);
  return { ok: true, status: r.dados.status, cliente_id: clienteId };
}

async function cancelarAssinatura(clienteId) {
  const cli = (await pool.query('SELECT * FROM clientes WHERE id = $1', [clienteId])).rows[0];
  if (!cli || !cli.mp_preapproval_id) return { ok: false, erro: 'Cliente sem assinatura.' };
  const r = await mp.cancelarAssinatura(cli.mp_preapproval_id);
  if (!r.ok) return r;
  await pool.query("UPDATE clientes SET assinatura_status = 'cancelled' WHERE id = $1", [cli.id]);
  return { ok: true };
}

module.exports = { parcelarPedido, criarLote, baixar, gerarLink, pagamentoDeAssinatura, criarAssinatura, atualizarStatusAssinatura, cancelarAssinatura, renovarPlano, somarMeses };
