// services/analise_documentos_ia.js
//
// V2 — Análise inteligente de documentos imobiliários via Claude Sonnet 4.5.
// Fluxo:
//   A) Classifica cada documento (matricula | escritura | iptu | contrato |
//      certidao_onus | itbi | outro) em 1 chamada Claude por arquivo.
//   B) Extrai dados estruturados unificados dos documentos relevantes em
//      1 única chamada (proprietários, transmissões, ônus, endereço…).
//   C) Cruza os dados extraídos com o JSON-resumo das consultas externas
//      (DirectData, Escavador, InfoSimples, Datajud) e emite alertas.
//
// Falha graciosa: sem ANTHROPIC_API_KEY, o pedido segue sem análise.
// Idempotente: pode rodar 2x para o mesmo pedido sem duplicar.
// Documentos "outro/RG/foto" não bloqueiam o pedido — viram alerta.

const fs = require('fs');
const { pool } = require('../db');
const pedidoAlvos = require('./pedido_alvos');
const extracaoDocs = require('./extracao_documentos');

const MODELO_DEFAULT = 'claude-sonnet-4-5';
const MIME_PDF = 'application/pdf';
const MIMES_IMAGEM = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const TIPOS_RECONHECIDOS = ['matricula', 'escritura', 'iptu', 'contrato', 'certidao_onus', 'itbi', 'outro'];
const TIPOS_RELEVANTES = new Set(['matricula', 'escritura', 'iptu', 'contrato', 'certidao_onus', 'itbi']);

const SYSTEM_PROMPT_BASE = [
  'Você é um assistente jurídico especializado em análise de documentos imobiliários',
  'brasileiros (matrícula de RGI, escritura pública, IPTU, contrato, certidão de ônus, ITBI).',
  'Responda SEMPRE em português brasileiro. Não invente dados que não estão',
  'no documento — quando algo não estiver presente, use null. Use a ferramenta indicada.',
  'Sua prioridade número um é IDENTIFICAR CORRETAMENTE OS PROPRIETÁRIOS (nome + CPF/CNPJ).',
  'Em matrículas brasileiras o CPF aparece tipicamente após "CPF nº", "CPF:",',
  '"inscrito(a) no CPF", "portador(a) do CPF", "CPF/MF nº" e nas averbações/registros',
  '(R-1, R-2, AV-1...). Listar TODOS os CPFs/CNPJs visíveis é melhor que omitir.'
].join(' ');

// ─── Schemas das três tools ──────────────────────────────────────

const SCHEMA_CLASSIFICACAO = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: TIPOS_RECONHECIDOS },
    confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
    resumo_curto: { type: 'string', description: '1 linha descrevendo o documento.' }
  },
  required: ['tipo', 'confianca', 'resumo_curto']
};

const SCHEMA_EXTRACAO = {
  type: 'object',
  properties: {
    matricula: {
      type: ['object', 'null'],
      properties: {
        numero: { type: ['string', 'null'] },
        cartorio: { type: ['string', 'null'] },
        area_total_m2: { type: ['number', 'null'] },
        area_construida_m2: { type: ['number', 'null'] },
        natureza: { type: ['string', 'null'] }
      }
    },
    escritura: {
      type: ['object', 'null'],
      properties: {
        partes: { type: 'array', items: { type: 'string' } },
        valor: { type: ['number', 'null'] },
        data: { type: ['string', 'null'] }
      }
    },
    iptu: {
      type: ['object', 'null'],
      properties: {
        inscricao_municipal: { type: ['string', 'null'] },
        valor_venal: { type: ['number', 'null'] },
        area_construida: { type: ['number', 'null'] }
      }
    },
    proprietarios_atuais: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: ['string', 'null'] },
          cpf_cnpj: { type: ['string', 'null'] },
          tipo_aquisicao: { type: ['string', 'null'] },
          data_aquisicao: { type: ['string', 'null'] }
        }
      }
    },
    transmissoes_historicas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          data: { type: ['string', 'null'] },
          de_nome: { type: ['string', 'null'] },
          de_cpf_cnpj: { type: ['string', 'null'] },
          para_nome: { type: ['string', 'null'] },
          para_cpf_cnpj: { type: ['string', 'null'] },
          valor: { type: ['number', 'null'] },
          tipo: { type: ['string', 'null'] }
        }
      }
    },
    onus_e_gravames: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tipo: { type: ['string', 'null'], description: 'hipoteca|penhora|usufruto|indisponibilidade|alienacao_fiduciaria|outro' },
          credor: { type: ['string', 'null'] },
          valor: { type: ['number', 'null'] },
          data: { type: ['string', 'null'] },
          ativo: { type: ['boolean', 'null'] }
        }
      }
    },
    endereco_completo: { type: ['string', 'null'] }
  },
  required: ['proprietarios_atuais', 'transmissoes_historicas', 'onus_e_gravames']
};

