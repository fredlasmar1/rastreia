// services/analise_documentos_ia.js
//
// Análise de documentos imobiliários (matrícula + escritura) via Claude Sonnet 4.5.
// O usuário anexa PDFs/imagens ao pedido de Due Diligence Imobiliária e este
// serviço extrai dados estruturados (resumo executivo, alertas, identificação
// do imóvel, histórico de proprietários) que são depois renderizados no PDF.
//
// Falha graciosamente: se ANTHROPIC_API_KEY não estiver setado, retorna
// { status: 'desabilitada' } para que o pedido siga normalmente sem os blocos.

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const MODELO_DEFAULT = 'claude-sonnet-4-5';
const MIME_PDF = 'application/pdf';
const MIMES_IMAGEM = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const SYSTEM_PROMPT = [
  'Você é um assistente jurídico especializado em análise de documentos imobiliários',
  'brasileiros (matrículas de RGI/cartório e escrituras públicas). Sua tarefa é extrair',
  'dados estruturados e identificar pontos críticos para due diligence imobiliária.',
  'Responda SEMPRE em português brasileiro. Se um campo não for encontrado nos documentos,',
  'use null. Seja preciso — NÃO invente dados que não estejam nos documentos. Sinalize',
  'alertas para: hipoteca/alienação fiduciária ativa, penhora, indisponibilidade,',
  'usufruto, divergência entre proprietário registrado e declarado, área não regularizada,',
  'cadeia de transmissões com lacunas ou prazo curto entre transferências.'
].join(' ');

// Schema de saída — usado como tool input_schema para forçar JSON estruturado.
const SCHEMA = {
  type: 'object',
  properties: {
    resumo_executivo: {
      type: 'string',
      description: 'Texto curto de 3 a 5 linhas resumindo a situação do imóvel.'
    },
    alertas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severidade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
          titulo: { type: 'string' },
          descricao: { type: 'string' }
        },
        required: ['severidade', 'titulo', 'descricao']
      }
    },
    identificacao: {
      type: 'object',
      properties: {
        matricula_numero: { type: ['string', 'null'] },
        cartorio: { type: ['string', 'null'] },
        endereco_completo: { type: ['string', 'null'] },
        area_total_m2: { type: ['number', 'null'] },
        area_construida_m2: { type: ['number', 'null'] },
        inscricao_municipal: { type: ['string', 'null'] },
        natureza: {
          type: ['string', 'null'],
          enum: ['residencial', 'comercial', 'rural', 'terreno', null]
        }
      }
    },
    proprietarios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: ['string', 'null'] },
          cpf_cnpj: { type: ['string', 'null'] },
          tipo_aquisicao: { type: ['string', 'null'] },
          data_aquisicao: { type: ['string', 'null'] },
          valor_transacao: { type: ['number', 'null'] },
          atual: { type: 'boolean' }
        }
      }
    }
  },
  required: ['resumo_executivo', 'alertas', 'identificacao', 'proprietarios']
};

function modeloConfigurado() {
  return (process.env.ANTHROPIC_MODEL || MODELO_DEFAULT).trim();
}

function disponivel() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function validarSchema(out) {
  if (!out || typeof out !== 'object') return false;
  if (typeof out.resumo_executivo !== 'string') return false;
  if (!Array.isArray(out.alertas)) return false;
  if (!out.identificacao || typeof out.identificacao !== 'object') return false;
  if (!Array.isArray(out.proprietarios)) return false;
  return true;
}

// Lê um documento do disco e devolve um content block compatível com a Messages API.
function montarBloco(doc) {
  const buf = fs.readFileSync(doc.filepath);
  const data = buf.toString('base64');
  const mime = (doc.mime_type || '').toLowerCase();
  if (mime === MIME_PDF) {
    return {
      type: 'document',
      source: { type: 'base64', media_type: MIME_PDF, data },
      title: `${doc.tipo}: ${doc.filename}`
    };
  }
  if (MIMES_IMAGEM.has(mime)) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: mime, data }
    };
  }
  // tipo desconhecido — tenta como PDF (pode falhar, mas não derruba o fluxo)
  return {
    type: 'document',
    source: { type: 'base64', media_type: MIME_PDF, data },
    title: `${doc.tipo}: ${doc.filename}`
  };
}

