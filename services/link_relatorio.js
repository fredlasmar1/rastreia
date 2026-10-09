/**
 * RASTREIA — Link assinado do PDF do relatório
 *
 * O PDF tem CPF, telefones e endereços: não pode abrir para quem só tem o
 * caminho /relatorios/arquivo.pdf. O banco guarda o caminho puro; toda
 * resposta que entrega o link passa por assinar(), que acrescenta validade
 * e assinatura HMAC (JWT_SECRET):
 *   /relatorios/x.pdf?exp=1791600000&sig=Ab3...
 *
 * Validades:
 *   - painel (operador logado): 12h — mesma duração do JWT
 *   - página pública de acompanhamento: 24h — é refeita a cada visita
 *   - WhatsApp para o cliente: 30 dias
 */
const crypto = require('crypto');
const path = require('path');

const VALIDADE = {
  PAINEL: 12 * 3600,
  PUBLICO: 24 * 3600,
  WHATSAPP: 30 * 24 * 3600
};

function _sig(filename, exp) {
  const segredo = process.env.JWT_SECRET || '';
  return crypto.createHmac('sha256', segredo).update(`${filename}|${exp}`).digest('base64url').slice(0, 32);
}

// Recebe '/relatorios/x.pdf' (ou já assinado) e devolve com ?exp=&sig=
function assinar(relUrl, validadeSeg = VALIDADE.PAINEL) {
  if (!relUrl || typeof relUrl !== 'string') return relUrl;
  const base = relUrl.split('?')[0];
  if (!base.startsWith('/relatorios/')) return relUrl;
  const filename = path.basename(base);
  const exp = Math.floor(Date.now() / 1000) + validadeSeg;
  return `${base}?exp=${exp}&sig=${_sig(filename, exp)}`;
}

// true se a assinatura confere e não venceu
function verificar(filename, exp, sig) {
  const e = Number(exp);
  if (!filename || !e || !sig || typeof sig !== 'string') return false;
  if (e < Math.floor(Date.now() / 1000)) return false;
  const esperado = _sig(path.basename(filename), e);
  const a = Buffer.from(esperado);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Assina o relatorio_url de uma linha (ou lista de linhas) de pedido
function assinarPedido(p, validadeSeg = VALIDADE.PAINEL) {
  if (Array.isArray(p)) return p.map(x => assinarPedido(x, validadeSeg));
  if (p && p.relatorio_url) return { ...p, relatorio_url: assinar(p.relatorio_url, validadeSeg) };
  return p;
}

module.exports = { assinar, verificar, assinarPedido, VALIDADE };
