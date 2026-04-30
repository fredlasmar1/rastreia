const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const { autenticar, admin } = require('./auth');
const { pool } = require('../db');
const { executarConsultaCompleta } = require('../services/consultas');
const { gerarDossie } = require('../services/pdf');
const { notificarClienteConcluido, notificarOperadorNovoPedido } = require('../services/whatsapp');
const { criarPreferenceParaPedido, configurado: mpConfigurado } = require('../services/mercadopago');
const { PRODUTOS } = require('../services/produtos');
const credifyCatalogo = require('../services/credify/catalogo');
const analiseIA = require('../services/analise_documentos_ia');
const pedidoAlvos = require('../services/pedido_alvos');
const storagePaths = require('../services/storage_paths');

// ─── Upload de documentos do imóvel (Due Diligence Imobiliária) ───
// BUG #2: respeita UPLOADS_DIR (Railway Volume) com fallback pra ./uploads/imoveis em dev.
const UPLOADS_ROOT = storagePaths.UPLOADS_DIR;
const MIMES_DOCUMENTOS = new Set([
  'application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'
]);
const MAX_DOCS_POR_PEDIDO = 5;
// V2: tipos sao classificados pela IA. O upload aceita o campo `tipo` se o cliente
// quiser sugerir, mas e opcional — default e null e a IA decide.
const TIPOS_DOCUMENTOS_VALIDOS = new Set([
  'matricula', 'escritura', 'iptu', 'contrato', 'certidao_onus', 'itbi', 'outro'
]);

const uploadDocumentos = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_ROOT, req.params.id);
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safeOrig = (file.originalname || 'arquivo').replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);
      cb(null, `${Date.now()}_${safeOrig}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: MAX_DOCS_POR_PEDIDO },
  fileFilter: (req, file, cb) => {
    if (MIMES_DOCUMENTOS.has((file.mimetype || '').toLowerCase())) return cb(null, true);
    cb(new Error('Tipo de arquivo não suportado. Use PDF, JPG ou PNG.'));
  }
});

const PRECOS = {
  dossie_pf: 197,
  dossie_pj: 397,
  due_diligence: 997,
  due_diligence_imobiliaria: 997,
  analise_devedor: 250,
  investigacao_patrimonial: 497,
  consulta_veicular: 97,
  consulta_veicular_simples: 12,
  consulta_veicular_mediana: 39,
  consulta_veicular_completa: 79,
  consulta_restricoes: 19
};

const PRAZOS = {
  dossie_pf: 2,
  dossie_pj: 2,
  due_diligence: 24,
  due_diligence_imobiliaria: 24,
  analise_devedor: 2,
  investigacao_patrimonial: 4,
  consulta_veicular: 0.5,
  consulta_veicular_simples: 0.25,
  consulta_veicular_mediana: 0.25,
  consulta_veicular_completa: 0.25,
  consulta_restricoes: 0.25
};

const TIPOS_VEICULARES = new Set([
  'consulta_veicular',
  'consulta_veicular_simples',
  'consulta_veicular_mediana',
  'consulta_veicular_completa'
]);

const PLACA_REGEX = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

const ALVO_TIPOS_VALIDOS = ['PF', 'PJ'];
const FINALIDADES_VALIDAS = [
  'analise_credito', 'due_diligence_imobiliaria', 'due_diligence_empresarial',
  'instrucao_processo', 'investigacao_patrimonial', 'verificacao_idoneidade', 'prevencao_fraude'
];
const MAX_LIMIT = 100;

// ─── Rota pública para acompanhamento (sem autenticação) ───
router.get('/publico/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, numero, tipo, status, prazo_entrega, criado_em, concluido_em, relatorio_url
       FROM pedidos WHERE token_publico = $1 AND deletado_em IS NULL`,
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Pedido não encontrado' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao buscar pedido' });
  }
});

// Dashboard stats — DEVE ficar ANTES de /:id
router.get('/dashboard/stats', autenticar, async (req, res) => {
  try {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const [total, hoje_count, em_andamento, concluidos, receita] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM pedidos WHERE deletado_em IS NULL'),
      pool.query('SELECT COUNT(*) FROM pedidos WHERE deletado_em IS NULL AND criado_em >= $1', [hoje]),
      pool.query("SELECT COUNT(*) FROM pedidos WHERE deletado_em IS NULL AND status IN ('pago', 'em_andamento')"),
      pool.query("SELECT COUNT(*) FROM pedidos WHERE deletado_em IS NULL AND status = 'concluido'"),
      pool.query("SELECT SUM(valor) FROM pedidos WHERE deletado_em IS NULL AND status != 'cancelado' AND pago_em >= $1", [new Date(hoje.getFullYear(), hoje.getMonth(), 1)])
    ]);
    res.json({
      total: parseInt(total.rows[0].count),
      hoje: parseInt(hoje_count.rows[0].count),
      em_andamento: parseInt(em_andamento.rows[0].count),
      concluidos: parseInt(concluidos.rows[0].count),
      receita_mes: parseFloat(receita.rows[0].sum || 0)
    });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao carregar estatísticas' });
  }
});

