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
  const r = await pool.query("SELECT id, numero, tipo, status, valor, mp_init_point, relatorio_url, alvo_nome, alvo_documento, alvo_tipo, token_publico, cliente_id, criado_em, pago_em, concluido_em FROM pedidos WHERE id = $1 AND deletado_em IS NULL", [id]);
  return r.rows[0] && r.rows[0].tipo === revisao.TIPO ? r.rows[0] : null;
}

// Valores iniciais da conferência: conferidos > extraídos > informados no pedido
function camposIniciais(reg, pedido) {
  if (reg.dados_conferidos) return reg.dados_conferidos;
  const ex = reg.dados_extraidos || {};
  const inf = reg.dados_informados || {};
  const op = ex.operacao || {};
  const doc = require('../services/documento').limparDoc(pedido.alvo_documento);
  return {
    pfpj: ex.classificacao?.pfpj || (doc.length === 14 ? 'PJ' : 'PF'),
    tipo_operacao: inf.tipo_operacao || ex.classificacao?.tipo_operacao || null,
    subtipo: ex.classificacao?.subtipo || null,
    situacao: inf.situacao || null,
    parcelas_pagas: inf.parcelas_pagas ?? (ex.pagamentos && ex.pagamentos.parcelas_pagas != null ? Math.round(Number(ex.pagamentos.parcelas_pagas)) : null),
    parcelas_pagas_origem: inf.parcelas_pagas != null ? 'informado' : (ex.pagamentos && ex.pagamentos.parcelas_pagas != null ? (ex.pagamentos.documento_origem || 'documento') : null),
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

// Acrescentar documentos (demonstrativo do empréstimo, extrato, carnê) e ler tudo de novo
router.post('/analises/:id/documentos', autenticar, async (req, res, next) => {
  try {
    const a = await analise.obter(req.params.id);
    if (!a) return res.status(404).json({ erro: 'Análise não encontrada' });
    if (a.pedido_id) return res.status(400).json({ erro: 'Esta análise já virou revisão: envie os documentos pela página do pedido.' });
    if (a.status === 'lendo') return res.status(409).json({ erro: 'A leitura anterior ainda está em andamento.' });
    req.analiseId = a.id; req.analiseAtual = a; next();
  } catch (e) { res.status(400).json({ erro: 'Análise inválida' }); }
}, (req, res) => {
  uploadAnalise.array('documentos', 10)(req, res, async (err) => {
    if (err) return res.status(400).json({ erro: err.message });
    try {
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ erro: 'Anexe ao menos um documento.' });
      const novos = files.map(f => ({ filename: nomeUtf8(f.originalname), filepath: f.path, mime_type: f.mimetype, size_bytes: f.size }));
      const todos = [...(req.analiseAtual.arquivos || []), ...novos];
      if (todos.length > 10) return res.status(400).json({ erro: 'No máximo 10 documentos por análise.' });
      await analise.salvar(req.analiseId, { arquivos: todos, status: 'lendo', erro: null });
      res.json({ id: req.analiseId, status: 'lendo' });
      setImmediate(() => analise.processar(req.analiseId).catch(e => console.error('[revisao-analise]', e.message)));
    } catch (e) { console.error('[revisao-analise] documentos:', e); res.status(500).json({ erro: 'Erro ao anexar' }); }
  });
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

// ── Situação do serviço: etapas, datas e link de acompanhamento ──────────────
const PASSOS = [
  ['pagamento', 'Pagamento'], ['documentos', 'Contrato recebido'], ['conferencia', 'Conferência dos dados'],
  ['calculo', 'Cálculo e comparação com o Banco Central'], ['juridico', 'Análise do advogado'], ['laudo', 'Laudo entregue']
];
function passoAtual(status, etapa) {
  if (status === 'cancelado') return 'cancelado';
  if (status === 'aguardando_pagamento') return 'pagamento';
  if (status === 'concluido' || etapa === 'aprovado') return 'laudo';
  return { aguardando_documentos: 'documentos', extraindo: 'documentos', conferencia_operador: 'conferencia', reprovado_juridico: 'conferencia', calculando: 'calculo', revisao_juridica: 'juridico' }[etapa] || 'documentos';
}
// Datas de cada passo pelo histórico (logs) — sem dado pessoal
async function linhaDoTempo(pedido, reg) {
  const logs = (await pool.query('SELECT acao, criado_em FROM logs WHERE pedido_id = $1 ORDER BY criado_em', [pedido.id])).rows;
  const primeira = (re) => { const l = logs.find(x => re.test(x.acao || '')); return l ? l.criado_em : null; };
  const datas = {
    pagamento: pedido.pago_em || primeira(/pagamento confirmado|cobrança paga/i),
    documentos: primeira(/extração IA|aberta a partir da análise|conferência manual|^Revisão bancária: conferência$/i),
    conferencia: primeira(/dados confirmados pelo operador/i),
    calculo: primeira(/cálculo concluído/i),
    juridico: primeira(/aprovada pelo jurídico/i),
    laudo: pedido.concluido_em || primeira(/laudo de revisão bancária gerado/i)
  };
  const atual = passoAtual(pedido.status, reg && reg.etapa);
  const idx = PASSOS.findIndex(p => p[0] === atual);
  return {
    atual, criado_em: pedido.criado_em,
    passos: PASSOS.map(([id, nome], i) => ({ id, nome, feito: atual === 'laudo' ? true : i < idx, atual: i === idx && atual !== 'laudo', data: datas[id] || null }))
  };
}
const linkAcompanhamento = (token) => token ? `${process.env.BASE_URL || 'https://www.recobrorastreia.com.br'}/acompanhar-revisao.html?t=${token}` : null;

// Público (sem login): o cliente vê em que etapa está a revisão dele
router.get('/publico/:token', async (req, res) => {
  try {
    if (!/^[a-f0-9]{32,64}$/.test(req.params.token)) return res.status(404).json({ erro: 'Link inválido' });
    const p = (await pool.query('SELECT id, numero, tipo, status, cliente_nome, criado_em, pago_em, concluido_em, relatorio_url FROM pedidos WHERE token_publico = $1 AND deletado_em IS NULL', [req.params.token])).rows[0];
    if (!p || p.tipo !== revisao.TIPO) return res.status(404).json({ erro: 'Revisão não encontrada' });
    const reg = await revisao.obter(p.id);
    const lt = await linhaDoTempo(p, reg);
    const { VALIDADE } = require('../services/link_relatorio');
    res.json({
      numero: p.numero, primeiro_nome: String(p.cliente_nome || '').trim().split(/\s+/)[0] || null,
      ...lt, laudo_url: lt.atual === 'laudo' && p.relatorio_url ? assinar(p.relatorio_url, VALIDADE.PUBLICO) : null,
      balladao_whatsapp: (await revisao.config('balladao_whatsapp', '')) || null
    });
  } catch (e) { console.error('[revisao-bancaria] publico:', e); res.status(500).json({ erro: 'Erro ao consultar' }); }
});

// ── Clientes da Revisão de Contratos (tabela clientes, nicho 'revisao_bancaria') ──
router.get('/clientes', autenticar, async (req, res) => {
  try {
    const busca = String(req.query.busca || '').trim();
    const params = [revisao.TIPO];
    let filtro = '';
    if (busca) { params.push(`%${busca}%`); filtro = `AND (c.nome ILIKE $2 OR c.cnpj ILIKE $2 OR c.whatsapp ILIKE $2 OR c.email ILIKE $2)`; }
    const r = await pool.query(
      `SELECT c.id, c.nome, c.cnpj AS documento, c.whatsapp, c.email, c.endereco, c.observacoes, c.criado_em,
              COUNT(p.id)::int AS revisoes,
              COUNT(p.id) FILTER (WHERE p.status NOT IN ('concluido', 'cancelado'))::int AS em_andamento,
              COALESCE(SUM(p.valor) FILTER (WHERE p.pago_em IS NOT NULL), 0)::float AS total_pago,
              MAX(p.criado_em) AS ultima_revisao
         FROM clientes c
         LEFT JOIN pedidos p ON p.cliente_id = c.id AND p.tipo = $1 AND p.deletado_em IS NULL
        WHERE c.ativo = true AND (c.nicho = 'revisao_bancaria' OR EXISTS (SELECT 1 FROM pedidos x WHERE x.cliente_id = c.id AND x.tipo = $1)) ${filtro}
        GROUP BY c.id ORDER BY MAX(p.criado_em) DESC NULLS LAST, c.nome LIMIT 300`, params);
    res.json({ clientes: r.rows });
  } catch (e) { console.error('[revisao-bancaria] clientes:', e); res.status(500).json({ erro: 'Erro ao listar os clientes' }); }
});

router.get('/clientes/:id', autenticar, async (req, res) => {
  try {
    const c = (await pool.query('SELECT id, nome, cnpj AS documento, whatsapp, email, endereco, observacoes, criado_em FROM clientes WHERE id = $1 AND ativo = true', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const revs = (await pool.query(
      `SELECT p.id, p.numero, p.status, p.valor, p.criado_em, p.pago_em, p.concluido_em, rb.etapa, rb.veredito, rb.economia_estimada,
              COALESCE(rb.dados_conferidos->'instituicao'->>'nome', rb.dados_extraidos->'instituicao'->>'nome', rb.dados_informados->>'banco') AS banco
         FROM pedidos p JOIN revisao_bancaria rb ON rb.pedido_id = p.id
        WHERE p.cliente_id = $1 AND p.tipo = $2 AND p.deletado_em IS NULL ORDER BY p.criado_em DESC`, [c.id, revisao.TIPO])).rows;
    res.json({ cliente: c, revisoes: revs.map(r => ({ ...r, passo: passoAtual(r.status, r.etapa) })) });
  } catch (e) { console.error('[revisao-bancaria] cliente:', e); res.status(500).json({ erro: 'Erro ao buscar o cliente' }); }
});

// Lista da aba "Revisão de Contratos" (módulo à parte do Rastreia)
router.get('/', autenticar, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.numero, p.status, p.valor, p.forma_pagamento, p.cliente_nome, p.cliente_whatsapp, p.alvo_nome, p.alvo_documento,
              p.criado_em, p.concluido_em, rb.etapa, rb.veredito, rb.economia_estimada,
              COALESCE(rb.dados_conferidos->'instituicao'->>'nome', rb.dados_extraidos->'instituicao'->>'nome', rb.dados_informados->>'banco') AS banco,
              COALESCE(rb.dados_conferidos->>'tipo_operacao', rb.dados_extraidos->>'tipo_operacao', rb.dados_informados->>'tipo_operacao') AS tipo_operacao,
              u.nome AS operador_nome, p.mp_init_point,
              (SELECT COUNT(*) FROM cobrancas c WHERE c.pedido_id = p.id AND c.status <> 'cancelada')::int AS cob_total,
              (SELECT COUNT(*) FROM cobrancas c WHERE c.pedido_id = p.id AND c.status = 'paga')::int AS cob_pagas,
              (SELECT c.mp_init_point FROM cobrancas c WHERE c.pedido_id = p.id AND c.status = 'aberta' ORDER BY c.numero NULLS FIRST LIMIT 1) AS cob_link
         FROM pedidos p
         JOIN revisao_bancaria rb ON rb.pedido_id = p.id
         LEFT JOIN usuarios u ON u.id = p.operador_id
        WHERE p.tipo = $1 AND p.deletado_em IS NULL
        ORDER BY p.criado_em DESC LIMIT 300`, [revisao.TIPO]);
    res.json({ revisoes: r.rows.map(x => ({ ...x, passo: passoAtual(x.status, x.etapa) })) });
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
      pedido: { ...pedido, token_publico: undefined, relatorio_url: pedido.relatorio_url ? assinar(pedido.relatorio_url) : null }, etapa: reg.etapa, documentos: docs,
      linha_do_tempo: await linhaDoTempo(pedido, reg), link_acompanhamento: linkAcompanhamento(pedido.token_publico),
      campos: camposIniciais(reg, pedido),
      confianca: extr.confianca_por_campo || {},
      paginas: extr.paginas_relevantes || [],
      alertas_leitura: extr.alertas_leitura || [],
      extraido: !!reg.dados_extraidos,
      conferido: !!reg.dados_conferidos,
      taxa_media_bacen: reg.taxa_media_bacen, calculo: reg.calculo ? { ...reg.calculo, tabela_contratada: undefined } : null,
      teses: reg.teses, diagnostico: reg.diagnostico || null, veredito: reg.veredito, economia_estimada: reg.economia_estimada,
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

// Minutas para o advogado (Word): revisional, notificação extrajudicial, proposta de acordo
router.get('/:pedidoId/minuta/:tipo', autenticar, async (req, res) => {
  try {
    const u = await usuarioDb(req.usuario.id);
    if (!u.pode_revisar_juridico && u.perfil !== 'admin') return res.status(403).json({ erro: 'Somente o advogado revisor ou o admin.' });
    const p = (await pool.query('SELECT * FROM pedidos WHERE id = $1 AND deletado_em IS NULL', [req.params.pedidoId])).rows[0];
    if (!p || p.tipo !== revisao.TIPO) return res.status(404).json({ erro: 'Revisão não encontrada' });
    const reg = await revisao.obter(p.id);
    if (!reg || !reg.calculo) return res.status(400).json({ erro: 'A minuta sai depois do cálculo.' });
    const revisor = reg.revisor_id ? await usuarioDb(reg.revisor_id) : (u.pode_revisar_juridico ? u : null);
    const m = require('../services/revisao_minutas').gerarMinuta(req.params.tipo, p, reg, revisor);
    if (!m) return res.status(400).json({ erro: 'Tipo de minuta inválido.' });
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)', [p.id, req.usuario.id, 'Revisão bancária: minuta gerada', req.params.tipo]);
    res.setHeader('Content-Type', 'application/msword; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${m.nome}"`);
    res.send('\ufeff' + m.html);
  } catch (e) { console.error('[revisao-bancaria] minuta:', e); res.status(500).json({ erro: 'Erro ao gerar a minuta' }); }
});

// Mensagem de COBRANÇA da revisão: o que a análise achou + valor + link (Pix, boleto, cartão 12x)
router.get('/:pedidoId/mensagem-pagamento', autenticar, async (req, res) => {
  try {
    const p = (await pool.query('SELECT * FROM pedidos WHERE id = $1 AND deletado_em IS NULL', [req.params.pedidoId])).rows[0];
    if (!p || p.tipo !== revisao.TIPO) return res.status(404).json({ erro: 'Revisão não encontrada' });
    if (p.status !== 'aguardando_pagamento') return res.status(400).json({ erro: 'Esta revisão já está paga.' });
    const cobs = (await pool.query("SELECT * FROM cobrancas WHERE pedido_id = $1 AND status <> 'cancelada' ORDER BY numero NULLS FIRST", [p.id])).rows;
    const aberta = cobs.find(c => c.status === 'aberta');
    const link = aberta ? aberta.mp_init_point : p.mp_init_point;
    if (!link) return res.status(400).json({ erro: 'Gere o link de pagamento primeiro.' });
    const reg = await revisao.obter(p.id);
    const an = (await pool.query('SELECT veredito, economia_estimada, calculo FROM revisao_analises WHERE pedido_id = $1 ORDER BY criado_em DESC LIMIT 1', [p.id])).rows[0];
    const calc = (reg && reg.calculo) || (an && an.calculo) || null;
    const veredito = (reg && reg.veredito) || (an && an.veredito) || null;
    const economia = Number((reg && reg.economia_estimada) ?? (an && an.economia_estimada) ?? 0);
    const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pct = (v) => (Number(v) * 100).toFixed(2).replace('.', ',') + '%';
    const L = [`Olá, ${p.cliente_nome || ''}!`, ''];
    if (veredito && ['forte', 'moderada'].includes(veredito)) {
      L.push('Analisamos o seu contrato e encontramos indícios de cobrança acima do mercado:');
      if (calc && calc.taxa && calc.bacen) L.push(`• Sua taxa: ${pct(calc.taxa.efetiva_am)} ao mês — média do Banco Central: ${pct(calc.bacen.am)} ao mês`);
      if (economia > 0) L.push(`• Economia estimada: ${brl(economia)}`);
      L.push('');
    }
    L.push(`Para o laudo completo da revisão, assinado pelo advogado do Balladão Advogados, com o recálculo, as teses e o caminho para recuperar o valor:`);
    if (cobs.length > 1) {
      const n = cobs.length;
      L.push(`• ${brl(p.valor)} em ${n} parcelas mensais de ${brl(cobs[0].valor)}`, `• Parcela ${aberta ? aberta.numero : 1}/${n}${aberta && aberta.vencimento ? ` (vence ${String(aberta.vencimento instanceof Date ? aberta.vencimento.toISOString() : aberta.vencimento).slice(0, 10).split('-').reverse().join('/')})` : ''}: ${link}`);
    } else {
      L.push(`• ${brl(p.valor)} — Pix, boleto ou cartão em até 12x: ${link}`);
    }
    L.push('', 'Assim que o pagamento for confirmado, damos início à revisão.', '_Recobro Recuperação de Crédito · Balladão Advogados_');
    let fone = String(p.cliente_whatsapp || '').replace(/\D/g, '');
    if (fone && !fone.startsWith('55')) fone = '55' + fone;
    res.json({ texto: L.join('\n'), link, whatsapp: fone || null });
  } catch (e) { console.error('[revisao-bancaria] mensagem-pagamento:', e); res.status(500).json({ erro: 'Erro ao montar a mensagem' }); }
});

// Mensagem pronta para o cliente (enquanto o WhatsApp automático não está ligado)
router.get('/:pedidoId/mensagem-cliente', autenticar, async (req, res) => {
  try {
    const p = (await pool.query('SELECT * FROM pedidos WHERE id = $1 AND deletado_em IS NULL', [req.params.pedidoId])).rows[0];
    if (!p || p.tipo !== revisao.TIPO) return res.status(404).json({ erro: 'Revisão não encontrada' });
    if (p.status !== 'concluido' || !p.relatorio_url) return res.status(400).json({ erro: 'O laudo ainda não foi gerado.' });
    const reg = await revisao.obter(p.id);
    const { VALIDADE } = require('../services/link_relatorio');
    const link = (process.env.BASE_URL || 'https://www.recobrorastreia.com.br') + assinar(p.relatorio_url, VALIDADE.WHATSAPP);
    const wpp = await revisao.config('balladao_whatsapp', '');
    const texto = require('../services/revisao_bancaria_laudo').mensagemCliente(p, reg, link, wpp);
    let fone = String(p.cliente_whatsapp || '').replace(/\D/g, '');
    if (fone && !fone.startsWith('55')) fone = '55' + fone;
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao) VALUES ($1, $2, $3)', [p.id, req.usuario.id, 'Revisão bancária: mensagem do laudo copiada para envio manual']);
    res.json({ texto, link, whatsapp: fone || null, validade_dias: 30 });
  } catch (e) { console.error('[revisao-bancaria] mensagem:', e); res.status(500).json({ erro: 'Erro ao montar a mensagem' }); }
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
