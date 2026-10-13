/**
 * RASTREIA — Laudo da Revisão de Contrato Bancário (após aprovação jurídica)
 *
 *   concluirRevisao(pedidoId, revisor)
 *     1. gera o PDF (services/pdf/revisao_contrato_bancario.js)
 *     2. pedido → concluido com relatorio_url
 *     3. WhatsApp + e-mail ao cliente com link assinado (30 dias)
 *     4. veredito forte/moderada → oportunidade no CRM do Balladão
 *        (BALLADAO_CRM_WEBHOOK_URL; vazia ou falhou ⇒ registra em logs e
 *        avisa o admin no WhatsApp)
 *
 * Idempotente: um lock de sessão por pedido impede dois laudos ao mesmo
 * tempo, e a troca para 'concluido' é condicional (status <> 'concluido') —
 * só quem fez a troca envia mensagens. Se o PDF falhar, a etapa continua
 * 'aprovado' e o "Aprovar" pode ser repetido (gera de novo, sem duplicar).
 */
const axios = require('axios');
const { pool } = require('../db');
const revisao = require('./revisao_bancaria');
const { assinar, VALIDADE } = require('./link_relatorio');
const { enviarMensagem } = require('./whatsapp');

const BASE = () => process.env.BASE_URL || 'https://www.recobrorastreia.com.br';
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NIVEL = { forte: 'FORTE', moderada: 'MODERADA', fraca: 'FRACA', inviavel: 'INVIÁVEL' };

async function log(pedidoId, usuarioId, acao, detalhes) {
  try { await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)', [pedidoId, usuarioId || null, acao, detalhes || null]); }
  catch (e) { console.error('[revisao-laudo] log:', e.message); }
}

async function carregarRevisor(revisor, revisorId) {
  if (revisor && revisor.nome && revisor.oab) return revisor;
  const id = (revisor && revisor.id) || revisorId;
  if (!id) return revisor || {};
  const r = await pool.query('SELECT id, nome, oab FROM usuarios WHERE id = $1', [id]);
  return r.rows[0] || revisor || {};
}

// Mensagem ao cliente: resumo com números do cálculo + link + convite
function mensagemCliente(pedido, reg, linkAbs, wppBalladao) {
  const calc = reg.calculo || {};
  const nivel = calc.veredito?.nivel || reg.veredito;
  const banco = reg.dados_conferidos?.instituicao?.nome || 'o banco';
  const linhas = [
    '⚖️ *Laudo de Revisão de Contrato Bancário*', '',
    `Olá, ${pedido.cliente_nome || 'cliente'}!`, '',
    `O laudo do seu contrato com ${banco} está pronto (protocolo #${pedido.numero}).`,
    `• Viabilidade da revisão: *${NIVEL[nivel] || nivel}*`
  ];
  if (calc.bacen && calc.razao != null) linhas.push(`• Sua taxa: ${(calc.taxa.efetiva_am * 100).toFixed(2).replace('.', ',')}% a.m. — média do Banco Central: ${(calc.bacen.am * 100).toFixed(2).replace('.', ',')}% a.m.`);
  if (Number(calc.economia_estimada) > 0) linhas.push(`• Economia estimada: *${brl(calc.economia_estimada)}*`);
  linhas.push('', `📄 Laudo completo: ${linkAbs}`, '');
  if (['forte', 'moderada'].includes(nivel)) {
    linhas.push(wppBalladao
      ? `Quer saber como recuperar esse valor? Fale com o Balladão Advogados: https://wa.me/${String(wppBalladao).replace(/\D/g, '')}`
      : 'Quer saber como recuperar esse valor? Responda esta mensagem e o Balladão Advogados entra em contato.');
  } else {
    linhas.push('Ficou com dúvida? Responda esta mensagem.');
  }
  linhas.push('', '_Não interrompa os pagamentos sem orientação jurídica._', '_Recobro Recuperação de Crédito | Anápolis-GO_');
  return linhas.join('\n');
}

async function enviarEmail(pedido, reg, linkAbs) {
  const email = require('./email');
  if (!pedido.cliente_email || !email.configurado()) return { enviado: false, motivo: !pedido.cliente_email ? 'sem e-mail' : 'SMTP não configurado' };
  const calc = reg.calculo || {};
  await email.enviarLaudoRevisao({
    para: pedido.cliente_email, nomeCliente: pedido.cliente_nome, numeroPedido: pedido.numero, link: linkAbs,
    veredito: NIVEL[calc.veredito?.nivel || reg.veredito] || '', economia: calc.economia_estimada,
    banco: reg.dados_conferidos?.instituicao?.nome || ''
  });
  return { enviado: true };
}

