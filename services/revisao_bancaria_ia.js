/**
 * RASTREIA — Revisão Bancária: chamadas Claude (extração do contrato e parecer).
 *
 * Regra de ouro: a IA LÊ e EXPLICA; quem CALCULA é o código determinístico
 * (services/revisao_bancaria_calculo.js). A extração nunca calcula nem completa
 * lacunas; o parecer usa só os números do JSON do cálculo.
 *
 * Padrão de services/analise_documentos_ia.js: SDK oficial, ANTHROPIC_MODEL do
 * .env, PDF como `document` e foto como `image`, falha graciosa sem chave,
 * idempotência. Diferença: Claude Opus 5.5 / Sonnet 5.5 / Fable 5.1 recusam
 * `tool_choice` forçado (400) — nesses modelos vai `auto` + instrução e o
 * código confere que a ferramenta veio.
 */
const fs = require('fs');
const { pool } = require('../db');
const revisao = require('./revisao_bancaria');

const MODELO_DEFAULT = 'claude-opus-5-5';
const SEM_FORCAR = /claude-(opus-5-5|sonnet-5-5|fable-5-1|mythos-5-1)/;
// US$ por milhão de tokens (entrada, saída) — para o custo por pedido
const PRECO_USD = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-sonnet-4-5': [3, 15], 'claude-opus-5': [5, 25], 'claude-haiku-4-5': [1, 5] };
const LIMITE_BYTES = 24 * 1024 * 1024;     // margem sob o limite de 32 MB por requisição

