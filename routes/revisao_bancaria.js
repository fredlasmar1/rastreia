/**
 * Rotas da Revisão de Contrato Bancário — /api/revisao-bancaria/:pedidoId
 *
 *   GET    /:pedidoId              estado da revisão + documentos + campos para a conferência
 *   POST   /:pedidoId/extrair      (re)faz a extração IA dos documentos
 *   PUT    /:pedidoId/conferencia  salva os dados conferidos; { confirmar: true } avança para o cálculo
 *
 * As etapas de cálculo, revisão jurídica e laudo ficam neste mesmo arquivo
 * (entregas 5 e 6). Toda escrita passa por services/revisao_bancaria.js
 * (lock por pedido + log).
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { autenticar } = require('./auth');
const revisao = require('../services/revisao_bancaria');

async function carregarPedido(id) {
  const r = await pool.query("SELECT id, numero, tipo, status, alvo_nome, alvo_documento, alvo_tipo FROM pedidos WHERE id = $1 AND deletado_em IS NULL", [id]);
  return r.rows[0] && r.rows[0].tipo === revisao.TIPO ? r.rows[0] : null;
}

// Valores iniciais da conferência: conferidos > extraídos > informados no pedido
function camposIniciais(reg, pedido) {
  if (reg.dados_conferidos) return reg.dados_conferidos;
  const ex = reg.dados_extraidos || {};
  const inf = reg.dados_informados || {};
  const op = ex.operacao || {};
  const doc = String(pedido.alvo_documento || '').replace(/\D/g, '');
  return {
    pfpj: doc.length === 14 ? 'PJ' : 'PF',
    tipo_operacao: inf.tipo_operacao || null,
    subtipo: null,
    situacao: inf.situacao || null,
    parcelas_pagas: inf.parcelas_pagas ?? null,
    instituicao: { nome: ex.instituicao?.nome || inf.banco || null, cnpj: ex.instituicao?.cnpj || null },
    contratante: { nome: ex.contratante?.nome || pedido.alvo_nome || null, cpf_cnpj: ex.contratante?.cpf_cnpj || pedido.alvo_documento || null },
    operacao: {
      ...op,
      data_contratacao: op.data_contratacao || inf.data_contratacao || null,
      valor_financiado_total: op.valor_financiado_total ?? inf.valor_financiado ?? null,
      valor_parcela: op.valor_parcela ?? inf.valor_parcela ?? null,
      prazo_meses: op.prazo_meses ?? inf.prazo_meses ?? null
    },
    garantia: ex.garantia || {},
    tarifas: ex.tarifas || [],
    seguros: ex.seguros || [],
    iof: ex.iof || {},
    encargos_mora: ex.encargos_mora || {},
    campos_editados: []
  };
}

router.get('/:pedidoId', autenticar, async (req, res) => {
  try {
    const pedido = await carregarPedido(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ erro: 'Revisão de Contrato Bancário não encontrada' });
    const reg = await revisao.obter(pedido.id);
    if (!reg) return res.status(404).json({ erro: 'Registro da revisão ausente' });
    const docs = (await pool.query('SELECT id, tipo, filename, size_bytes, mime_type, criado_em FROM pedido_documentos WHERE pedido_id = $1 ORDER BY id', [pedido.id])).rows;
    const extr = reg.dados_extraidos || {};
    const u = (await pool.query('SELECT perfil, pode_revisar_juridico FROM usuarios WHERE id = $1', [req.usuario.id])).rows[0] || {};
    res.json({
      pedido, etapa: reg.etapa, documentos: docs,
      campos: camposIniciais(reg, pedido),
      confianca: extr.confianca_por_campo || {},
      paginas: extr.paginas_relevantes || [],
      alertas_leitura: extr.alertas_leitura || [],
      extraido: !!reg.dados_extraidos,
      conferido: !!reg.dados_conferidos,
      taxa_media_bacen: reg.taxa_media_bacen, calculo: reg.calculo ? { ...reg.calculo, tabela_contratada: undefined } : null,
      teses: reg.teses, veredito: reg.veredito, economia_estimada: reg.economia_estimada,
      parecer_ia: reg.parecer_ia, parecer_juridico: reg.parecer_juridico,
      revisor_id: reg.revisor_id, revisado_em: reg.revisado_em, versao_calculo: reg.versao_calculo,
      pode_revisar_juridico: !!u.pode_revisar_juridico
    });
  } catch (e) {
    console.error('[revisao-bancaria] GET:', e);
    res.status(500).json({ erro: 'Erro ao carregar a revisão' });
  }
});

router.post('/:pedidoId/extrair', autenticar, async (req, res) => {
  try {
    const pedido = await carregarPedido(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ erro: 'Revisão não encontrada' });
    const reg = await revisao.obter(pedido.id);
    if (['revisao_juridica', 'aprovado'].includes(reg?.etapa)) return res.status(409).json({ erro: 'A revisão já passou da conferência.' });
    const out = await require('../services/revisao_bancaria_ia').extrairContrato(pedido.id, { forcar: true, usuarioId: req.usuario.id });
    res.status(out.ok ? 200 : 422).json(out);
  } catch (e) {
    console.error('[revisao-bancaria] extrair:', e);
    res.status(500).json({ erro: 'Erro na extração' });
  }
});

router.put('/:pedidoId/conferencia', autenticar, async (req, res) => {
  try {
    const pedido = await carregarPedido(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ erro: 'Revisão não encontrada' });
    const reg = await revisao.obter(pedido.id);
    if (['revisao_juridica', 'aprovado'].includes(reg.etapa)) return res.status(409).json({ erro: 'Dados já em revisão jurídica — devolva para conferência antes de editar.' });
    const dados = req.body && req.body.dados;
    if (!dados || typeof dados !== 'object' || !dados.operacao) return res.status(400).json({ erro: 'Envie os dados do contrato.' });
    const confirmar = !!req.body.confirmar;
    const campos = { dados_conferidos: { ...dados, conferido_por: req.usuario.id, conferido_em: new Date().toISOString() } };
    await revisao.atualizar(pedido.id, {
      etapa: confirmar ? 'calculando' : reg.etapa === 'aguardando_documentos' ? 'conferencia_operador' : reg.etapa,
      campos, usuarioId: req.usuario.id,
      acao: confirmar ? 'Revisão bancária: dados confirmados pelo operador' : 'Revisão bancária: conferência salva',
      detalhes: (dados.campos_editados || []).length ? `Editados manualmente: ${dados.campos_editados.join(', ')}` : ''
    });
    let calculo = null;
    if (confirmar) {
      let processar = null;
      try { processar = require('../services/revisao_bancaria_fluxo').processarCalculo; } catch (_) { /* entrega 5 */ }
      if (processar) calculo = await processar(pedido.id, req.usuario.id);
    }
    res.json({ ok: true, etapa: (await revisao.obter(pedido.id)).etapa, calculo });
  } catch (e) {
    console.error('[revisao-bancaria] conferencia:', e);
    res.status(500).json({ erro: 'Erro ao salvar a conferência' });
  }
});

module.exports = router;
