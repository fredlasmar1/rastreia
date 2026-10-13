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
const { assinar } = require('../services/link_relatorio');

async function carregarPedido(id) {
  const r = await pool.query("SELECT id, numero, tipo, status, relatorio_url, alvo_nome, alvo_documento, alvo_tipo FROM pedidos WHERE id = $1 AND deletado_em IS NULL", [id]);
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
    pfpj: ex.classificacao?.pfpj || (doc.length === 14 ? 'PJ' : 'PF'),
    tipo_operacao: inf.tipo_operacao || ex.classificacao?.tipo_operacao || null,
    subtipo: ex.classificacao?.subtipo || null,
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

// ── Análise rápida: sobe o contrato → IA lê → código calcula → veredito preliminar ──
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const analise = require('../services/revisao_analise');
const { UPLOADS_DIR } = require('../services/storage_paths');
const MIMES_ANALISE = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
// multer entrega o nome em latin1: "Certidão.pdf" vira "CertidÃ£o.pdf"
const nomeUtf8 = (n) => { const t = Buffer.from(String(n || 'arquivo'), 'latin1').toString('utf8'); return /�/.test(t) ? String(n) : t; };
const uploadAnalise = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_DIR, 'analises', req.analiseId);
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}_${nomeUtf8(file.originalname).replace(/[^A-Za-z0-9._-]/g, '_').slice(-120)}`)
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => (MIMES_ANALISE.has((file.mimetype || '').toLowerCase()) ? cb(null, true) : cb(new Error('Use PDF, JPG ou PNG.')))
});
const resumoAnalise = (a) => {
  if (!a) return a;
  const c = a.calculo;
  const leve = c ? { ...c, tabela_contratada: undefined, cenarios: Object.fromEntries(Object.entries(c.cenarios || {}).map(([k, v]) => [k, { ...v, tabela: undefined }])) } : null;
  return { ...a, arquivos: (a.arquivos || []).map(f => ({ filename: f.filename, size_bytes: f.size_bytes })), calculo: leve };
};

router.post('/analises', autenticar, (req, res, next) => { req.analiseId = crypto.randomUUID(); next(); }, (req, res) => {
  uploadAnalise.array('documentos', 10)(req, res, async (err) => {
    if (err) return res.status(400).json({ erro: err.message });
    try {
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ erro: 'Anexe o contrato (PDF ou foto).' });
      if (String((req.body || {}).consentimento) !== 'true') return res.status(400).json({ erro: 'Confirme que o contratante autorizou a análise do contrato.' });
      const arquivos = files.map(f => ({ filename: nomeUtf8(f.originalname), filepath: f.path, mime_type: f.mimetype, size_bytes: f.size }));
      await pool.query('INSERT INTO revisao_analises (id, status, arquivos, criado_por, consentimento_em) VALUES ($1, $2, $3, $4, now())',
        [req.analiseId, 'lendo', JSON.stringify(arquivos), req.usuario.id]);
      res.json({ id: req.analiseId, status: 'lendo' });
      setImmediate(() => analise.processar(req.analiseId).catch(e => console.error('[revisao-analise]', e.message)));
    } catch (e) { console.error('[revisao-analise] criar:', e); res.status(500).json({ erro: 'Erro ao iniciar a análise' }); }
  });
});

router.get('/analises', autenticar, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.id, a.status, a.veredito, a.economia_estimada, a.pedido_id, a.criado_em, a.erro,
              a.dados->'instituicao'->>'nome' AS banco, a.dados->'contratante'->>'nome' AS contratante,
              a.dados->>'tipo_operacao' AS tipo_operacao, u.nome AS criado_por_nome, p.numero AS pedido_numero
         FROM revisao_analises a LEFT JOIN usuarios u ON u.id = a.criado_por LEFT JOIN pedidos p ON p.id = a.pedido_id
        ORDER BY a.criado_em DESC LIMIT 50`);
    res.json({ analises: r.rows });
  } catch (e) { console.error('[revisao-analise] lista:', e); res.status(500).json({ erro: 'Erro ao listar as análises' }); }
});

router.get('/analises/:id', autenticar, async (req, res) => {
  try {
    let a = await analise.obter(req.params.id);
    if (!a) return res.status(404).json({ erro: 'Análise não encontrada' });
    // Servidor reiniciou no meio da leitura: não deixa a tela esperando para sempre
    if (a.status === 'lendo' && Date.now() - new Date(a.atualizado_em).getTime() > 10 * 60 * 1000) {
      await analise.salvar(a.id, { status: 'erro', erro: 'A leitura foi interrompida. Clique em "Ler de novo".' });
      a = await analise.obter(a.id);
    }
    res.json(resumoAnalise(a));
  } catch (e) { res.status(400).json({ erro: 'Análise inválida' }); }
});