// Listar pedidos
router.get('/', autenticar, async (req, res) => {
  try {
    const { status, page = 1, limit = 20, incluirDeletados } = req.query;
    const safeLimit = Math.min(Math.max(parseInt(limit) || 20, 1), MAX_LIMIT);
    const safePage = Math.max(parseInt(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    // Soft delete: por padrão esconde deletados. Apenas admin pode pedir incluirDeletados=1.
    const incluiDel = req.usuario.perfil === 'admin' && (incluirDeletados === '1' || incluirDeletados === 'true');

    const whereParts = [];
    const params = [];
    if (!incluiDel) whereParts.push('p.deletado_em IS NULL');
    if (status) {
      params.push(status);
      whereParts.push(`p.status = $${params.length}`);
    }
    const whereSql = whereParts.length ? ' WHERE ' + whereParts.join(' AND ') : '';

    params.push(safeLimit, offset);
    const query = `SELECT p.*, u.nome as operador_nome FROM pedidos p LEFT JOIN usuarios u ON p.operador_id = u.id${whereSql} ORDER BY p.criado_em DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    const countWhere = [];
    const countParams = [];
    if (!incluiDel) countWhere.push('deletado_em IS NULL');
    if (status) { countParams.push(status); countWhere.push(`status = $${countParams.length}`); }
    const countSql = `SELECT COUNT(*) FROM pedidos${countWhere.length ? ' WHERE ' + countWhere.join(' AND ') : ''}`;
    const count = await pool.query(countSql, countParams);

    res.json({ pedidos: result.rows, total: parseInt(count.rows[0].count), page: safePage });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao listar pedidos' });
  }
});

// Criar pedido
router.post('/', autenticar, async (req, res) => {
  try {
    const {
      tipo, cliente_nome, cliente_email, cliente_whatsapp,
      alvo_nome, alvo_documento, alvo_tipo, alvo_placa,
      // LGPD
      finalidade, aceite_termos,
      // Imobiliária
      alvo2_nome, alvo2_documento, alvo2_tipo,
      imovel_matricula, imovel_endereco, imovel_estado,
      // Veicular: tier e add-ons
      tier_veicular, addons_veicular, valor_customizado
    } = req.body;

    const isVeicular = TIPOS_VEICULARES.has(tipo);
    const isVeicularLegado = tipo === 'consulta_veicular';

    if (!tipo || !cliente_nome) {
      return res.status(400).json({ erro: 'Campos obrigatórios: tipo, cliente_nome' });
    }
    if (cliente_nome.length > 255 || (alvo_nome && alvo_nome.length > 255)) {
      return res.status(400).json({ erro: 'Nome não pode ter mais de 255 caracteres' });
    }

    let docLimpo = null;
    let placaLimpa = null;
    // V3: para due_diligence_imobiliaria, alvo_documento é opcional se houver
    // intenção de subir documentos (frontend envia tem_documentos=true). Nesse
    // caso, a IA extrai os proprietários da matrícula/escritura e cria os alvos.
    const isImobiliaria = tipo === 'due_diligence_imobiliaria';
    const temDocumentos = !!req.body.tem_documentos;
    const cpfPodeSerOpcional = isImobiliaria && temDocumentos;

    if (isVeicular) {
      placaLimpa = (alvo_placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!PLACA_REGEX.test(placaLimpa)) {
        return res.status(400).json({ erro: 'Placa inválida. Use formato AAA9999 (antigo) ou AAA9A99 (Mercosul)' });
      }
    } else if (cpfPodeSerOpcional && !alvo_documento) {
      // CPF opcional: a IA extrai dos documentos. Não validamos alvo_tipo aqui.
      docLimpo = null;
    } else {
      if (!alvo_documento) {
        return res.status(400).json({ erro: 'alvo_documento é obrigatório' });
      }
      if (!ALVO_TIPOS_VALIDOS.includes(alvo_tipo)) {
        return res.status(400).json({ erro: 'alvo_tipo deve ser PF ou PJ' });
      }
      docLimpo = alvo_documento.replace(/\D/g, '');
      if (docLimpo.length !== 11 && docLimpo.length !== 14) {
        return res.status(400).json({ erro: 'Documento deve ser CPF (11 dígitos) ou CNPJ (14 dígitos)' });
      }
    }

    // LGPD: finalidade obrigatória
    if (!finalidade || !FINALIDADES_VALIDAS.includes(finalidade)) {
      return res.status(400).json({ erro: 'Finalidade da consulta é obrigatória (LGPD)' });
    }
    if (!aceite_termos) {
      return res.status(400).json({ erro: 'Aceite dos Termos de Uso é obrigatório' });
    }

    let valor = PRECOS[tipo];
    if (!valor) return res.status(400).json({ erro: 'Tipo inválido' });

    // Se for veicular com tier especificado, recalcular preço a partir do catálogo
    let tierSlug = null;
    let addonsList = [];
    if (isVeicularLegado && tier_veicular) {
      const tier = credifyCatalogo.obterTier(tier_veicular);
      if (!tier) return res.status(400).json({ erro: 'Tier inválido (use: basico, completo ou premium)' });
      tierSlug = tier.slug;
      valor = tier.preco_sugerido;

      // Add-ons: aceita array ou CSV
      if (addons_veicular) {
        const pedidos = Array.isArray(addons_veicular)
          ? addons_veicular
          : String(addons_veicular).split(',').map(s => s.trim()).filter(Boolean);
        for (const slug of pedidos) {
          const addon = credifyCatalogo.listarAddons().find(a => a.slug === slug);
          if (addon) {
            addonsList.push(addon.slug);
            valor += addon.preco_adicional;
          }
        }
      }
    }

    // Admin/operador pode sobrescrever o valor final (ex: desconto ou cobrança especial)
    if (typeof valor_customizado === 'number' && valor_customizado >= 0) {
      valor = valor_customizado;
    }

    const prazoHoras = PRAZOS[tipo] || 2;
    const prazo = new Date(Date.now() + prazoHoras * 60 * 60 * 1000);
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const tokenPublico = crypto.randomBytes(32).toString('hex');

    // Validar segundo alvo se for due_diligence_imobiliaria
    // V3: matricula, alvo2_nome e alvo2_documento passam a ser opcionais quando
    // o operador sobe documentos do imóvel — a IA preenche o que conseguir.
    let alvo2DocLimpo = null;
    if (tipo === 'due_diligence_imobiliaria') {
      if (!temDocumentos && (!alvo2_nome || !alvo2_documento || !imovel_matricula)) {
        return res.status(400).json({ erro: 'Para Due Diligence Imobiliária sem documentos anexados: alvo2_nome, alvo2_documento e imovel_matricula são obrigatórios' });
      }
      if (alvo2_documento) {
        alvo2DocLimpo = alvo2_documento.replace(/\D/g, '');
        if (alvo2DocLimpo.length !== 11 && alvo2DocLimpo.length !== 14) {
          return res.status(400).json({ erro: 'CPF/CNPJ do vendedor deve ter 11 ou 14 dígitos' });
        }
      }
    }

    const nomeAlvoFinal = isVeicular
      ? ((alvo_nome || '').trim() || `Veículo ${placaLimpa}`)
      : ((alvo_nome || '').trim() || 'A identificar');

    const result = await pool.query(
      `INSERT INTO pedidos (
        tipo, status, cliente_nome, cliente_email, cliente_whatsapp,
        alvo_nome, alvo_documento, alvo_tipo, valor, prazo_entrega, operador_id,
        finalidade, ip_solicitante, aceite_termos, token_publico,
        alvo2_nome, alvo2_documento, alvo2_tipo,
        imovel_matricula, imovel_endereco, imovel_estado, alvo_placa,
        tier_veicular, addons_veicular
      )
      VALUES ($1, 'aguardando_pagamento', $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING *`,
      [
        tipo, cliente_nome.trim(), cliente_email, cliente_whatsapp,
        nomeAlvoFinal, docLimpo, isVeicular ? null : alvo_tipo, valor, prazo, req.usuario.id,
        finalidade, ip, true, tokenPublico,
        alvo2_nome?.trim() || null, alvo2DocLimpo, alvo2_tipo || null,
        imovel_matricula || null, imovel_endereco || null, imovel_estado || 'GO',
        placaLimpa,
        tierSlug, addonsList.length ? addonsList.join(',') : null
      ]
    );

    const pedido = result.rows[0];
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)',
      [pedido.id, req.usuario.id, 'Pedido criado', `Finalidade: ${finalidade} | IP: ${ip}`]);

    // V3: para due_diligence_imobiliaria, sincroniza pedido_alvos.
    // Se o operador informou CPF: cria alvo principal manual.
    // Se não informou (cpfPodeSerOpcional): marca status aguardando_extracao —
    // a IA vai extrair os proprietários quando rodar /consultar.
    if (isImobiliaria) {
      if (docLimpo) {
        await pedidoAlvos.adicionarAlvo(pedido.id, {
          nome: nomeAlvoFinal, documento: docLimpo, origem: 'manual', principal: true
        });
        // Vendedor (alvo2) também vira alvo consultado (compat com v2)
        if (alvo2DocLimpo) {
          await pedidoAlvos.adicionarAlvo(pedido.id, {
            nome: alvo2_nome?.trim() || null, documento: alvo2DocLimpo, origem: 'manual', principal: false
          });
        }
      } else {
        // CPF opcional + docs vão ser anexados → marcar aguardando extração
        await pool.query(
          `UPDATE pedidos SET analise_ia_status = 'aguardando_extracao', atualizado_em = NOW() WHERE id = $1`,
          [pedido.id]
        );
        pedido.analise_ia_status = 'aguardando_extracao';
      }
    }

    // Gerar link Mercado Pago (best-effort — frontend pode chamar
    // POST /api/pedidos/:id/pagamento depois para recriar/recuperar).
    if (mpConfigurado()) {
      try {
        const nomeProduto = PRODUTOS[tipo]?.nome || tipo;
        const mp = await criarPreferenceParaPedido(pedido, { nomeProduto });
        if (mp.ok) {
          await pool.query(
            'UPDATE pedidos SET mp_preference_id = $1, mp_init_point = $2 WHERE id = $3',
            [mp.preference_id, mp.init_point, pedido.id]
          );
          pedido.mp_preference_id = mp.preference_id;
          pedido.mp_init_point = mp.init_point;
        } else {
          console.warn('[pedidos] criar preference falhou (não bloqueia):', mp.erro);
        }
      } catch (eMp) {
        console.warn('[pedidos] erro MP (não bloqueia criação do pedido):', eMp.message);
      }
    }

    res.json(pedido);
  } catch (e) {
    console.error('Erro ao criar pedido:', e);
    res.status(500).json({ erro: 'Erro ao criar pedido' });
  }
});

// GET /api/pedidos/catalogo/veicular  -> tiers e add-ons visíveis para usuário autenticado.
// Se admin/operador, inclui custo bruto + margem + lucro (interno, nunca no PDF).
// Cliente/vendedor comum recebe só preço de venda.
router.get('/catalogo/veicular', autenticar, (req, res) => {
  try {
    const mostrarCusto = req.usuario.perfil === 'admin' || req.usuario.perfil === 'operador';

    const tiers = credifyCatalogo.listarTiers().map(t => {
      const base = {
        slug: t.slug,
        nome: t.nome,
        preco_sugerido: t.preco_sugerido,
        descricao: t.descricao,
        publico: t.publico,
        qtd_servicos: t.qtd_servicos
      };
      if (mostrarCusto) {
        base.custo_bruto = t.total;
        base.custo_bruto_formatado = t.total_formatado;
        base.margem_pct = t.margem.margem_pct;
        base.lucro = t.margem.margem;
      }
      return base;
    });

    const addons = credifyCatalogo.listarAddons().map(a => {
      const base = {
        slug: a.slug,
        nome: a.nome,
        descricao: a.descricao,
        preco_adicional: a.preco_adicional
      };
      if (mostrarCusto) {
        base.custo_bruto = a.custo_bruto;
        base.margem_pct = a.margem.margem_pct;
        base.lucro = a.margem.margem;
      }
      return base;
    });

    res.json({ tiers, addons, mostra_custo: mostrarCusto });
  } catch (e) {
    console.error('[pedidos] catálogo veicular:', e);
    res.status(500).json({ erro: 'Erro ao listar catálogo' });
  }
});

// Buscar pedido por ID
router.get('/:id', autenticar, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT p.*, u.nome as operador_nome FROM pedidos p LEFT JOIN usuarios u ON p.operador_id = u.id WHERE p.id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Pedido não encontrado' });
    const dados = await pool.query('SELECT * FROM dados_consulta WHERE pedido_id = $1', [req.params.id]);
    res.json({ ...result.rows[0], dados: dados.rows });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao buscar pedido' });
  }
});

// ── Upload de documentos do imóvel (Due Diligence Imobiliária) ─────
// POST /api/pedidos/:id/documentos
// multipart/form-data, campo "documentos" (array, até 5 arquivos).
// V2: o operador NAO escolhe mais o tipo — a IA classifica automaticamente
// na fase de analise. O campo `tipos` continua aceito (compatibilidade), mas
// e ignorado se nao vier — o tipo fica NULL ate a IA preencher.
router.post('/:id/documentos', autenticar, (req, res) => {
  uploadDocumentos.array('documentos', MAX_DOCS_POR_PEDIDO)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ erro: err.message || 'Erro no upload' });
    }
    const arquivos = req.files || [];
    if (!arquivos.length) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    try {
      const pedidoId = req.params.id;
      const pResult = await pool.query('SELECT id, tipo FROM pedidos WHERE id = $1', [pedidoId]);
      if (pResult.rows.length === 0) {
        // limpa arquivos já gravados pra não deixar lixo no disco
        arquivos.forEach(a => { try { fs.unlinkSync(a.path); } catch (_) {} });
        return res.status(404).json({ erro: 'Pedido não encontrado' });
      }
      if (pResult.rows[0].tipo !== 'due_diligence_imobiliaria') {
        arquivos.forEach(a => { try { fs.unlinkSync(a.path); } catch (_) {} });
        return res.status(400).json({ erro: 'Upload de documentos só é permitido para Due Diligence Imobiliária' });
      }

      // Limite total: existentes + novos <= MAX_DOCS_POR_PEDIDO
      const jaExistem = await pool.query('SELECT COUNT(*) FROM pedido_documentos WHERE pedido_id = $1', [pedidoId]);
      if (parseInt(jaExistem.rows[0].count, 10) + arquivos.length > MAX_DOCS_POR_PEDIDO) {
        arquivos.forEach(a => { try { fs.unlinkSync(a.path); } catch (_) {} });
        return res.status(400).json({ erro: `Máximo de ${MAX_DOCS_POR_PEDIDO} documentos por pedido` });
      }

      // Tipos: aceita JSON ('["matricula","escritura"]') OU array de strings
      let tiposIn = req.body.tipos || req.body.tipo;
      let tipos = [];
      if (Array.isArray(tiposIn)) tipos = tiposIn;
      else if (typeof tiposIn === 'string' && tiposIn.trim().startsWith('[')) {
        try { tipos = JSON.parse(tiposIn); } catch (_) { tipos = []; }
      } else if (typeof tiposIn === 'string') {
        tipos = [tiposIn];
      }

      const inseridos = [];
      for (let i = 0; i < arquivos.length; i++) {
        const arq = arquivos[i];
        // V2: tipo fica NULL se o cliente nao sugeriu um valido — a IA classifica depois.
        const rawTipo = (tipos[i] || '').toString().toLowerCase();
        const tipo = TIPOS_DOCUMENTOS_VALIDOS.has(rawTipo) ? rawTipo : null;
        const r = await pool.query(
          `INSERT INTO pedido_documentos (pedido_id, tipo, filename, filepath, size_bytes, mime_type)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, tipo, filename, size_bytes, mime_type`,
          [pedidoId, tipo, arq.originalname, arq.path, arq.size, arq.mimetype]
        );
        inseridos.push(r.rows[0]);
      }
      // marca status pendente; processo real roda quando rodar /consultar
      await pool.query(
        `UPDATE pedidos SET analise_ia_status = 'pendente', atualizado_em = NOW() WHERE id = $1`,
        [pedidoId]
      );
      res.status(201).json({ documentos: inseridos });
    } catch (e) {
      console.error('[pedidos] upload documentos:', e);
      arquivos.forEach(a => { try { fs.unlinkSync(a.path); } catch (_) {} });
      res.status(500).json({ erro: 'Erro ao salvar documentos' });
    }
  });
});

// Listar documentos do pedido
router.get('/:id/documentos', autenticar, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, tipo, filename, size_bytes, mime_type, criado_em
         FROM pedido_documentos WHERE pedido_id = $1 ORDER BY criado_em ASC`,
      [req.params.id]
    );
    res.json({ documentos: r.rows });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao listar documentos' });
  }
});

// V3: listar alvos consultados de um pedido (Due Diligence Imobiliária)
router.get('/:id/alvos', autenticar, async (req, res) => {
  try {
    const alvos = await pedidoAlvos.listarAlvos(req.params.id);
    res.json({ alvos });
  } catch (e) {
    console.error('[pedidos] listar alvos:', e);
    res.status(500).json({ erro: 'Erro ao listar alvos' });
  }
});

// V3: adicionar alvo manualmente (operador completa quando IA falhou em ler CPF)
router.post('/:id/alvos', autenticar, async (req, res) => {
  try {
    const { nome, documento } = req.body || {};
    if (!documento) return res.status(400).json({ erro: 'documento é obrigatório' });
    if (!pedidoAlvos.docLegivel(documento)) {
      return res.status(400).json({ erro: 'CPF/CNPJ inválido (use 11 ou 14 dígitos)' });
    }
    const pRes = await pool.query('SELECT id, tipo FROM pedidos WHERE id = $1', [req.params.id]);
    if (!pRes.rows.length) return res.status(404).json({ erro: 'Pedido não encontrado' });
    if (pRes.rows[0].tipo !== 'due_diligence_imobiliaria') {
      return res.status(400).json({ erro: 'Múltiplos alvos só em Due Diligence Imobiliária' });
    }
    const total = await pedidoAlvos.contarAlvos(req.params.id);
    if (total >= pedidoAlvos.MAX_ALVOS) {
      return res.status(400).json({ erro: `Máximo de ${pedidoAlvos.MAX_ALVOS} alvos por pedido` });
    }
    const principal = total === 0;
    const out = await pedidoAlvos.adicionarAlvo(req.params.id, {
      nome, documento, origem: 'manual', principal
    });
    if (!out) return res.status(400).json({ erro: 'Não foi possível adicionar o alvo' });
    if (principal) await pedidoAlvos.atualizarAlvoPrincipalEmPedido(req.params.id);
    // Limpa flag cpf_ilegivel se estava marcada — agora há alvo manual.
    await pool.query(
      `UPDATE pedidos
          SET analise_ia_status = CASE WHEN analise_ia_status IN ('cpf_ilegivel','aguardando_extracao')
                                       THEN 'pendente' ELSE analise_ia_status END,
              erro_processamento = CASE WHEN analise_ia_status IN ('cpf_ilegivel','aguardando_extracao')
                                        THEN NULL ELSE erro_processamento END,
              atualizado_em = NOW()
        WHERE id = $1`,
      [req.params.id]
    );
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)',
      [req.params.id, req.usuario.id, 'Alvo adicionado manualmente', `documento=${pedidoAlvos.digSafe(documento)}`]);
    res.json({ ok: true, alvo: out });
  } catch (e) {
    console.error('[pedidos] adicionar alvo:', e);
    res.status(500).json({ erro: 'Erro ao adicionar alvo' });
  }
});

