const express = require('express');
const axios = require('axios');
const { autenticar, admin } = require('./auth');

const router = express.Router();

router.get('/infosimples', autenticar, admin, async (req, res) => {
  const { slug, cnpj, extra } = req.query;
  if (!slug || !cnpj) {
    return res.status(400).json({ erro: 'slug e cnpj são obrigatórios' });
  }
  const url = `https://api.infosimples.com/api/v2/consultas/${slug}`;
  const body = { token: process.env.INFOSIMPLES_TOKEN, timeout: 30, cnpj: cnpj.replace(/\D/g, '') };
  if (extra) {
    try {
      Object.assign(body, JSON.parse(extra));
    } catch (e) {
      return res.status(400).json({ erro: 'extra deve ser JSON válido', detalhe: e.message });
    }
  }
  try {
    const r = await axios.post(url, body, { timeout: 35000 });
    res.json({ ok: true, status: r.status, data: r.data });
  } catch (e) {
    res.json({ ok: false, status: e.response?.status, data: e.response?.data, erro: e.message });
  }
});

// Inspeciona uma preferência MP para verificar quais métodos de pagamento o MP
// está oferecendo (PIX, cartão, etc). Use após criar um pedido para validar o fix.
router.get('/mp-preference', autenticar, admin, async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ erro: 'id da preferência é obrigatório' });
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ erro: 'MERCADOPAGO_ACCESS_TOKEN não configurado' });
  try {
    const r = await axios.get(`https://api.mercadopago.com/checkout/preferences/${id}`, {
      headers: { Authorization: `Bearer ${token.trim()}` },
      timeout: 15000
    });
    // resumo focado em métodos de pagamento
    const data = r.data || {};
    res.json({
      ok: true,
      id: data.id,
      init_point: data.init_point,
      payment_methods: data.payment_methods,
      date_of_expiration: data.date_of_expiration,
      payer: data.payer,
      items: data.items,
      raw: data
    });
  } catch (e) {
    res.json({ ok: false, status: e.response?.status, data: e.response?.data, erro: e.message });
  }
});

// Lista os meios de pagamento disponíveis para a conta dona do ACCESS_TOKEN.
// Se PIX não aparecer aqui, significa que a conta MP não tem PIX habilitado para
// recebimento (mesmo que tenha chave PIX para uso pessoal).
router.get('/mp-payment-methods', autenticar, admin, async (req, res) => {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ erro: 'MERCADOPAGO_ACCESS_TOKEN não configurado' });
  try {
    const r = await axios.get('https://api.mercadopago.com/v1/payment_methods', {
      headers: { Authorization: `Bearer ${token.trim()}` },
      timeout: 15000
    });
    const todos = r.data || [];
    const pix = todos.filter(m => (m.id||'').toLowerCase().includes('pix') || (m.payment_type_id||'').toLowerCase().includes('bank_transfer'));
    const resumo = todos.map(m => ({ id: m.id, name: m.name, payment_type_id: m.payment_type_id, status: m.status }));
    res.json({ ok: true, total: todos.length, pix_disponivel: pix.length > 0, pix, resumo });
  } catch (e) {
    res.json({ ok: false, status: e.response?.status, data: e.response?.data, erro: e.message });
  }
});

module.exports = router;
