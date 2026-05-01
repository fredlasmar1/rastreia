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

module.exports = router;
