/**
 * RASTREIA — Pipeline pós-pagamento
 *
 * Orquestra a liberação automática de um pedido após confirmação do pagamento:
 *   1. status = 'em_andamento'
 *   2. executarConsultasParaPedido (APIs externas)
 *   3. gerar PDF (gerarDossie)
 *   4. notificar cliente concluído
 *
 * Roda em background (não bloqueia a resposta do webhook). Idempotente:
 * se o pedido já está 'concluido', sai cedo. Se falhar em alguma etapa,
 * registra em logs e deixa o pedido em estado consistente para o operador
 * concluir manualmente.
 */

const { pool } = require('../db');
const pedidoAlvos = require('./pedido_alvos');
const analiseIA = require('./analise_documentos_ia');
const { executarConsultaCompleta } = require('./consultas');
const { gerarDossie } = require('./pdf');
const { notificarClienteConcluido } = require('./whatsapp');

async function logar(pedidoId, acao, detalhes) {
  try {
    await pool.query(
      'INSERT INTO logs (pedido_id, acao, detalhes) VALUES ($1, $2, $3)',
      [pedidoId, acao, detalhes || null]
    );
  } catch (e) {
    console.warn('[pipeline] log falhou:', e.message);
  }
}

async function executarConsultas(pedido) {
  // V3: Due Diligence Imobiliária pode precisar rodar IA antes pra extrair alvos.
  if (pedido.tipo === 'due_diligence_imobiliaria') {
    const totalAlvos = await pedidoAlvos.contarAlvos(pedido.id);
    const precisaExtrair = pedido.analise_ia_status === 'aguardando_extracao' || totalAlvos === 0;
    if (precisaExtrair) {
      const out = await analiseIA.analisarDocumentosImovel(pedido.id);
      if (out?.status === 'cpf_ilegivel') {
        return { erro: 'cpf_ilegivel', mensagem: out.erro || 'IA não conseguiu extrair CPF/CNPJ' };
      }
      const refresh = await pool.query('SELECT * FROM pedidos WHERE id = $1', [pedido.id]);
      pedido = refresh.rows[0];
    }
    if (pedido.analise_ia_status === 'cpf_ilegivel') {
      return { erro: 'cpf_ilegivel', mensagem: pedido.erro_processamento || 'CPF ilegível' };
    }
  }

  const nomePlaceholder = !pedido.alvo_nome || pedido.alvo_nome === 'A identificar';
  if (nomePlaceholder) pedido.alvo_nome = '';

  const resultados = await executarConsultaCompleta(pedido);

  if (nomePlaceholder) {
    const cad = resultados.receita_federal || {};
    const nomeReal = cad.nome || cad.razao_social || cad.nome_fantasia || null;
    if (nomeReal) {
      await pool.query('UPDATE pedidos SET alvo_nome = $1 WHERE id = $2', [nomeReal, pedido.id]);
      pedido.alvo_nome = nomeReal;
    }
  }

  await pool.query('DELETE FROM dados_consulta WHERE pedido_id = $1', [pedido.id]);
  for (const [fonte, dados] of Object.entries(resultados)) {
    await pool.query(
      'INSERT INTO dados_consulta (pedido_id, fonte, dados) VALUES ($1, $2, $3)',
      [pedido.id, fonte, JSON.stringify(dados)]
    );
  }

  if (pedido.tipo === 'due_diligence_imobiliaria') {
    try { await analiseIA.analisarDocumentosImovel(pedido.id); }
    catch (e) { console.warn('[pipeline] IA pós-consultas falhou (não bloqueia):', e.message); }
  }

  return { ok: true };
}

async function gerarPDF(pedido) {
  const dadosResult = await pool.query('SELECT * FROM dados_consulta WHERE pedido_id = $1', [pedido.id]);

  try {
    pedido.alvos_consultados = await pedidoAlvos.listarAlvos(pedido.id);
  } catch (_) { pedido.alvos_consultados = []; }

  let historicoScores = [];
  try {
    const hist = await pool.query(
      `SELECT numero, score_calculado, score_classificacao, criado_em, concluido_em
       FROM pedidos
       WHERE alvo_documento = $1 AND id != $2 AND score_calculado IS NOT NULL
       ORDER BY criado_em DESC LIMIT 5`,
      [pedido.alvo_documento, pedido.id]
    );
    historicoScores = hist.rows;
  } catch (_) {}

  const dadosComHistorico = [
    ...dadosResult.rows,
    { fonte: 'historico_scores', dados: { pedidos: historicoScores } }
  ];

  const resultPdf = await gerarDossie(pedido, dadosComHistorico);
  const { url, score } = resultPdf;
  await pool.query(
    `UPDATE pedidos SET status = 'concluido', concluido_em = NOW(), relatorio_url = $1,
        score_calculado = $2, score_classificacao = $3, atualizado_em = NOW()
       WHERE id = $4`,
    [url, score?.valor ?? null, score?.classificacao ?? null, pedido.id]
  );
  return url;
}

/**
 * Roda o pipeline completo (consultas + PDF) para um pedido já PAGO.
 * Se o pedido já estiver concluído, retorna cedo.
 *
 * Retorna { ok:true, url } ou { ok:false, erro }.
 *
 * Esta função NÃO lança — captura tudo e devolve estado.
 */
async function liberarPedidoPago(pedidoId) {
  try {
    const r = await pool.query('SELECT * FROM pedidos WHERE id = $1', [pedidoId]);
    if (!r.rows.length) return { ok: false, erro: 'pedido_nao_encontrado' };
    let pedido = r.rows[0];

    if (pedido.status === 'concluido') {
      return { ok: true, url: pedido.relatorio_url, ja_concluido: true };
    }
    if (pedido.status === 'aguardando_pagamento') {
      return { ok: false, erro: 'pedido_nao_pago' };
    }

    // Se está 'pago', avança para em_andamento
    if (pedido.status === 'pago') {
      const upd = await pool.query(
        `UPDATE pedidos SET status = 'em_andamento', iniciado_em = COALESCE(iniciado_em, NOW()),
            atualizado_em = NOW() WHERE id = $1 AND status = 'pago' RETURNING *`,
        [pedido.id]
      );
      if (upd.rows.length) pedido = upd.rows[0];
      await logar(pedido.id, 'Análise iniciada (auto)', 'Disparada após confirmação de pagamento via MP');
    }

    const cons = await executarConsultas(pedido);
    if (cons.erro) {
      await logar(pedido.id, 'Pipeline auto: bloqueado nas consultas', cons.mensagem || cons.erro);
      return { ok: false, erro: cons.erro, mensagem: cons.mensagem };
    }
    await logar(pedido.id, 'Consultas automáticas executadas (auto)');

    const refresh = await pool.query('SELECT * FROM pedidos WHERE id = $1', [pedido.id]);
    pedido = refresh.rows[0];

    const url = await gerarPDF(pedido);
    await logar(pedido.id, 'Relatório gerado (auto)', `URL: ${url}`);

    try {
      const pAtual = (await pool.query('SELECT * FROM pedidos WHERE id = $1', [pedido.id])).rows[0];
      await notificarClienteConcluido(pAtual, url);
    } catch (e) {
      console.warn('[pipeline] notificação WhatsApp falhou:', e.message);
    }

    return { ok: true, url };
  } catch (e) {
    console.error('[pipeline] liberarPedidoPago erro:', e);
    try { await logar(pedidoId, 'Pipeline auto: ERRO', e.message); } catch (_) {}
    return { ok: false, erro: e.message };
  }
}

module.exports = { liberarPedidoPago };