const modelo = () => (process.env.ANTHROPIC_MODEL || MODELO_DEFAULT).trim();
const disponivel = () => !!process.env.ANTHROPIC_API_KEY;
function cliente() {
  const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const n = { type: ['number', 'null'] };
const s = { type: ['string', 'null'] };
const b = { type: ['boolean', 'null'] };
const TOOL_EXTRACAO = {
  name: 'extrair_contrato_bancario',
  description: 'Registra os dados extraídos do contrato bancário exatamente como estão no documento.',
  input_schema: {
    type: 'object',
    properties: {
      classificacao: {
        type: 'object', description: 'Classificação da operação para escolher a série da taxa média do Banco Central.',
        properties: {
          tipo_operacao: { type: ['string', 'null'], enum: ['financiamento_veiculo', 'emprestimo_pessoal', 'consignado', 'renegociacao', 'ccb_capital_giro', 'conta_garantida', 'desconto_recebiveis', 'antecipacao_cartao', 'cartao_credito', 'cheque_especial', 'financiamento_bens', 'arrendamento_mercantil', 'vendor', 'compror', 'cambio', 'comercio_exterior', 'financiamento_imobiliario', 'outro', null] },
          subtipo: { type: ['string', 'null'], enum: ['inss', 'publico', 'privado', 'parcelado', 'ate_365', 'rotativo', 'cheques', 'veiculo', 'outros', 'importacao', 'exportacao', null], description: 'Consignado: inss/publico/privado; cartão: parcelado; capital de giro: ate_365 ou rotativo; desconto: cheques; leasing: veiculo/outros; comércio exterior: importacao/exportacao.' },
          pfpj: { type: ['string', 'null'], enum: ['PF', 'PJ', null] },
          programa: { type: ['string', 'null'], enum: ['pronampe', 'fco', 'fne', 'fno', 'fies', 'rural', 'sfh', 'mcmv', null], description: 'Linha de programa oficial, só se o contrato disser (Pronampe, FCO/FNE/FNO, Fies, cédula/crédito rural, SFH, Minha Casa Minha Vida). null para crédito comum.' }
        }
      },
      instituicao: { type: 'object', properties: { nome: s, cnpj: s } },
      contratante: { type: 'object', properties: { nome: s, cpf_cnpj: s } },
      operacao: {
        type: 'object',
        properties: {
          tipo: s, numero_contrato: s, data_contratacao: s, data_primeiro_vencimento: s,
          valor_liberado: n, valor_financiado_total: n, prazo_meses: n, valor_parcela: n,
          sistema_amortizacao: { type: ['string', 'null'], enum: ['price', 'sac', 'outro', 'nao_informado', null] },
          taxa_juros_mensal_declarada: n, taxa_juros_anual_declarada: n, cet_mensal: n, cet_anual: n,
          indexador: { type: ['string', 'null'], enum: ['prefixado', 'selic', 'cdi', 'tr', 'ipca', 'outro', null], description: 'Pós-fixado: o índice a que a taxa está atrelada (ex.: "Selic + 6% a.a." ⇒ selic). Taxa fixa ⇒ prefixado.' },
          spread_anual: { type: ['number', 'null'], description: 'Pós-fixado: o acréscimo sobre o índice, em % a.a. (ex.: "Selic + 6% a.a." ⇒ 6).' },
          capitalizacao_expressa: b, clausula_capitalizacao_trecho: s,
          estrutura: { type: ['string', 'null'], enum: ['operacao_unica', 'limite_de_credito', null], description: 'limite_de_credito = o contrato só abre um LIMITE (GiroCaixa, cheque empresa, conta garantida, crédito pré-aprovado) e cada saque/empréstimo tem taxa, prazo e parcela próprios definidos depois; operacao_unica = valor, prazo e parcela fixados no próprio contrato.' },
          limite_credito: { type: ['number', 'null'], description: 'Valor do limite, quando estrutura = limite_de_credito. Não repita o limite em valor_financiado_total.' },
          taxa_minima_mensal: { type: ['number', 'null'], description: 'Quando o contrato fixa só uma FAIXA de juros (ex.: "entre 2,26% e 100% ao mês"): o piso, em % a.m.' },
          taxa_maxima_mensal: { type: ['number', 'null'], description: 'O teto da faixa, em % a.m.' }
        }
      },
      clausulas: {
        type: 'object', description: 'Cláusulas que pesam na estratégia (negociação, risco, garantias). Para cada uma: presente (true/false), número da cláusula (ex.: "Cl. 7ª §3º") e o trecho exato curto. null se o documento não trata do assunto.',
        properties: {
          taxa_reduzida_condicionada: { type: ['object', 'null'], description: 'Taxa com desconto/redutor que é perdida (volta à "taxa balcão") por atraso ou cancelamento do débito automático.', properties: { presente: b, perde_por_atraso: b, perde_por_cancelar_debito: b, aviso_previo: { type: ['boolean', 'null'], description: 'true se o contrato exige avisar o cliente antes de retirar o desconto.' }, clausula: s, trecho: s } },
          debito_em_limite_rotativo: { type: ['object', 'null'], description: 'Autorização para debitar parcelas no limite rotativo / cheque especial quando falta saldo.', properties: { autorizado: b, revogavel: b, clausula: s, trecho: s } },
          garantia_dividas_futuras: { type: ['object', 'null'], description: 'Garantia/aval que cobre operações futuras ou derivadas.', properties: { presente: b, clausula: s, trecho: s } },
          limite_aumentado_pelo_banco: { type: ['object', 'null'], description: 'O banco pode aumentar/renovar o limite por decisão ou aviso próprio.', properties: { presente: b, clausula: s, trecho: s } },
          vencimento_antecipado: { type: ['object', 'null'], properties: { presente: b, sem_notificacao: b, cruzado_outras_operacoes: b, por_fato_de_avalista: { type: ['boolean', 'null'], description: 'Ex.: falta de saldo na conta do avalista, insolvência do avalista.' }, por_debito_fiscal: b, clausula: s, trecho: s } },
          fundo_garantidor: { type: ['object', 'null'], properties: { tipo: { type: ['string', 'null'], enum: ['FGM', 'FGO', 'FAMPE', 'FGI', 'outro', null] }, percentual: n, devedor_segue_cobrado: b, honra_atualiza_pela_selic: b, clausula: s, trecho: s } },
          liquidacao_antecipada: { type: ['object', 'null'], description: 'Quitação/amortização antecipada com desconto (Res. CMN 3.516/2007).', properties: { presente: b, cita_res_3516: b, clausula: s, trecho: s } },
          canal_renegociacao: { type: ['object', 'null'], properties: { presente: b, contato: s, clausula: s, trecho: s } },
          compensacao_ampla: { type: ['object', 'null'], description: 'Banco pode compensar/debitar a dívida em qualquer conta, aplicação ou crédito do devedor.', properties: { presente: b, clausula: s, trecho: s } },
          juros_mora_sobre_juros: { type: ['object', 'null'], description: 'Juros de mora incidindo sobre juros remuneratórios/compensatórios no atraso.', properties: { presente: b, clausula: s, trecho: s } },
          honorarios_extrajudiciais_percentual: n,
          avalistas_quantidade: n,
          aval_com_anuencia_conjuge: b,
          renuncia_beneficio_ordem: b,
          foro: { type: ['string', 'null'], enum: ['justica_federal', 'justica_estadual', null] },
          vigencia_dias: n,
          prazos_de_risco: { type: 'array', description: 'Prazos que disparam consequências: ex. "bloqueio do limite" com 5 dias de atraso.', items: { type: 'object', properties: { evento: s, dias: n, clausula: s } } }
        }
      },
      operacoes_do_limite: {
        type: 'array', description: 'Só para limite_de_credito: cada empréstimo/saque que aparece nos demonstrativos, extratos ou comprovantes enviados. Vazio se só veio o contrato do limite.',
        items: { type: 'object', properties: { data: s, numero: s, valor_liberado: n, taxa_mensal: n, cet_mensal: n, prazo_meses: n, valor_parcela: n, saldo_devedor: n, fgm: b, documento: s } }
      },
      garantia: { type: 'object', properties: { tipo: { type: ['string', 'null'], enum: ['alienacao_fiduciaria', 'consignacao', 'aval', 'nenhuma', 'outro', null] }, bem_descricao: s } },
      lancamentos: {
        type: 'array', description: 'Só se vierem EXTRATOS de conta, extrato do INSS ou holerites: cada cobrança do banco ligada a este crédito (não liste depósitos nem compras). Copie o valor e a descrição exatamente como aparecem; não some nem estime.',
        items: { type: 'object', properties: {
          data: s, descricao: s, valor: n,
          categoria: { type: ['string', 'null'], enum: ['juros_cheque_especial', 'iof', 'tarifa', 'seguro', 'multa', 'juros_mora', 'parcela', 'desconto_rmc', 'honorarios', 'outro', null] },
          taxa_am: { type: ['number', 'null'], description: 'Taxa do mês, em % a.m., se o extrato informar (comum no cheque especial).' },
          documento: s } }
      },
      faturas_cartao: {
        type: 'array', description: 'Só se vierem FATURAS de cartão: uma linha por fatura.',
        items: { type: 'object', properties: {
          mes: { type: ['string', 'null'], description: 'AAAA-MM do vencimento.' },
          no_rotativo: { type: ['boolean', 'null'], description: 'true se o saldo não pago foi para o crédito rotativo nesta fatura.' },
          juros_rotativo: n,
          valor_original_divida: { type: ['number', 'null'], description: 'Valor original da dívida informado na fatura (rotativo/parcelamento).' },
          juros_encargos_acumulados: { type: ['number', 'null'], description: 'Total de juros e encargos já cobrados dessa dívida, se a fatura informar.' },
          taxa_rotativo_am: n, taxa_parcelado_am: n } }
      },
      consignado_info: {
        type: ['object', 'null'], description: 'Só para consignado ou cartão consignado.',
        properties: {
          tipo_vinculo: { type: ['string', 'null'], enum: ['inss', 'clt', 'publico', null] },
          remuneracao: { type: ['number', 'null'], description: 'Benefício ou remuneração mensal (base da margem).' },
          soma_descontos_consignados: { type: ['number', 'null'], description: 'Soma de TODOS os descontos consignados do mês (empréstimos + cartões).' },
          cartao_rmc_rcc: { type: ['boolean', 'null'], description: 'true se há cartão de crédito consignado (RMC) ou cartão benefício (RCC).' },
          cliente_pediu_emprestimo: { type: ['boolean', 'null'], description: 'true só se os documentos mostrarem que o cliente pediu empréstimo comum.' }
        }
      },
      notificacao_mora: {
        type: ['object', 'null'], description: 'Só se vierem documentos de ação de busca e apreensão.',
        properties: { enviada: { type: ['boolean', 'null'], description: 'true se o processo traz a notificação de mora enviada ao devedor; false se o processo foi juntado e ela não está lá.' }, data: s, com_ar: b }
      },
      tarifas: { type: 'array', items: { type: 'object', properties: { nome: s, valor: n, financiada: b, trecho: s } } },
      seguros: { type: 'array', items: { type: 'object', properties: { tipo: s, valor: n, financiado: b, seguradora: s, havia_opcao_recusar: b, trecho: s } } },
      iof: { type: 'object', properties: { valor: n, financiado: b } },
      encargos_mora: { type: 'object', properties: { juros_mora: n, multa_percentual: n, comissao_permanencia: b, comissao_permanencia_cumulada: b, outros: s, trecho: s } },
      pagamentos: {
        type: 'object', description: 'Só se houver extrato, carnê, boletos pagos ou demonstrativo do banco: o que os documentos MOSTRAM como pago. Não estime pela data.',
        properties: {
          parcelas_pagas: { type: ['number', 'null'], description: 'Quantidade de parcelas comprovadamente pagas nos documentos.' },
          ultima_parcela_paga: { type: ['number', 'null'], description: 'Número da última parcela paga.' },
          data_ultimo_pagamento: s,
          parcelas_em_atraso: { type: ['number', 'null'] },
          documento_origem: { type: ['string', 'null'], enum: ['extrato', 'carne', 'boleto', 'demonstrativo_banco', 'outro', null] },
          trecho: s
        }
      },
      paginas_relevantes: { type: 'array', items: { type: 'object', properties: { campo: s, pagina: n } } },
      confianca_por_campo: { type: 'object', additionalProperties: { type: 'string', enum: ['alta', 'media', 'baixa'] } },
      alertas_leitura: { type: 'array', items: { type: 'string' } },
      documentos_classificados: { type: 'array', description: 'Tipo de cada documento enviado, na ordem recebida.', items: { type: 'object', properties: { indice: { type: 'number' }, tipo: { type: 'string', enum: ['contrato', 'extrato', 'boleto', 'carne', 'calculo_banco', 'outro'] } } } }
    },
    required: ['operacao', 'alertas_leitura']
  }
};

const SYSTEM_EXTRACAO = 'Você é um analista de contratos bancários brasileiros. Sua tarefa é EXTRAIR dados do contrato exatamente como estão escritos, sem calcular, sem opinar e sem completar lacunas. Se um campo não estiver no documento, use null e registre em alertas_leitura. Transcreva em "trecho" a frase exata do contrato que sustenta cada tarifa, seguro, cláusula de capitalização e encargo de mora. Valores em reais como número (1234.56). Taxas em percentual como número (2.19 para 2,19%). Datas no formato AAAA-MM-DD. Identifique a página de onde tirou cada dado. Se houver extrato, carnê, boletos pagos ou demonstrativo, preencha pagamentos com o que os documentos comprovam (quantas parcelas pagas, a última, em atraso); sem esses documentos, deixe pagamentos nulo — nunca estime pela data. Se o contrato só abre um LIMITE de crédito (estrutura = limite_de_credito), NÃO coloque o limite em valor_financiado_total; registre-o em limite_credito, a faixa de juros em taxa_minima_mensal/taxa_maxima_mensal, e liste em operacoes_do_limite cada empréstimo que os demonstrativos/extratos mostrarem; se houver um demonstrativo de operação, preencha os campos de operacao (valor, prazo, parcela, taxa, datas) com a operação MAIS RECENTE do demonstrativo. Preencha clausulas com as cláusulas que pesam na estratégia (redutor de taxa perdido, débito no cheque especial, garantia de dívidas futuras, vencimento antecipado, fundo garantidor, quitação antecipada, canal de renegociação, compensação, juros de mora sobre juros, prazos que disparam bloqueio/vencimento), sempre com o número da cláusula e o trecho. Em classificacao, diga o tipo da operação (veículo, empréstimo pessoal, consignado, capital de giro etc.), se o contratante é pessoa física (PF) ou jurídica (PJ) e, só se o contrato disser, o programa oficial (Pronampe, FCO, Fies, crédito rural, SFH, Minha Casa Minha Vida). Taxa pós-fixada: registre o índice em indexador e o acréscimo em spread_anual. Se vierem extratos, faturas, holerites ou extrato do INSS, preencha lancamentos (cada cobrança do banco, com a categoria), faturas_cartao e consignado_info com o que os documentos MOSTRAM; se vier o processo de busca e apreensão, preencha notificacao_mora. Responda sempre em português do Brasil usando a ferramenta.';

function bloco(doc) {
  const data = fs.readFileSync(doc.filepath).toString('base64');
  const mime = (doc.mime_type || '').toLowerCase();
  if (mime.startsWith('image/')) return { type: 'image', source: { type: 'base64', media_type: mime, data } };
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: doc.filename || 'documento' };
}