// Disparar análise IA manualmente (idempotente)
router.post('/:id/analise-ia', autenticar, async (req, res) => {
  try {
    const out = await analiseIA.analisarDocumentosImovel(req.params.id);
    res.json(out);
  } catch (e) {
    console.error('[pedidos] analise-ia:', e);
    res.status(500).json({ erro: 'Erro ao executar análise IA' });
  }
});

// Marcar como pago (manual)
router.patch('/:id/pago', autenticar, async (req, res) => {
  try {
    const { mp_payment_id } = req.body;
    await pool.query(
      `UPDATE pedidos SET status = 'pago', pago_em = NOW(), mp_payment_id = $1, atualizado_em = NOW() WHERE id = $2`,
      [mp_payment_id || 'manual', req.params.id]
    );
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao) VALUES ($1, $2, $3)',
      [req.params.id, req.usuario.id, 'Pagamento confirmado manualmente']);
    const p = await pool.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
    await notificarOperadorNovoPedido(p.rows[0]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao confirmar pagamento' });
  }
});

// Iniciar análise (com proteção contra race condition)
router.patch('/:id/iniciar', autenticar, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE pedidos SET status = 'em_andamento', iniciado_em = NOW(), operador_id = $1, atualizado_em = NOW()
       WHERE id = $2 AND status = 'pago'
       RETURNING id`,
      [req.usuario.id, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ erro: 'Pedido não está com status "pago" ou já foi iniciado por outro operador' });
    }
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao) VALUES ($1, $2, $3)',
      [req.params.id, req.usuario.id, 'Análise iniciada']);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao iniciar análise' });
  }
});

// Lógica compartilhada das consultas externas — usada por /consultar e por /concluir.
// Retorna { ok: true, resultados, analise_ia } ou { erro, mensagem, status } em caso
// de bloqueio (ex.: cpf_ilegivel). Nunca lança — encapsula erros operacionais.
async function executarConsultasParaPedido(pedidoId, usuarioId) {
  const pResult = await pool.query('SELECT * FROM pedidos WHERE id = $1', [pedidoId]);
  if (pResult.rows.length === 0) return { erro: 'pedido_nao_encontrado', status: 404 };
  let pedido = pResult.rows[0];

  // V3: Due Diligence Imobiliária com CPF opcional + documentos.
  // Se está aguardando extração, roda a IA primeiro para popular pedido_alvos
  // a partir dos documentos. Só depois roda as consultas externas.
  if (pedido.tipo === 'due_diligence_imobiliaria') {
    const totalAlvos = await pedidoAlvos.contarAlvos(pedido.id);
    const precisaExtrair = pedido.analise_ia_status === 'aguardando_extracao' || totalAlvos === 0;
    if (precisaExtrair) {
      console.log(`[v3] pedido ${pedido.id}: rodando análise IA antes das consultas (extração de alvos)`);
      const out = await analiseIA.analisarDocumentosImovel(pedido.id);
      if (out.status === 'cpf_ilegivel') {
        return {
          erro: 'cpf_ilegivel',
          mensagem: out.erro || 'IA não conseguiu extrair CPF/CNPJ dos documentos. Informe manualmente em /alvos.',
          status: 400
        };
      }
      const refresh = await pool.query('SELECT * FROM pedidos WHERE id = $1', [pedido.id]);
      pedido = refresh.rows[0];
    }
    if (pedido.analise_ia_status === 'cpf_ilegivel') {
      return {
        erro: 'cpf_ilegivel',
        mensagem: pedido.erro_processamento || 'Pedido bloqueado: CPF ilegível. Informe manualmente em /alvos.',
        status: 400
      };
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

  await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao) VALUES ($1, $2, $3)',
    [pedido.id, usuarioId, 'Consultas automáticas executadas']);

  let analiseOut = null;
  if (pedido.tipo === 'due_diligence_imobiliaria') {
    try {
      analiseOut = await analiseIA.analisarDocumentosImovel(pedido.id);
      await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)',
        [pedido.id, usuarioId, 'Análise IA documentos', `status: ${analiseOut.status}`]);
    } catch (eIa) {
      console.warn('[pedidos] análise IA falhou (não bloqueia):', eIa.message);
    }
  }

  return { ok: true, resultados, analise_ia: analiseOut };
}

// Executar consultas automáticas
router.post('/:id/consultar', autenticar, async (req, res) => {
  try {
    const out = await executarConsultasParaPedido(req.params.id, req.usuario.id);
    if (out.erro) {
      return res.status(out.status || 400).json({ erro: out.erro, mensagem: out.mensagem });
    }
    res.json(out);
  } catch (e) {
    console.error('Erro ao executar consultas:', e);
    res.status(500).json({ erro: 'Erro ao executar consultas' });
  }
});

// Gerar PDF e concluir
router.post('/:id/concluir', autenticar, async (req, res) => {
  try {
    const { observacoes } = req.body;
    const pResult = await pool.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
    if (pResult.rows.length === 0) return res.status(404).json({ erro: 'Pedido não encontrado' });
    let pedido = pResult.rows[0];
    let dadosResult = await pool.query('SELECT * FROM dados_consulta WHERE pedido_id = $1', [pedido.id]);

    // BUG #1 — fix: para Due Diligence Imobiliária, garantir que as consultas
    // externas (Receita Federal, Escavador, DirectData, etc.) tenham terminado
    // ANTES de gerar o PDF. Caso contrário o relatório saía com "INDISPONÍVEL"
    // mesmo com APIs configuradas (ver pedido c52eb88d-309f-4765-8ddf-ecbb639342aa
    // onde o PDF foi gerado 15s antes do log de consultas concluídas).
    // Se não há linhas em dados_consulta, executamos as consultas inline e
    // recarregamos antes de chamar gerarDossie.
    if (pedido.tipo === 'due_diligence_imobiliaria' && dadosResult.rows.length === 0) {
      console.log(`[concluir] pedido ${pedido.id}: dados_consulta vazio — executando consultas inline antes do PDF`);
      const consultaOut = await executarConsultasParaPedido(pedido.id, req.usuario.id);
      if (consultaOut.erro) {
        return res.status(consultaOut.status || 400).json({
          erro: consultaOut.erro,
          mensagem: consultaOut.mensagem || 'Consultas externas falharam — corrija antes de gerar o PDF.'
        });
      }
      const refresh = await pool.query('SELECT * FROM pedidos WHERE id = $1', [pedido.id]);
      pedido = refresh.rows[0];
      dadosResult = await pool.query('SELECT * FROM dados_consulta WHERE pedido_id = $1', [pedido.id]);
    }

    // V3: anexa lista de alvos consultados ao pedido para o PDF renderizar
    try {
      pedido.alvos_consultados = await pedidoAlvos.listarAlvos(pedido.id);
    } catch (_) { pedido.alvos_consultados = []; }

    if (observacoes) {
      await pool.query('UPDATE pedidos SET observacoes = $1 WHERE id = $2', [observacoes, pedido.id]);
      pedido.observacoes = observacoes;
    }

    // Histórico de scores deste CPF/CNPJ (para renderizar no PDF com tendência)
    let historicoScores = [];
    try {
      const hist = await pool.query(
        `SELECT numero, score_calculado, score_classificacao, criado_em, concluido_em
         FROM pedidos
         WHERE alvo_documento = $1 AND id != $2 AND score_calculado IS NOT NULL
           AND deletado_em IS NULL
         ORDER BY criado_em DESC LIMIT 5`,
        [pedido.alvo_documento, pedido.id]
      );
      historicoScores = hist.rows;
    } catch (errHist) {
      console.warn('[pedidos] Histórico de scores indisponível:', errHist.message);
    }
    const dadosComHistorico = [
      ...dadosResult.rows,
      { fonte: 'historico_scores', dados: { pedidos: historicoScores } }
    ];

    const resultPdf = await gerarDossie(pedido, dadosComHistorico);
    const { url, score: scoreGerado } = resultPdf;
    await pool.query(
      `UPDATE pedidos SET status = 'concluido', concluido_em = NOW(), relatorio_url = $1,
         score_calculado = $2, score_classificacao = $3, atualizado_em = NOW()
       WHERE id = $4`,
      [url, scoreGerado?.valor ?? null, scoreGerado?.classificacao ?? null, pedido.id]
    );
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao) VALUES ($1, $2, $3)',
      [pedido.id, req.usuario.id, 'Relatório gerado e pedido concluído']);

    await notificarClienteConcluido(pedido, url);

    res.json({ ok: true, url });
  } catch (e) {
    console.error('Erro ao concluir pedido:', e);
    res.status(500).json({ erro: 'Erro ao concluir pedido' });
  }
});

// Salvar dados manuais
router.post('/:id/dados', autenticar, async (req, res) => {
  try {
    const { fonte, dados } = req.body;
    if (!fonte || !dados) return res.status(400).json({ erro: 'fonte e dados são obrigatórios' });
    await pool.query(
      'INSERT INTO dados_consulta (pedido_id, fonte, dados) VALUES ($1, $2, $3)',
      [req.params.id, fonte, JSON.stringify(dados)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao salvar dados' });
  }
});

// Demo gratuita (1 por CNPJ)
router.post('/demo', autenticar, async (req, res) => {
  try {
    const { alvo_documento, alvo_nome, alvo_tipo, cliente_nome, cliente_cnpj, finalidade, aceite_termos } = req.body;
    if (!alvo_documento || !cliente_cnpj) {
      return res.status(400).json({ erro: 'alvo_documento e cliente_cnpj são obrigatórios' });
    }
    if (!finalidade || !aceite_termos) {
      return res.status(400).json({ erro: 'Finalidade e aceite dos termos são obrigatórios' });
    }
    // Verificar se CNPJ já usou demo
    const jaUsou = await pool.query(
      "SELECT id FROM pedidos WHERE status = 'demonstracao' AND cliente_email = $1",
      [cliente_cnpj]
    );
    if (jaUsou.rows.length > 0) {
      return res.status(400).json({ erro: 'Demonstração já utilizada para este CNPJ. Faça um pedido pago para nova consulta.' });
    }
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const tokenPublico = crypto.randomBytes(32).toString('hex');
    const result = await pool.query(
      `INSERT INTO pedidos (
        tipo, status, cliente_nome, cliente_email, alvo_nome, alvo_documento, alvo_tipo,
        valor, finalidade, ip_solicitante, aceite_termos, token_publico, operador_id
      ) VALUES ('dossie_pf', 'demonstracao', $1, $2, $3, $4, $5, 0, $6, $7, true, $8, $9)
      RETURNING *`,
      [
        cliente_nome,
        cliente_cnpj,
        (alvo_nome || '').trim() || 'A identificar',
        alvo_documento.replace(/\D/g, ''),
        alvo_tipo || 'PF',
        finalidade,
        ip,
        tokenPublico,
        req.usuario.id
      ]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao criar demonstração' });
  }
});

// Soft delete (admin only). Marca deletado_em = NOW(); preserva o registro
// para auditoria. NÃO faz DELETE físico. Listagens padrão escondem o pedido.
router.delete('/:id', autenticar, admin, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE pedidos SET deletado_em = NOW(), atualizado_em = NOW()
        WHERE id = $1 AND deletado_em IS NULL
        RETURNING id, numero`,
      [req.params.id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ erro: 'Pedido não encontrado ou já excluído' });
    }
    await pool.query('INSERT INTO logs (pedido_id, usuario_id, acao) VALUES ($1, $2, $3)',
      [req.params.id, req.usuario.id, 'Pedido excluído (soft delete)']);
    res.json({ ok: true, deletado: r.rows[0] });
  } catch (e) {
    console.error('[pedidos] soft delete:', e);
    res.status(500).json({ erro: 'Erro ao excluir pedido' });
  }
});

module.exports = router;
