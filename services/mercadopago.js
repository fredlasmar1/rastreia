/**
 * RASTREIA — Integração Mercado Pago (SDK oficial)
 *
 * Fluxo:
 *  1. criarPreferenceParaPedido(pedido)  → cria checkout (init_point)
 *  2. Cliente paga no MP
 *  3. Webhook (POST /api/mercadopago/webhook) recebe { type:"payment", data:{ id } }
 *  4. consultarPagamento(paymentId) lê o pagamento, pega external_reference (= pedido.id)
 *  5. Se status === 'approved' → marca pedido como pago e dispara o pipeline
 *
 * Token: aceita MERCADOPAGO_ACCESS_TOKEN (preferencial) ou MP_ACCESS_TOKEN (legado).
 */

const crypto = require('crypto');

// SDK oficial. Se não estiver instalado por algum motivo, falha cedo com mensagem clara.
let MercadoPagoConfig, Preference, Payment;
try {
  ({ MercadoPagoConfig, Preference, Payment } = require('mercadopago'));
} catch (_) {
  console.warn('[MP] SDK "mercadopago" não instalado. Rode: npm i mercadopago');
}

const PROD_BASE_URL = 'https://www.recobrorastreia.com.br';

function getToken() {
  return process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || '';
}

function baseUrl() {
  return process.env.BASE_URL || PROD_BASE_URL;
}

function getClient() {
  const token = getToken();
  if (!token) return null;
  if (!MercadoPagoConfig) return null;
  return new MercadoPagoConfig({
    accessToken: token,
    options: { timeout: 15000 }
  });
}

/**
 * Cria a preference (checkout) para um pedido.
 * Retorna { ok:true, init_point, preference_id } ou { ok:false, erro }.
 *
 * IMPORTANTE: external_reference = pedido.id (UUID). É o que o webhook usa
 * para localizar o pedido depois.
 */
async function criarPreferenceParaPedido(pedido, opts = {}) {
  const client = getClient();
  if (!client) {
    return { ok: false, erro: 'MERCADOPAGO_ACCESS_TOKEN não configurado ou SDK indisponível' };
  }

  const nomeProduto = opts.nomeProduto || pedido.tipo || 'Consulta Recobro';
  const numero = pedido.numero ? `#${pedido.numero}` : String(pedido.id).slice(0, 8);

  // PIX expira em 24h por padrão (MP recomenda definir explicitamente para garantir
  // que PIX apareça como opção). ISO-8601 com offset.
  const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('Z', '-03:00');

  // E-mail da conta MP dona — se o e-mail do cliente bater com este, o MP esconde
  // PIX/saldo ("você não pode pagar a si mesmo"). Nesse caso não enviamos payer.email.
  const ownerEmail = (process.env.MERCADOPAGO_OWNER_EMAIL || '').toLowerCase().trim();
  const clienteEmail = pedido.cliente_email
    ? String(pedido.cliente_email).toLowerCase().trim()
    : '';

  const body = {
    items: [{
      id: String(pedido.id),
      title: `${nomeProduto} — Pedido ${numero}`,
      quantity: 1,
      unit_price: Number(pedido.valor),
      currency_id: 'BRL'
    }],
    external_reference: String(pedido.id),
    back_urls: {
      success: `${baseUrl()}/pedido.html?id=${pedido.id}`,
      failure: `${baseUrl()}/pedido.html?id=${pedido.id}`,
      pending: `${baseUrl()}/pedido.html?id=${pedido.id}`
    },
    auto_return: 'approved',
    notification_url: `${baseUrl()}/api/mercadopago/webhook`,
    metadata: { pedido_id: String(pedido.id) },
    // payment_methods sem exclusões = TODOS os métodos disponíveis na conta
    // (cartão, PIX, boleto). PIX só aparece se a conta MP tiver chave PIX cadastrada.
    payment_methods: {
      excluded_payment_methods: [],
      excluded_payment_types: [],
      installments: 12
    },
    date_of_expiration: expiraEm
  };

  if (clienteEmail && clienteEmail !== ownerEmail) {
    body.payer = { email: String(pedido.cliente_email) };
  }

  try {
    const pref = new Preference(client);
    const created = await pref.create({ body });
    return {
      ok: true,
      init_point: created.init_point || created.sandbox_init_point,
      preference_id: created.id
    };
  } catch (e) {
    const msg = e?.cause?.[0]?.description || e?.message || 'Erro desconhecido';
    console.error('[MP] criarPreference erro:', msg, e?.cause || '');
    return { ok: false, erro: msg };
  }
}

/**
 * Consulta um pagamento pelo ID.
 * Retorna o objeto bruto do MP (status, external_reference, payer, etc.)
 * ou { erro } em falha.
 */
async function consultarPagamento(paymentId) {
  const client = getClient();
  if (!client) return { erro: 'MERCADOPAGO_ACCESS_TOKEN não configurado' };
  try {
    const pay = new Payment(client);
    const data = await pay.get({ id: String(paymentId) });
    return data;
  } catch (e) {
    const msg = e?.message || 'Erro ao consultar pagamento';
    console.error('[MP] consultarPagamento erro:', msg);
    return { erro: msg };
  }
}

/**
 * Validação opcional do header `x-signature` enviado pelo MP.
 * Doc: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 *
 * Retorna:
 *   true  → assinatura válida
 *   false → assinatura inválida (rejeitar)
 *   null  → MERCADOPAGO_WEBHOOK_SECRET não configurado, não foi possível validar
 */
function validarAssinaturaWebhook(req) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET || process.env.MP_WEBHOOK_SECRET;
  if (!secret) return null;

  const xSignature = req.headers['x-signature'] || '';
  const xRequestId = req.headers['x-request-id'] || '';
  if (!xSignature) return false;

  const parts = String(xSignature).split(',').reduce((acc, p) => {
    const [k, v] = p.split('=').map(s => s && s.trim());
    if (k && v) acc[k] = v;
    return acc;
  }, {});
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const dataId = (req.query && (req.query['data.id'] || req.query.id)) ||
                 (req.body && req.body.data && req.body.data.id) || '';

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(v1, 'hex'));
  } catch (_) {
    return false;
  }
}

function configurado() {
  return !!getToken();
}

module.exports = {
  criarPreferenceParaPedido,
  consultarPagamento,
  validarAssinaturaWebhook,
  configurado,
  // Compat: shim p/ não quebrar código antigo durante a transição.
  criarPreferencia: async (pedido, nomeProduto) => {
    const out = await criarPreferenceParaPedido(pedido, { nomeProduto });
    if (out.ok) return { preference_id: out.preference_id, init_point: out.init_point };
    return { erro: out.erro };
  }
};