// Chamada com ferramenta; devolve { input, usage, model }.
async function chamarFerramenta({ system, tool, conteudo, maxTokens = 16000 }) {
  const m = modelo();
  const params = {
    model: m, max_tokens: maxTokens, system, tools: [tool], messages: [{ role: 'user', content: conteudo }],
    tool_choice: SEM_FORCAR.test(m) ? { type: 'auto' } : { type: 'tool', name: tool.name }
  };
  const resp = await cliente().messages.create(params);
  if (resp.stop_reason === 'refusal') throw new Error(`Modelo recusou (${resp.stop_details?.category || 'sem categoria'})`);
  const uso = resp.usage || {};
  const t = (resp.content || []).find(x => x.type === 'tool_use' && x.name === tool.name);
  if (!t || !t.input) throw new Error(`Claude não chamou ${tool.name} (stop_reason=${resp.stop_reason})`);
  return { input: t.input, usage: { input_tokens: uso.input_tokens || 0, output_tokens: uso.output_tokens || 0 }, model: resp.model || m };
}

// Custo da chamada em R$ (cotação em configuracoes.usd_brl, padrão 5,50)
async function custoDaChamada(etapa, r) {
  const [pin, pout] = PRECO_USD[r.model] || PRECO_USD[Object.keys(PRECO_USD).find(k => String(r.model).startsWith(k))] || [4, 20];
  const usd = (r.usage.input_tokens * pin + r.usage.output_tokens * pout) / 1e6;
  const cambio = await revisao.configNum('usd_brl', 5.5);
  return { etapa, modelo: r.model, ...r.usage, custo_usd: usd, custo_brl: usd * cambio, cambio, em: new Date().toISOString() };
}
async function registrarCusto(pedidoId, etapa, r) {
  try {
    await pool.query("INSERT INTO dados_consulta (pedido_id, fonte, dados) VALUES ($1, 'custo_ia_revisao', $2)",
      [pedidoId, JSON.stringify(await custoDaChamada(etapa, r))]);
  } catch (e) { console.warn('[revisao-ia] custo não registrado:', e.message); }
}