const SCHEMA_CRUZAMENTO = {
  type: 'object',
  properties: {
    resumo_executivo: { type: 'string', description: '3 a 5 linhas conectando documentos e consultas externas.' },
    alertas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severidade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
          categoria: { type: 'string', enum: ['proprietarios', 'transmissoes', 'onus', 'endereco', 'documento', 'outro'] },
          titulo: { type: 'string' },
          descricao: { type: 'string' },
          fonte: { type: 'string', description: 'documento_X | api_Y | cruzamento' }
        },
        required: ['severidade', 'categoria', 'titulo', 'descricao']
      }
    }
  },
  required: ['resumo_executivo', 'alertas']
};

// ─── Helpers ──────────────────────────────────────────────────────

function modeloConfigurado() {
  return (process.env.ANTHROPIC_MODEL || MODELO_DEFAULT).trim();
}

function disponivel() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function clienteAnthropic() {
  const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Lê um documento e devolve um content block compatível com a Messages API.
function montarBloco(doc) {
  const buf = fs.readFileSync(doc.filepath);
  const data = buf.toString('base64');
  const mime = (doc.mime_type || '').toLowerCase();
  if (mime === MIME_PDF) {
    return {
      type: 'document',
      source: { type: 'base64', media_type: MIME_PDF, data },
      title: doc.filename || 'documento'
    };
  }
  if (MIMES_IMAGEM.has(mime)) {
    return { type: 'image', source: { type: 'base64', media_type: mime, data } };
  }
  // tipo desconhecido — tenta como PDF (pode falhar, não derruba o fluxo)
  return {
    type: 'document',
    source: { type: 'base64', media_type: MIME_PDF, data },
    title: doc.filename || 'documento'
  };
}

function digSafe(s) { return (s || '').toString().replace(/\D/g, ''); }

async function temAlvoConsultado(pedidoId) {
  const r = await pool.query('SELECT 1 FROM pedido_alvos WHERE pedido_id = $1 LIMIT 1', [pedidoId]);
  return r.rows.length > 0;
}

function only(obj, keys) {
  if (!obj) return null;
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ─── Etapa A: classificação por documento ─────────────────────────
async function classificarDocumento(client, doc) {
  const tool = {
    name: 'classificar_documento',
    description: 'Classifica um documento imobiliário brasileiro.',
    input_schema: SCHEMA_CLASSIFICACAO
  };
  const userBlocks = [
    montarBloco(doc),
    {
      type: 'text',
      text: [
        'Classifique o documento acima em uma das categorias da tool',
        '`classificar_documento`. Categorias possíveis:',
        '- matricula: matrícula de RGI/cartório',
        '- escritura: escritura pública de compra/venda',
        '- iptu: carnê ou comprovante de IPTU',
        '- contrato: contrato particular de compra/venda, gaveta',
        '- certidao_onus: certidão de ônus reais',
        '- itbi: guia ou comprovante de ITBI',
        '- outro: qualquer outra coisa (RG, foto, doc não imobiliário)',
        'Informe a confiança e um resumo de 1 linha.'
      ].join(' ')
    }
  ];
  const resp = await client.messages.create({
    model: modeloConfigurado(),
    max_tokens: 512,
    system: SYSTEM_PROMPT_BASE,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'classificar_documento' },
    messages: [{ role: 'user', content: userBlocks }]
  });
  const t = (resp.content || []).find(b => b.type === 'tool_use');
  if (!t || !t.input) throw new Error('Claude não devolveu classificação estruturada');
  const out = t.input;
  if (!TIPOS_RECONHECIDOS.includes(out.tipo)) out.tipo = 'outro';
  return out;
}

// ─── Etapa B: extração unificada ──────────────────────────────────
async function extrairDadosUnificado(client, documentos) {
  const tool = {
    name: 'extrair_dados_imovel',
    description: 'Extrai os dados unificados dos documentos imobiliários.',
    input_schema: SCHEMA_EXTRACAO
  };
  const userBlocks = documentos.map(montarBloco);
  userBlocks.push({
    type: 'text',
    text: [
      `Os ${documentos.length} documento(s) acima são relevantes para a análise imobiliária`,
      '(matrícula, escritura, IPTU, contrato, certidão de ônus ou ITBI).',
      'Extraia os dados unificados via `extrair_dados_imovel`. Não invente —',
      'se um campo não aparece em nenhum documento, use null ou omita.',
      '',
      'INSTRUÇÕES CRÍTICAS PARA EXTRAÇÃO DE PROPRIETÁRIOS (CPF/CNPJ):',
      'Encontrar o CPF/CNPJ é a etapa MAIS IMPORTANTE — não pule, não desista.',
      'Em uma matrícula brasileira de imóvel, o CPF/CNPJ dos proprietários',
      'pode aparecer em QUALQUER um destes lugares:',
      '  • No quadro de "Proprietário(s)" / "Titular do domínio"',
      '  • Em averbações (AV-1, AV-2, AV-3...) e registros (R-1, R-2, R-3...)',
      '  • Em texto corrido após termos como: "CPF nº", "CPF n°", "CPF:",',
      '    "CPF/MF nº", "inscrito no CPF", "inscrita no CPF",',
      '    "portador do CPF", "portadora do CPF", "RG ... CPF ...",',
      '    "CNPJ nº", "CNPJ/MF", "CNPJ:"',
      '  • Em escritura pública: nas qualificações das partes',
      '    ("OUTORGANTE VENDEDOR", "OUTORGADO COMPRADOR", "PROMITENTE VENDEDOR")',
      '  • Em matrículas digitalizadas/escaneadas pode estar com OCR ruim —',
      '    procure padrões de 11 dígitos (CPF) ou 14 dígitos (CNPJ) próximos',
      '    a nomes em MAIÚSCULAS, mesmo que faltem pontos/hífens.',
      'O FORMATO do CPF é XXX.XXX.XXX-XX (11 dígitos) e do CNPJ é XX.XXX.XXX/XXXX-XX (14 dígitos),',
      'mas TAMBÉM aceite formatos sem pontuação, com espaços, ou parcialmente formatados.',
      'Liste TODOS os CPFs e CNPJs que encontrar no documento em',
      '`proprietarios_atuais`, mesmo que não tenha certeza absoluta de quem é o',
      'proprietário ATUAL — listar todos é melhor que omitir. Para cada um,',
      'preencha `nome` com o nome da pessoa associada (em maiúsculas costuma',
      'ser o padrão da matrícula). Se houver cônjuge, liste os DOIS.',
      'NÃO confunda CPF/CNPJ com outros números do documento (matrícula, processo,',
      'CEP, valor monetário). CPF tem 11 dígitos, CNPJ tem 14 — confira a contagem.',
      '',
      'Para `onus_e_gravames`, marque `ativo: true` apenas se o documento indicar que o ônus segue vigente.',
      'Para `transmissoes_historicas`, liste em ordem cronológica.'
    ].join('\n')
  });
  const resp = await client.messages.create({
    model: modeloConfigurado(),
    max_tokens: 4096,
    system: SYSTEM_PROMPT_BASE,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'extrair_dados_imovel' },
    messages: [{ role: 'user', content: userBlocks }]
  });
  const t = (resp.content || []).find(b => b.type === 'tool_use');
  if (!t || !t.input) throw new Error('Claude não devolveu extração estruturada');
  return t.input;
}

