/**
 * RASTREIA — Envio de email via SMTP (nodemailer)
 *
 * Configuração via env:
 *   SMTP_HOST  — host do servidor SMTP
 *   SMTP_PORT  — porta (465 SSL, 587 STARTTLS, 25 sem TLS)
 *   SMTP_USER  — usuário/login (geralmente o email remetente)
 *   SMTP_PASS  — senha de app
 *   SMTP_FROM  — remetente exibido (ex: "RASTREIA <noreply@recobrorastreia.com.br>"). Default: SMTP_USER.
 *   SMTP_SECURE — "true" força TLS implícito (porta 465). Se ausente, infere por porta.
 *
 * Se SMTP_HOST/SMTP_USER/SMTP_PASS não estiverem configurados, qualquer chamada
 * de envio lança um erro explícito para o caller informar ao usuário.
 */

const nodemailer = require('nodemailer');

let transporterCache = null;

function configurado() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function obterTransporter() {
  if (!configurado()) {
    throw new Error('SMTP não configurado. Defina SMTP_HOST, SMTP_USER e SMTP_PASS.');
  }
  if (transporterCache) return transporterCache;

  const port = Number(process.env.SMTP_PORT || 587);
  const secureEnv = (process.env.SMTP_SECURE || '').toLowerCase();
  const secure = secureEnv ? secureEnv === 'true' : port === 465;

  transporterCache = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return transporterCache;
}

function fmtMoeda(v) {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function enviarLinkPagamento({ para, nomeCliente, valor, link, numeroPedido, nomeProduto }) {
  if (!para) throw new Error('Email do destinatário é obrigatório');
  if (!link) throw new Error('Link de pagamento é obrigatório');

  const transporter = obterTransporter();
  const remetente = process.env.SMTP_FROM || process.env.SMTP_USER;

  const valorFmt = fmtMoeda(valor);
  const protocolo = numeroPedido ? `#${numeroPedido}` : '';
  const produtoTxt = nomeProduto ? ` (${nomeProduto})` : '';

  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
    <div style="background:#1a3a5c;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
      <div style="font-size:18px;font-weight:700">RASTREIA</div>
      <div style="font-size:12px;opacity:0.85">Recobro Recuperação de Crédito</div>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 8px 8px">
      <p style="margin:0 0 14px;font-size:15px">Olá, ${escHtml(nomeCliente || 'cliente')}!</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.55">
        Segue o link para pagamento da sua consulta${escHtml(produtoTxt)}${protocolo ? ' — protocolo ' + escHtml(protocolo) : ''}, no valor de
        <strong>${escHtml(valorFmt)}</strong>.
      </p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.55">
        O pagamento é processado pelo Mercado Pago (Pix, cartão de crédito ou boleto).
        Após a confirmação, sua consulta será liberada automaticamente.
      </p>
      <p style="text-align:center;margin:24px 0">
        <a href="${escHtml(link)}" style="background:#16a34a;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block">
          Pagar agora
        </a>
      </p>
      <p style="margin:14px 0 0;font-size:12px;color:#6b7280;line-height:1.55">
        Se o botão acima não funcionar, copie e cole este endereço no navegador:<br>
        <span style="word-break:break-all;color:#2563eb">${escHtml(link)}</span>
      </p>
      <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="margin:0;font-size:11px;color:#6b7280">
        Esta é uma cobrança da Recobro Recuperação de Crédito | Anápolis-GO.
        Em caso de dúvida, responda este email.
      </p>
    </div>
  </div>`;

  const texto = `Olá, ${nomeCliente || 'cliente'}!

Segue o link para pagamento da sua consulta${produtoTxt}${protocolo ? ' — protocolo ' + protocolo : ''}, no valor de ${valorFmt}.

Pagar agora: ${link}

Recobro Recuperação de Crédito | Anápolis-GO`;

  const info = await transporter.sendMail({
    from: remetente,
    to: para,
    subject: `RASTREIA — Link de pagamento${protocolo ? ' ' + protocolo : ''}`,
    text: texto,
    html
  });
  return { ok: true, messageId: info.messageId };
}

module.exports = { enviarLinkPagamento, configurado };