// Operador corrige os dados lidos → veredito refeito na hora (sem IA)
router.put('/analises/:id/dados', autenticar, async (req, res) => {
  try {
    const a = await analise.obter(req.params.id);
    if (!a) return res.status(404).json({ erro: 'Análise não encontrada' });
    if (!req.body || typeof req.body.dados !== 'object') return res.status(400).json({ erro: 'Envie os dados.' });
    const out = await analise.recalcular(a.id, req.body.dados, Array.isArray(req.body.campos_editados) ? req.body.campos_editados : []);
    res.json(resumoAnalise(out));
  } catch (e) { console.error('[revisao-analise] recalcular:', e); res.status(500).json({ erro: 'Erro ao recalcular' }); }
});

// Ler o contrato de novo (nova chamada da IA)
router.post('/analises/:id/reler', autenticar, async (req, res) => {
  try {
    const a = await analise.obter(req.params.id);
    if (!a) return res.status(404).json({ erro: 'Análise não encontrada' });
    if (a.status === 'lendo') return res.json({ id: a.id, status: 'lendo' });
    await analise.salvar(a.id, { status: 'lendo', erro: null });
    res.json({ id: a.id, status: 'lendo' });
    setImmediate(() => analise.processar(a.id).catch(e => console.error('[revisao-analise]', e.message)));
  } catch (e) { res.status(500).json({ erro: 'Erro ao reler' }); }
});