/**
 * Lê uma lista de documentos ({ filename, filepath, mime_type, size_bytes })
 * com a ferramenta de extração. Até ~24 MB por requisição; o que passar vira
 * alerta. Devolve { dados, r, usados }.
 */
async function lerDocumentos(docs) {
  const usados = []; const fora = []; let total = 0;
  for (const d of docs) {
    if (!fs.existsSync(d.filepath)) { fora.push(`${d.filename} (arquivo não encontrado no servidor)`); continue; }
    const tam = Number(d.size_bytes) || fs.statSync(d.filepath).size;
    if (total + tam * 1.37 > LIMITE_BYTES) { fora.push(`${d.filename} (limite de tamanho por análise)`); continue; }
    total += tam * 1.37; usados.push(d);
  }
  if (!usados.length) throw new Error('Nenhum documento legível: ' + fora.join('; '));
  const conteudo = [
    ...usados.map(bloco),
    { type: 'text', text: `Documentos recebidos, na ordem: ${usados.map((d, i) => `[${i}] ${d.filename}`).join('; ')}. Use a ferramenta extrair_contrato_bancario para registrar os dados (inclua documentos_classificados com o índice e o tipo de cada um).` }
  ];
  const r = await chamarFerramenta({ system: SYSTEM_EXTRACAO, tool: TOOL_EXTRACAO, conteudo });
  const dados = r.input;
  if (fora.length) dados.alertas_leitura = [...(dados.alertas_leitura || []), ...fora.map(f => `Não analisado: ${f}`)];
  return { dados, r, usados };
}

