const axios = require('axios');

const MP_BASE = 'https://api.mercadopago.com';

function getToken() {
  return process.env.MP_ACCESS_TOKEN;
}

async function criarPreferencia(pedido, nomeProduto) {
  const token = getToken();
  if (!token) return { erro: 'MP_ACCESS_TOKEN nao configurado' };
  try {
    const baseUrl = process.env.BASE_URL || 'https://rastreia-production.up.railway.app';
    const res = await axios.post(
      `${MP_BASE}/checkout/preferences`,
      {
        items: [{ title: nomeProduto, quantity: 1, unit_price: parseFloat(pedido.valor), currency_id: 'BRL' }],
        external_reference: pedido.id,
        back_urls: {
          success: `${baseUrl}/pedido.html?id=${pedido.id}`,
          failure: `${baseUrl}/pedido.html?id=${pedido.id}`,
          pending: `${baseUrl}/pedido.html?id=${pedido.id}`
        },
        auto_return: 'approved',
        notification_url: `${baseUrl}/webhook/mp`,
        payment_methods: { installments: 1 }
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    return { preference_id: res.data.id, init_point: res.data.init_point };
  } catch (e) {
    console.error('[MP] Erro:', e.response?.data || e.message);
    return { erro: e.response?.data?.message || e.message };
  }
}

async function consultarPagamento(paymentId) {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await axios.get(`${MP_BASE}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 10000
    });
    return res.data;
  } catch (e) {
    console.error('[MP] Erro pagamento:', e.message);
    return null;
  }
}

module.exports = { criarPreferencia, consultarPagamento };