// ─── Etapa C: cruzamento ──────────────────────────────────────────

// Monta um JSON-resumo a partir das linhas dados_consulta do pedido.
// Inclui apenas o que importa para o cruzamento — evita estourar contexto.
function resumirConsultasExternas(rowsDadosConsulta) {
  const resumo = {
    receita_federal: null,
    vinculos_societarios: [],
    processos: { total: 0, ativos: 0, exemplos: [] },
    protestos: null,
    negativacoes: null,
    veiculos: [],
    veiculos_detran: null
  };
  for (const row of rowsDadosConsulta || []) {
    const dados = typeof row.dados === 'string' ? safeParse(row.dados) : row.dados;
    if (!dados) continue;
    switch (row.fonte) {
      case 'receita_federal':
        resumo.receita_federal = only(dados, ['nome', 'cpf', 'cnpj', 'razao_social', 'situacao_rf', 'endereco', 'logradouro', 'municipio', 'uf', 'cep']);
        break;
      case 'vinculos':
      case 'vinculos_2': {
        const lista = Array.isArray(dados.empresas) ? dados.empresas
          : Array.isArray(dados.socios) ? dados.socios
          : Array.isArray(dados.vinculos) ? dados.vinculos : [];
        for (const v of lista.slice(0, 20)) {
          resumo.vinculos_societarios.push(only(v, ['cnpj', 'razao_social', 'nome', 'qualificacao', 'participacao_pct']));
        }
        break;
      }
      case 'processos':
      case 'processos_2': {
        resumo.processos.total = Number(dados.total || 0);
        const procs = Array.isArray(dados.processos) ? dados.processos : [];
        resumo.processos.ativos = procs.filter(p => (p.status || '').toLowerCase().includes('ativo')).length;
        resumo.processos.exemplos = procs.slice(0, 10).map(p => only(p, ['numero', 'classe', 'tribunal', 'partes', 'objeto', 'endereco', 'status']));
        break;
      }
      case 'protestos':
        resumo.protestos = only(dados, ['total', 'total_pendencias', 'cartorios', 'protestos']);
        break;
      case 'negativacoes':
        resumo.negativacoes = only(dados, ['status', 'total_pendencias', 'detalhes']);
        break;
      case 'veiculos':
        if (Array.isArray(dados.veiculos)) {
          resumo.veiculos = dados.veiculos.slice(0, 20).map(v => only(v, ['placa', 'marca', 'modelo', 'ano', 'endereco_proprietario', 'cidade', 'uf']));
        }
        break;
      case 'detran':
      case 'infosimples_detran':
      case 'veiculo_placa':
        resumo.veiculos_detran = only(dados, ['placa', 'marca', 'modelo', 'endereco_proprietario', 'cidade', 'uf', 'restricoes']);
        break;
    }
  }
  return resumo;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

async function cruzarDados(client, contexto) {
  const tool = {
    name: 'cruzar_dados_imovel',
    description: 'Cruza dados dos documentos com APIs externas e emite alertas.',
    input_schema: SCHEMA_CRUZAMENTO
  };
  const sistema = [
    SYSTEM_PROMPT_BASE,
    'Sua tarefa agora é cruzar os dados extraídos dos documentos imobiliários com',
    'as informações das APIs externas (Receita Federal, vínculos societários, processos,',
    'protestos, negativações, veículos/DETRAN) e emitir alertas relevantes para due',
    'diligence. Foque em: divergência de proprietários, possível ocultação patrimonial',
    'via PJ vinculada, ônus do documento vs bases públicas, endereço do imóvel cruzado',
    'com veículos/processos. Cada problema vira um alerta classificado por severidade',
    'e categoria. Se nada divergir, devolva alertas vazios e um resumo positivo.'
  ].join(' ');

  const txt = [
    'CONTEXTO DA DUE DILIGENCE:',
    '',
    'ALVO DA CONSULTA (quem o operador está investigando):',
    JSON.stringify(contexto.alvo, null, 2),
    '',
    'DOCUMENTOS PROCESSADOS:',
    JSON.stringify(contexto.documentos_processados, null, 2),
    '',
    'DADOS EXTRAÍDOS DOS DOCUMENTOS:',
    JSON.stringify(contexto.dados_extraidos, null, 2),
    '',
    'JSON-RESUMO DAS CONSULTAS EXTERNAS:',
    JSON.stringify(contexto.consultas_externas, null, 2),
    '',
    'Use a tool `cruzar_dados_imovel` para devolver resumo executivo + alertas.',
    'Para cada documento "outro" (não reconhecido), gere um alerta categoria="documento"',
    'severidade="baixa" titulo="Documento não reconhecido" listando o nome do arquivo.'
  ].join('\n');

  const resp = await client.messages.create({
    model: modeloConfigurado(),
    max_tokens: 4096,
    system: sistema,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'cruzar_dados_imovel' },
    messages: [{ role: 'user', content: [{ type: 'text', text: txt }] }]
  });
  const t = (resp.content || []).find(b => b.type === 'tool_use');
  if (!t || !t.input) throw new Error('Claude não devolveu cruzamento estruturado');
  return t.input;
}