// Lista da aba "Revisão de Contratos" (módulo à parte do Rastreia)
router.get('/', autenticar, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.numero, p.status, p.valor, p.forma_pagamento, p.cliente_nome, p.cliente_whatsapp, p.alvo_nome, p.alvo_documento,
              p.criado_em, p.concluido_em, rb.etapa, rb.veredito, rb.economia_estimada,
              COALESCE(rb.dados_conferidos->'instituicao'->>'nome', rb.dados_extraidos->'instituicao'->>'nome', rb.dados_informados->>'banco') AS banco,
              COALESCE(rb.dados_conferidos->>'tipo_operacao', rb.dados_extraidos->>'tipo_operacao', rb.dados_informados->>'tipo_operacao') AS tipo_operacao,
              u.nome AS operador_nome
         FROM pedidos p
         JOIN revisao_bancaria rb ON rb.pedido_id = p.id
         LEFT JOIN usuarios u ON u.id = p.operador_id
        WHERE p.tipo = $1 AND p.deletado_em IS NULL
        ORDER BY p.criado_em DESC LIMIT 300`, [revisao.TIPO]);
    res.json({ revisoes: r.rows });
  } catch (e) { console.error('[revisao-bancaria] lista:', e); res.status(500).json({ erro: 'Erro ao listar as revisões' }); }
});

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
      pedido: { ...pedido, relatorio_url: pedido.relatorio_url ? assinar(pedido.relatorio_url) : null }, etapa: reg.etapa, documentos: docs,
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

// ── Entrega 5: cálculo, taxa manual, revisão jurídica ─────────────────────
const fluxo = require('../services/revisao_bancaria_fluxo');
async function usuarioDb(id) {
  return (await pool.query('SELECT id, nome, perfil, pode_revisar_juridico, oab FROM usuarios WHERE id = $1', [id])).rows[0] || {};
}

router.post('/:pedidoId/recalcular', autenticar, async (req, res) => {
  try {
    const pedido = await carregarPedido(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ erro: 'Revisão não encontrada' });
    const reg = await revisao.obter(pedido.id);
    if (reg.etapa === 'aprovado') return res.status(409).json({ erro: 'Laudo já aprovado.' });
    const out = await fluxo.processarCalculo(pedido.id, req.usuario.id);
    res.status(out.ok ? 200 : 422).json(out);
  } catch (e) { console.error('[revisao-bancaria] recalcular:', e); res.status(500).json({ erro: 'Erro no cálculo' }); }
});

router.post('/:pedidoId/taxa-manual', autenticar, async (req, res) => {
  try {
    const pedido = await carregarPedido(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ erro: 'Revisão não encontrada' });
    const { valor_am, mes_referencia, fonte } = req.body || {};
    const out = await fluxo.informarTaxaManual(pedido.id, { valorAm: valor_am, mesReferencia: mes_referencia, fonte }, await usuarioDb(req.usuario.id));
    res.status(out.ok ? 200 : 422).json(out);
  } catch (e) { console.error('[revisao-bancaria] taxa-manual:', e); res.status(500).json({ erro: 'Erro ao registrar a taxa' }); }
});

// Rascunho do revisor: parecer IA editado e parecer jurídico
router.put('/:pedidoId/parecer', autenticar, async (req, res) => {
  try {
    const pedido = await carregarPedido(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ erro: 'Revisão não encontrada' });
    const u = await usuarioDb(req.usuario.id);
    if (!u.pode_revisar_juridico) return res.status(403).json({ erro: 'Somente advogado revisor habilitado pelo admin.' });
    const reg = await revisao.obter(pedido.id);
    if (reg.etapa !== 'revisao_juridica') return res.status(409).json({ erro: 'A revisão não está na etapa jurídica.' });
    const campos = {};
    if (req.body.parecer_ia && typeof req.body.parecer_ia === 'object') campos.parecer_ia = JSON.stringify(req.body.parecer_ia);
    if (typeof req.body.parecer_juridico === 'string') campos.parecer_juridico = req.body.parecer_juridico.slice(0, 20000);
    await revisao.atualizar(pedido.id, { campos, usuarioId: u.id, acao: 'Revisão bancária: parecer salvo (rascunho)' });
    res.json({ ok: true });
  } catch (e) { console.error('[revisao-bancaria] parecer:', e); res.status(500).json({ erro: 'Erro ao salvar o parecer' }); }
});

router.post('/:pedidoId/devolver', autenticar, async (req, res) => {
  try {
    const pedido = await carregarPedido(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ erro: 'Revisão não encontrada' });
    const u = await usuarioDb(req.usuario.id);
    if (!u.pode_revisar_juridico) return res.status(403).json({ erro: 'Somente advogado revisor habilitado pelo admin.' });
    const motivo = String((req.body || {}).motivo || '').trim();
    if (!motivo) return res.status(400).json({ erro: 'Informe o motivo da devolução.' });
    const reg = await revisao.obter(pedido.id);
    if (reg.etapa !== 'revisao_juridica') return res.status(409).json({ erro: 'A revisão não está na etapa jurídica.' });
    await revisao.atualizar(pedido.id, { etapa: 'conferencia_operador', usuarioId: u.id, acao: 'Revisão bancária: reprovado pelo jurídico — devolvido para conferência', detalhes: motivo });
    res.json({ ok: true });
  } catch (e) { console.error('[revisao-bancaria] devolver:', e); res.status(500).json({ erro: 'Erro ao devolver' }); }
});

// Aprovar e gerar o laudo — idempotente (clique duplo não gera dois PDFs nem dois envios)
router.post('/:pedidoId/aprovar', autenticar, async (req, res) => {
  try {
    const pedido = await carregarPedido(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ erro: 'Revisão não encontrada' });
    const u = await usuarioDb(req.usuario.id);
    if (!u.pode_revisar_juridico) return res.status(403).json({ erro: 'Somente advogado revisor habilitado pelo admin.' });
    const parecer = String((req.body || {}).parecer_juridico || '').trim();
    if (parecer.length < 30) return res.status(400).json({ erro: 'Escreva o parecer jurídico (mínimo de 30 caracteres).' });
    const out = await fluxo.aprovar(pedido.id, u, parecer, req.body.parecer_ia);
    if (out.url) out.url = assinar(out.url);
    res.status(out.ok ? 200 : 409).json(out);
  } catch (e) {
    console.error('[revisao-bancaria] aprovar:', e);
    res.status(500).json({ erro: 'A aprovação foi registrada, mas o laudo não foi gerado. Use "Gerar o laudo de novo".' });
  }
});

// Aprovado mas o laudo não saiu (falha no PDF): gera de novo, sem duplicar envios
router.post('/:pedidoId/gerar-laudo', autenticar, async (req, res) => {
  try {
    const pedido = await carregarPedido(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ erro: 'Revisão não encontrada' });
    const u = await usuarioDb(req.usuario.id);
    if (!u.pode_revisar_juridico && u.perfil !== 'admin') return res.status(403).json({ erro: 'Somente o revisor jurídico ou o admin.' });
    const reg = await revisao.obter(pedido.id);
    if (!reg || reg.etapa !== 'aprovado') return res.status(400).json({ erro: 'O laudo só sai depois da aprovação jurídica.' });
    const out = await require('../services/revisao_bancaria_laudo').concluirRevisao(pedido.id, { id: reg.revisor_id });
    if (out.url) out.url = assinar(out.url);
    res.status(out.ok ? 200 : 400).json(out);
  } catch (e) { console.error('[revisao-bancaria] gerar-laudo:', e); res.status(500).json({ erro: 'Erro ao gerar o laudo' }); }
});

// Admin: habilitar advogado revisor e OAB
router.patch('/revisores/:usuarioId', autenticar, async (req, res) => {
  try {
    if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Somente admin.' });
    const { pode_revisar_juridico, oab } = req.body || {};
    const r = await pool.query('UPDATE usuarios SET pode_revisar_juridico = $1, oab = $2 WHERE id = $3 RETURNING id, nome, pode_revisar_juridico, oab',
      [!!pode_revisar_juridico, oab ? String(oab).slice(0, 30) : null, req.params.usuarioId]);
    if (!r.rows.length) return res.status(404).json({ erro: 'Usuário não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { console.error('[revisao-bancaria] revisor:', e); res.status(500).json({ erro: 'Erro ao atualizar o revisor' }); }
});

module.exports = router;