async function chamarClaude(documentos) {
  // Import lazy: só carrega o SDK se a API key estiver configurada
  // (evita explodir em ambientes onde o pacote não foi instalado ainda).
  const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userBlocks = documentos.map(montarBloco);
  userBlocks.push({
    type: 'text',
    text: [
      'Analise os documentos imobiliários acima (matrícula e/ou escritura) e devolva',
      'os dados estruturados via a ferramenta `extrair_dados_imovel`. Se algum campo',
      'não estiver presente nos documentos, use null. Para "atual" em proprietários,',
      'marque true apenas no proprietário mais recente registrado na matrícula.'
    ].join(' ')
  });

  const tool = {
    name: 'extrair_dados_imovel',
    description: 'Recebe os dados estruturados extraídos dos documentos imobiliários.',
    input_schema: SCHEMA
  };

  const resp = await client.messages.create({
    model: modeloConfigurado(),
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'extrair_dados_imovel' },
    messages: [{ role: 'user', content: userBlocks }]
  });

  const toolUse = (resp.content || []).find(b => b.type === 'tool_use');
  if (!toolUse || !toolUse.input) {
    throw new Error('Claude não devolveu tool_use estruturado');
  }
  return toolUse.input;
}

/**
 * Analisa todos os documentos anexados a um pedido. Idempotente: pode ser
 * chamada múltiplas vezes; sobrescreve `analise_ia` no pedido.
 *
 * @returns {Promise<{ status: 'concluida'|'falhou'|'desabilitada'|'sem_documentos', analise?: object, erro?: string }>}
 */
async function analisarDocumentosImovel(pedidoId) {
  if (!disponivel()) {
    console.warn('[analise-ia] ANTHROPIC_API_KEY não configurada — análise desabilitada para pedido', pedidoId);
    await pool.query(
      `UPDATE pedidos SET analise_ia_status = 'desabilitada', atualizado_em = NOW() WHERE id = $1`,
      [pedidoId]
    );
    return { status: 'desabilitada' };
  }

  const docsRes = await pool.query(
    `SELECT id, tipo, filename, filepath, size_bytes, mime_type
       FROM pedido_documentos
      WHERE pedido_id = $1
      ORDER BY criado_em ASC`,
    [pedidoId]
  );
  const documentos = docsRes.rows.filter(d => {
    try { return fs.existsSync(d.filepath); } catch { return false; }
  });

  if (!documentos.length) {
    await pool.query(
      `UPDATE pedidos SET analise_ia_status = 'desabilitada', atualizado_em = NOW() WHERE id = $1`,
      [pedidoId]
    );
    return { status: 'sem_documentos' };
  }

  await pool.query(
    `UPDATE pedidos SET analise_ia_status = 'pendente', atualizado_em = NOW() WHERE id = $1`,
    [pedidoId]
  );

  let analise = null;
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      analise = await chamarClaude(documentos);
      if (validarSchema(analise)) break;
      ultimoErro = new Error('Resposta da IA não bate com o schema esperado');
      analise = null;
    } catch (e) {
      ultimoErro = e;
      console.warn(`[analise-ia] tentativa ${tentativa} falhou para pedido ${pedidoId}:`, e.message);
    }
  }

  if (!analise) {
    await pool.query(
      `UPDATE pedidos SET analise_ia_status = 'falhou', atualizado_em = NOW() WHERE id = $1`,
      [pedidoId]
    );
    return { status: 'falhou', erro: ultimoErro?.message || 'erro desconhecido' };
  }

  await pool.query(
    `UPDATE pedidos
        SET analise_ia = $1,
            analise_ia_status = 'concluida',
            atualizado_em = NOW()
      WHERE id = $2`,
    [JSON.stringify(analise), pedidoId]
  );

  // Marcador para o cálculo de custo bruto do pedido (services/custos.js).
  // Sem isso o painel admin não soma o custo da IA no breakdown do pedido.
  try {
    await pool.query(
      `INSERT INTO dados_consulta (pedido_id, fonte, dados) VALUES ($1, $2, $3)`,
      [pedidoId, 'analise_ia_imovel', JSON.stringify({ concluida: true, modelo: modeloConfigurado() })]
    );
  } catch (e) {
    console.warn('[analise-ia] falha ao registrar marcador de custo:', e.message);
  }

  return { status: 'concluida', analise };
}

module.exports = {
  analisarDocumentosImovel,
  disponivel,
  modeloConfigurado,
  // exportados pra testes:
  _validarSchema: validarSchema,
  _SCHEMA: SCHEMA
};