/**
 * Extração do contrato (etapa 'extraindo' → 'conferencia_operador').
 * Idempotente: se já extraiu e a etapa passou, não chama de novo (use forcar).
 */
async function extrairContrato(pedidoId, { forcar = false, usuarioId = null } = {}) {
  const reg = await revisao.obter(pedidoId);
  if (!reg) return { ok: false, erro: 'registro_revisao_ausente' };
  if (!forcar && reg.dados_extraidos && reg.etapa !== 'extraindo' && reg.etapa !== 'aguardando_documentos') {
    return { ok: true, ja_extraido: true, etapa: reg.etapa };
  }
  const docs = (await pool.query('SELECT id, filename, filepath, mime_type, size_bytes FROM pedido_documentos WHERE pedido_id = $1 ORDER BY id', [pedidoId])).rows;
  if (!docs.length) {
    await revisao.atualizar(pedidoId, { etapa: 'aguardando_documentos', usuarioId, acao: 'Revisão bancária: aguardando contrato' });
    return { ok: false, erro: 'sem_documentos' };
  }
  if (!disponivel()) {
    await revisao.atualizar(pedidoId, { etapa: 'conferencia_operador', usuarioId, acao: 'Revisão bancária: extração IA indisponível', detalhes: 'ANTHROPIC_API_KEY ausente — operador preenche os dados' });
    return { ok: false, erro: 'ia_indisponivel' };
  }
  await revisao.atualizar(pedidoId, { etapa: 'extraindo', usuarioId, acao: 'Revisão bancária: extração IA iniciada', detalhes: `${docs.length} documento(s)` });

  try {
    const { dados, r, usados } = await lerDocumentos(docs);
    for (const c of dados.documentos_classificados || []) {
      const d = usados[c.indice];
      if (d && c.tipo) await pool.query('UPDATE pedido_documentos SET tipo = $1 WHERE id = $2', [c.tipo, d.id]);
    }
    await pool.query("INSERT INTO dados_consulta (pedido_id, fonte, dados) VALUES ($1, 'revisao_bancaria_extracao', $2)", [pedidoId, JSON.stringify(dados)]);
    await registrarCusto(pedidoId, 'extracao', r);
    await revisao.atualizar(pedidoId, { etapa: 'conferencia_operador', campos: { dados_extraidos: dados }, usuarioId, acao: 'Revisão bancária: extração IA concluída', detalhes: `${r.model} · ${r.usage.input_tokens}+${r.usage.output_tokens} tokens · ${(dados.alertas_leitura || []).length} alerta(s)` });
    return { ok: true, etapa: 'conferencia_operador', dados };
  } catch (e) {
    console.error('[revisao-ia] extração falhou:', e.message);
    await revisao.atualizar(pedidoId, { etapa: 'conferencia_operador', usuarioId, acao: 'Revisão bancária: extração IA falhou', detalhes: `${e.message} — operador preenche os dados` });
    return { ok: false, erro: e.message };
  }
}