// Oportunidade para o Balladão (forte/moderada)
async function encaminharBalladao(pedido, reg, linkAbs, usuarioId) {
  const calc = reg.calculo || {};
  const nivel = calc.veredito?.nivel || reg.veredito;
  if (!['forte', 'moderada'].includes(nivel)) return { encaminhado: false, motivo: `veredito ${nivel}` };
  const d = reg.dados_conferidos || {};
  const payload = {
    origem: 'rastreia', produto: 'revisao_contrato_bancario', pedido_id: pedido.id, protocolo: pedido.numero,
    contratante: { nome: d.contratante?.nome || pedido.alvo_nome, documento: d.contratante?.cpf_cnpj || pedido.alvo_documento },
    contato: { nome: pedido.cliente_nome, whatsapp: pedido.cliente_whatsapp || null, email: pedido.cliente_email || null },
    banco: d.instituicao?.nome || null, tipo_operacao: d.tipo_operacao || null, situacao: d.situacao || null,
    veredito: nivel, economia_estimada: Math.round((calc.economia_estimada || 0) * 100) / 100,
    taxa_contratada_am: calc.taxa?.efetiva_am != null ? Math.round(calc.taxa.efetiva_am * 1e6) / 1e4 : null,
    taxa_bacen_am: calc.bacen ? Math.round(calc.bacen.am * 1e6) / 1e4 : null,
    laudo_url: linkAbs
  };
  const url = process.env.BALLADAO_CRM_WEBHOOK_URL;
  const resumo = `${payload.contratante.nome} × ${payload.banco || 'banco'} — ${NIVEL[nivel]}, economia ${brl(payload.economia_estimada)}`;
  if (url) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (process.env.BALLADAO_CRM_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.BALLADAO_CRM_WEBHOOK_TOKEN}`;
      const r = await axios.post(url, payload, { headers, timeout: 15000 });
      await log(pedido.id, usuarioId, 'Revisão bancária: oportunidade enviada ao Balladão', `${resumo} (HTTP ${r.status})`);
      return { encaminhado: true, via: 'webhook' };
    } catch (e) {
      await log(pedido.id, usuarioId, 'Revisão bancária: falha no webhook do Balladão', `${resumo} — ${e.response?.status || e.code || e.message}`);
    }
  } else {
    await log(pedido.id, usuarioId, 'Revisão bancária: oportunidade para o Balladão (sem webhook)', resumo);
  }
  // Sem webhook (ou falhou): avisa o admin no WhatsApp
  const admin = (await revisao.config('revisao_aviso_whatsapp', '')) || process.env.WHATSAPP_OPERADOR;
  if (admin) {
    await enviarMensagem(admin, `⚖️ *RASTREIA — Oportunidade para o Balladão*\n\n${resumo}\nContato: ${pedido.cliente_nome}${pedido.cliente_whatsapp ? ' — ' + pedido.cliente_whatsapp : ''}\nProtocolo #${pedido.numero}\n📄 ${linkAbs}`);
  }
  return { encaminhado: true, via: url ? 'admin (webhook falhou)' : 'admin' };
}

async function concluirRevisao(pedidoId, revisor) {
  const client = await pool.connect();
  let travou = false;
  try {
    const lk = await client.query("SELECT pg_try_advisory_lock(hashtext('laudo:' || $1)) AS ok", [String(pedidoId)]);
    travou = lk.rows[0].ok;
    if (!travou) return { ok: true, em_andamento: true };

    const pedido = (await client.query('SELECT * FROM pedidos WHERE id = $1', [pedidoId])).rows[0];
    if (!pedido) return { ok: false, erro: 'Pedido não encontrado' };
    if (pedido.status === 'concluido' && pedido.relatorio_url) return { ok: true, ja_concluido: true, url: pedido.relatorio_url };

    const reg = await revisao.obter(pedidoId);
    if (!reg || reg.etapa !== 'aprovado' || !reg.parecer_juridico || !reg.revisor_id) {
      return { ok: false, erro: 'Laudo bloqueado: falta parecer jurídico aprovado.' };
    }
    const rev = await carregarRevisor(revisor, reg.revisor_id);
    const wpp = await revisao.config('balladao_whatsapp', '');

    const { gerarDossie } = require('./pdf');
    const pdf = await gerarDossie({ ...pedido, __revisao: { registro: reg, revisor: rev, balladaoWhatsapp: wpp } }, []);

    const up = await client.query(
      `UPDATE pedidos SET status = 'concluido', concluido_em = NOW(), relatorio_url = $1, atualizado_em = NOW()
        WHERE id = $2 AND status <> 'concluido' RETURNING id`, [pdf.url, pedidoId]);
    if (!up.rows.length) return { ok: true, ja_concluido: true, url: pdf.url };
    await log(pedidoId, rev.id, 'Laudo de revisão bancária gerado e pedido concluído', `${reg.veredito} · ${brl(reg.economia_estimada)} · revisor ${rev.nome || ''}${rev.oab ? ' OAB ' + rev.oab : ''}`);

    // Envios: falha de um não impede os outros nem desfaz a conclusão
    const linkAbs = BASE() + assinar(pdf.url, VALIDADE.WHATSAPP);
    const envios = {};
    if (pedido.cliente_whatsapp) {
      try { await enviarMensagem(pedido.cliente_whatsapp, mensagemCliente(pedido, reg, linkAbs, wpp)); envios.whatsapp = true; }
      catch (e) { envios.whatsapp = false; }
    }
    try { envios.email = await enviarEmail(pedido, reg, linkAbs); }
    catch (e) { envios.email = { enviado: false, motivo: e.message }; await log(pedidoId, rev.id, 'Revisão bancária: falha no e-mail do laudo', e.message); }
    try { envios.balladao = await encaminharBalladao(pedido, reg, linkAbs, rev.id); }
    catch (e) { envios.balladao = { encaminhado: false, motivo: e.message }; }

    return { ok: true, concluido: true, url: pdf.url, envios };
  } finally {
    if (travou) { try { await client.query("SELECT pg_advisory_unlock(hashtext('laudo:' || $1))", [String(pedidoId)]); } catch (_) {} }
    client.release();
  }
}

module.exports = { concluirRevisao, mensagemCliente, encaminharBalladao };