// ─── Pipeline principal ───────────────────────────────────────────

function validarSchemaFinal(out) {
  if (!out || typeof out !== 'object') return false;
  if (typeof out.resumo_executivo !== 'string') return false;
  if (!Array.isArray(out.alertas)) return false;
  if (!Array.isArray(out.documentos_processados)) return false;
  return true;
}

async function executarComRetry(fn, label) {
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      return await fn();
    } catch (e) {
      ultimoErro = e;
      console.warn(`[analise-ia] ${label} tentativa ${tentativa} falhou:`, e.message);
    }
  }
  throw ultimoErro || new Error(`${label}: erro desconhecido`);
}

/**
 * Analisa todos os documentos anexados a um pedido. Idempotente.
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
    `SELECT id, tipo, filename, filepath, size_bytes, mime_type, metadata
       FROM pedido_documentos WHERE pedido_id = $1 ORDER BY criado_em ASC`,
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

  const client = clienteAnthropic();

  try {
    // ─ Etapa A: classificação ────────────────────────────────────
    const documentosProcessados = [];
    for (const doc of documentos) {
      let cls;
      try {
        cls = await executarComRetry(() => classificarDocumento(client, doc), `classificacao(${doc.filename})`);
      } catch (e) {
        // Se a classificação falhar de vez, marca como "outro" e segue
        cls = { tipo: 'outro', confianca: 'baixa', resumo_curto: 'Falha ao classificar — tratado como não reconhecido' };
      }
      const irrelevante = cls.tipo === 'outro' || cls.confianca === 'baixa';
      const meta = { confianca: cls.confianca, resumo_curto: cls.resumo_curto, irrelevante };
      await pool.query(
        `UPDATE pedido_documentos SET tipo = $1, metadata = $2 WHERE id = $3`,
        [cls.tipo, JSON.stringify(meta), doc.id]
      );
      documentosProcessados.push({
        id: doc.id,
        filename: doc.filename,
        tipo: cls.tipo,
        confianca: cls.confianca,
        resumo_curto: cls.resumo_curto,
        irrelevante
      });
      doc.tipo = cls.tipo;
      doc._irrelevante = irrelevante;
    }

    // ─ Etapa B: extração (apenas documentos relevantes) ─────────
    const relevantes = documentos.filter(d => TIPOS_RELEVANTES.has(d.tipo) && !d._irrelevante);
    let dadosExtraidos = null;
    if (relevantes.length) {
      dadosExtraidos = await executarComRetry(
        () => extrairDadosUnificado(client, relevantes),
        'extracao_unificada'
      );
    } else {
      dadosExtraidos = {
        proprietarios_atuais: [],
        transmissoes_historicas: [],
        onus_e_gravames: []
      };
    }

    // ─ Etapa B.5: criar pedido_alvos a partir dos proprietários extraídos ─
    // V3: cada proprietário com CPF/CNPJ legível vira 1 linha em pedido_alvos
    // (origem='extraido_ia'). Limita a MAX_ALVOS. Idempotente — não duplica.
    //
    // V3.1: se a IA não retornou nenhum CPF/CNPJ legível, aplicamos um fallback
    // por regex sobre o texto bruto dos PDFs (pdf-parse) com validação de DV.
    // Em matrículas com OCR ruim ou layout atípico, esse fallback frequentemente
    // recupera CPFs que a IA deixou passar — evitando travar em `cpf_ilegivel`.
    const pedidoBaseRes = await pool.query(
      `SELECT id, analise_ia_status, alvo_documento FROM pedidos WHERE id = $1`,
      [pedidoId]
    );
    const pedidoBase = pedidoBaseRes.rows[0] || {};

    const proprietarios = Array.isArray(dadosExtraidos.proprietarios_atuais)
      ? dadosExtraidos.proprietarios_atuais : [];
    const propsLegiveis = proprietarios.filter(p => pedidoAlvos.docLegivel(p?.cpf_cnpj));

    console.log(
      `[analise-ia] pedido ${pedidoId}: IA retornou ${proprietarios.length} proprietários, `
      + `${propsLegiveis.length} com CPF/CNPJ legível`
    );

    // Fallback regex: só roda quando a IA não trouxe nenhum CPF/CNPJ legível,
    // mas há pelo menos 1 documento PDF relevante. Evita custo desnecessário
    // quando a IA já fez o trabalho.
    let achadosRegex = [];
    if (!propsLegiveis.length && relevantes.some(d => (d.mime_type || '').toLowerCase() === MIME_PDF)) {
      console.log(`[analise-ia] pedido ${pedidoId}: IA não extraiu CPF/CNPJ — rodando fallback regex em ${relevantes.length} doc(s)`);
      for (const doc of relevantes) {
        if ((doc.mime_type || '').toLowerCase() !== MIME_PDF) continue;
        const texto = await extracaoDocs.extrairTextoPdf(doc.filepath);
        if (!texto) {
          console.warn(`[analise-ia] pedido ${pedidoId}: pdf-parse não extraiu texto de ${doc.filename}`);
          continue;
        }
        const novos = extracaoDocs.extrairCpfCnpjDoTexto(texto);
        for (const n of novos) {
          if (!achadosRegex.some(a => a.documento === n.documento)) {
            achadosRegex.push({ ...n, fonte_doc: doc.filename });
          }
        }
        console.log(
          `[analise-ia] pedido ${pedidoId}: regex em ${doc.filename} achou `
          + `${novos.length} doc(s) (CPF/CNPJ válidos por DV)`
        );
      }
      console.log(`[analise-ia] pedido ${pedidoId}: total regex (dedup): ${achadosRegex.length} CPF/CNPJ válidos`);
    }

    // Mescla: IA primeiro (se houver), depois regex como complemento
    const candidatosFinais = [
      ...propsLegiveis.map(p => ({
        documento: pedidoAlvos.digSafe(p.cpf_cnpj),
        nome: p.nome || null,
        origem: 'extraido_ia'
      })),
      ...achadosRegex.map(r => ({
        documento: r.documento,
        nome: r.nome || null,
        origem: 'extraido_regex'
      }))
    ];

    const totalAtual = await pedidoAlvos.contarAlvos(pedidoId);
    let inseridosIA = 0;
    let inseridosRegex = 0;
    for (const cand of candidatosFinais) {
      if (totalAtual + inseridosIA + inseridosRegex >= pedidoAlvos.MAX_ALVOS) break;
      const isPrincipal = (totalAtual + inseridosIA + inseridosRegex) === 0;
      const out = await pedidoAlvos.adicionarAlvo(pedidoId, {
        nome: cand.nome,
        documento: cand.documento,
        origem: cand.origem,
        principal: isPrincipal
      });
      if (out?.criado) {
        if (cand.origem === 'extraido_regex') inseridosRegex++;
        else inseridosIA++;
        console.log(
          `[v3] alvo extraído (${cand.origem}): doc=${cand.documento.slice(0, 3)}***${cand.documento.slice(-2)} `
          + `nome=${cand.nome ? cand.nome.slice(0, 30) : '(sem nome)'}`
        );
      }
    }

    // Se nenhuma das estratégias trouxe alvo legível e o pedido foi criado sem
    // CPF (aguardando_extracao), marcamos como cpf_ilegivel. Caso contrário,
    // segue o fluxo normal — o regex pode ter "salvo" o pedido.
    const totalAposExtracao = totalAtual + inseridosIA + inseridosRegex;
    const aguardandoExtracao = pedidoBase.analise_ia_status === 'aguardando_extracao'
      || (!pedidoBase.alvo_documento && !await temAlvoConsultado(pedidoId));
    if (aguardandoExtracao && totalAposExtracao === 0) {
      // Diagnóstico detalhado pra debug
      const razao = (() => {
        if (!proprietarios.length && !achadosRegex.length) return 'IA não retornou proprietários e regex não achou nada';
        if (proprietarios.length && !propsLegiveis.length && !achadosRegex.length) return 'IA retornou proprietários sem CPF/CNPJ legível e regex não achou nada';
        if (!proprietarios.length && achadosRegex.length) return 'IA não retornou proprietários mas regex achou — falha ao inserir alvos';
        return 'sem CPF/CNPJ válido após IA + regex';
      })();
      const msg = 'Não consegui identificar CPF/CNPJ legível dos proprietários nos documentos enviados. Por favor, informe manualmente o CPF/CNPJ do(s) proprietário(s) para liberar as consultas externas.';
      await pool.query(
        `UPDATE pedidos
            SET analise_ia_status = 'cpf_ilegivel',
                erro_processamento = $1,
                atualizado_em = NOW()
          WHERE id = $2`,
        [msg, pedidoId]
      );
      console.warn(
        `[v3] pedido ${pedidoId}: cpf_ilegivel — aguardando preenchimento manual `
        + `(razão: ${razao}; ia=${proprietarios.length}, ia_legíveis=${propsLegiveis.length}, regex=${achadosRegex.length})`
      );
      return { status: 'cpf_ilegivel', erro: msg };
    }

    if (inseridosRegex > 0) {
      console.log(
        `[v3] pedido ${pedidoId}: ${inseridosRegex} alvo(s) recuperado(s) via fallback regex `
        + `(IA havia retornado ${propsLegiveis.length} legível(eis))`
      );
      // Enriquece dadosExtraidos.proprietarios_atuais com os achados do regex
      // pra que o cruzamento e a saída final reflitam os proprietários reais.
      const docsJaPresentes = new Set(
        (dadosExtraidos.proprietarios_atuais || [])
          .map(p => pedidoAlvos.digSafe(p?.cpf_cnpj))
          .filter(Boolean)
      );
      const enriquecidos = achadosRegex
        .filter(r => !docsJaPresentes.has(r.documento))
        .map(r => ({
          nome: r.nome,
          cpf_cnpj: r.documento,
          tipo_aquisicao: null,
          data_aquisicao: null,
          _origem: 'extraido_regex'
        }));
      dadosExtraidos.proprietarios_atuais = [
        ...(dadosExtraidos.proprietarios_atuais || []),
        ...enriquecidos
      ];
    }

    // Sincroniza pedidos.alvo_documento com o primeiro alvo (compat com PDF/listagens)
    if (inseridosIA > 0 || inseridosRegex > 0) {
      await pedidoAlvos.atualizarAlvoPrincipalEmPedido(pedidoId);
    }

    // ─ Etapa C: cruzamento ──────────────────────────────────────
    const pedidoRes = await pool.query(
      `SELECT id, alvo_nome, alvo_documento, alvo_tipo,
              alvo2_nome, alvo2_documento, alvo2_tipo,
              imovel_matricula, imovel_endereco, imovel_estado
         FROM pedidos WHERE id = $1`,
      [pedidoId]
    );
    const pedido = pedidoRes.rows[0] || {};

    const dadosConsultaRes = await pool.query(
      `SELECT fonte, dados FROM dados_consulta WHERE pedido_id = $1`,
      [pedidoId]
    );
    const consultasExternas = resumirConsultasExternas(dadosConsultaRes.rows);

    const contexto = {
      alvo: {
        alvo1: { nome: pedido.alvo_nome, documento: digSafe(pedido.alvo_documento), tipo: pedido.alvo_tipo },
        alvo2: pedido.alvo2_documento ? { nome: pedido.alvo2_nome, documento: digSafe(pedido.alvo2_documento), tipo: pedido.alvo2_tipo } : null,
        imovel: { matricula: pedido.imovel_matricula, endereco: pedido.imovel_endereco, estado: pedido.imovel_estado }
      },
      documentos_processados: documentosProcessados,
      dados_extraidos: dadosExtraidos,
      consultas_externas: consultasExternas
    };

    const cruzamento = await executarComRetry(() => cruzarDados(client, contexto), 'cruzamento');

    // ─ Saída unificada ──────────────────────────────────────────
    const analise = {
      documentos_processados: documentosProcessados,
      resumo_executivo: cruzamento.resumo_executivo || '',
      alertas: Array.isArray(cruzamento.alertas) ? cruzamento.alertas : [],
      identificacao: {
        matricula_numero: dadosExtraidos.matricula?.numero || null,
        cartorio: dadosExtraidos.matricula?.cartorio || null,
        endereco_completo: dadosExtraidos.endereco_completo || null,
        area_total_m2: dadosExtraidos.matricula?.area_total_m2 || null,
        area_construida_m2: dadosExtraidos.matricula?.area_construida_m2 || null,
        inscricao_municipal: dadosExtraidos.iptu?.inscricao_municipal || null,
        natureza: dadosExtraidos.matricula?.natureza || null,
        valor_venal: dadosExtraidos.iptu?.valor_venal || null
      },
      proprietarios: (dadosExtraidos.proprietarios_atuais || []).map((p, i) => ({
        nome: p.nome || null,
        cpf_cnpj: p.cpf_cnpj || null,
        tipo_aquisicao: p.tipo_aquisicao || null,
        data_aquisicao: p.data_aquisicao || null,
        valor_transacao: null,
        atual: i === 0
      })),
      onus_e_gravames: dadosExtraidos.onus_e_gravames || [],
      transmissoes: dadosExtraidos.transmissoes_historicas || []
    };

    if (!validarSchemaFinal(analise)) {
      throw new Error('Saída final não bate com o schema esperado');
    }

    await pool.query(
      `UPDATE pedidos
          SET analise_ia = $1, analise_ia_status = 'concluida', atualizado_em = NOW()
        WHERE id = $2`,
      [JSON.stringify(analise), pedidoId]
    );

    // Marcador para cálculo de custo bruto (services/custos.js).
    // Idempotência: remove marcador anterior antes de inserir o novo.
    try {
      await pool.query(
        `DELETE FROM dados_consulta WHERE pedido_id = $1 AND fonte = 'analise_ia_imovel'`,
        [pedidoId]
      );
      await pool.query(
        `INSERT INTO dados_consulta (pedido_id, fonte, dados) VALUES ($1, $2, $3)`,
        [pedidoId, 'analise_ia_imovel', JSON.stringify({ concluida: true, modelo: modeloConfigurado(), v: 2 })]
      );
    } catch (e) {
      console.warn('[analise-ia] falha ao registrar marcador de custo:', e.message);
    }

    return { status: 'concluida', analise };
  } catch (e) {
    console.error('[analise-ia] pipeline falhou para pedido', pedidoId, ':', e.message);
    await pool.query(
      `UPDATE pedidos SET analise_ia_status = 'falhou', atualizado_em = NOW() WHERE id = $1`,
      [pedidoId]
    );
    return { status: 'falhou', erro: e.message || 'erro desconhecido' };
  }
}

module.exports = {
  analisarDocumentosImovel,
  disponivel,
  modeloConfigurado,
  // exportados pra testes:
  _SCHEMA_CLASSIFICACAO: SCHEMA_CLASSIFICACAO,
  _SCHEMA_EXTRACAO: SCHEMA_EXTRACAO,
  _SCHEMA_CRUZAMENTO: SCHEMA_CRUZAMENTO,
  _resumirConsultasExternas: resumirConsultasExternas
};