// ── Parecer explicativo (item 9): recebe SOMENTE o JSON do caso ─────────────
const TOOL_PARECER = {
  name: 'redigir_parecer',
  description: 'Registra o parecer explicativo da revisão do contrato bancário.',
  input_schema: {
    type: 'object',
    properties: {
      resumo_cliente: { type: 'string', description: 'Até 6 frases curtas, sem juridiquês.' },
      pontos_encontrados: { type: 'array', items: { type: 'string' } },
      analise_tecnica: { type: 'string', description: 'Para o advogado revisor.' },
      proximos_passos: { type: 'array', items: { type: 'string' }, description: 'Sempre condicionados à validação do advogado.' },
      ressalvas: { type: 'array', items: { type: 'string' } }
    },
    required: ['resumo_cliente', 'pontos_encontrados', 'analise_tecnica', 'proximos_passos', 'ressalvas']
  }
};
const SYSTEM_PARECER = 'Você é um analista financeiro que explica revisões de contrato bancário para clientes leigos e para o advogado revisor. Use APENAS os números fornecidos no JSON; nunca recalcule, arredonde de outro jeito ou crie valores. Escreva em português do Brasil, frases curtas, sem juridiquês no resumo do cliente. Nunca prometa resultado: use "estimativa", "potencial" e "depende de análise judicial". Não diga que o banco agiu de má-fé. Não recomende parar de pagar as parcelas. Se numeros_formatados.juros_revisaveis for false, NÃO diga que os juros são abusivos nem que estão "acima da média" como problema: siga o aviso_juros; o valor em economia_otimista_nao_garantida, se houver, só pode aparecer como possibilidade incerta. Para cada tese aplicável, cite o trecho do contrato que a sustenta. Gere: (1) resumo_cliente com até 6 frases; (2) pontos_encontrados em lista; (3) analise_tecnica para o advogado; (4) proximos_passos sugeridos, sempre condicionados à validação do advogado; (5) ressalvas. Use a ferramenta redigir_parecer.';

async function gerarParecer(pedidoId, caso) {
  if (!disponivel()) return { ok: false, erro: 'ia_indisponivel' };
  try {
    const r = await chamarFerramenta({
      system: SYSTEM_PARECER, tool: TOOL_PARECER, maxTokens: 8000,
      conteudo: [{ type: 'text', text: 'JSON do caso (use somente estes números, já formatados em numeros_formatados):\n' + JSON.stringify(caso) }]
    });
    await registrarCusto(pedidoId, 'parecer', r);
    return { ok: true, parecer: r.input, modelo: r.model };
  } catch (e) {
    console.error('[revisao-ia] parecer falhou:', e.message);
    return { ok: false, erro: e.message };
  }
}

module.exports = { lerDocumentos, custoDaChamada, extrairContrato, gerarParecer, chamarFerramenta, registrarCusto, disponivel, modelo, TOOL_EXTRACAO, SYSTEM_EXTRACAO, TOOL_PARECER, SYSTEM_PARECER };
