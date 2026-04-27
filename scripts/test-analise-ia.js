// scripts/test-analise-ia.js
// Smoke test do serviço de análise IA de documentos imobiliários.
//
// Uso:
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/test-analise-ia.js path/to/matricula.pdf
//
// Sem API key, apenas valida o schema e a montagem dos blocks (não chama a API).
//
// IMPORTANTE: NÃO comitar PDFs reais ao repo. Rode localmente com seu próprio arquivo.

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { _validarSchema, _SCHEMA, disponivel, modeloConfigurado } = require('../services/analise_documentos_ia');

async function main() {
  const arq = process.argv[2];
  console.log('— Smoke test de análise IA —');
  console.log('ANTHROPIC_API_KEY definida:', disponivel());
  console.log('Modelo:', modeloConfigurado());
  console.log('Schema OK:', !!_SCHEMA && !!_SCHEMA.properties.alertas);

  // Sanity check do validador
  const exemplo = {
    resumo_executivo: 'Imóvel residencial com matrícula limpa.',
    alertas: [{ severidade: 'baixa', titulo: 'OK', descricao: 'Sem ônus' }],
    identificacao: { matricula_numero: '12345', cartorio: '1º RGI', endereco_completo: 'Rua X, 100', area_total_m2: 250, area_construida_m2: 180, inscricao_municipal: null, natureza: 'residencial' },
    proprietarios: [{ nome: 'Fulano', cpf_cnpj: '12345678900', tipo_aquisicao: 'compra e venda', data_aquisicao: '2020-05-10', valor_transacao: 850000, atual: true }]
  };
  console.log('Validador aceita exemplo válido:', _validarSchema(exemplo));
  console.log('Validador rejeita objeto vazio:', !_validarSchema({}));

  if (!arq) {
    console.log('\nNenhum arquivo passado — pulando chamada real à API.');
    console.log('Para teste end-to-end: node scripts/test-analise-ia.js path/to/matricula.pdf');
    return;
  }
  if (!fs.existsSync(arq)) {
    console.error('Arquivo não encontrado:', arq);
    process.exit(1);
  }
  if (!disponivel()) {
    console.error('ANTHROPIC_API_KEY não definida — não é possível chamar a API.');
    process.exit(1);
  }

  // Importa lazy pra não quebrar quando @anthropic-ai/sdk não está instalado
  const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const ext = path.extname(arq).toLowerCase();
  const mime = ext === '.pdf' ? 'application/pdf'
    : ext === '.png' ? 'image/png'
    : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
    : null;
  if (!mime) { console.error('Extensão não suportada:', ext); process.exit(1); }
  const data = fs.readFileSync(arq).toString('base64');
  const block = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mime, data }, title: path.basename(arq) }
    : { type: 'image', source: { type: 'base64', media_type: mime, data } };

  console.log(`\nEnviando ${path.basename(arq)} (${mime}) para ${modeloConfigurado()}...`);
  const tool = { name: 'extrair_dados_imovel', description: 'Extrai dados estruturados do imóvel.', input_schema: _SCHEMA };
  const resp = await client.messages.create({
    model: modeloConfigurado(),
    max_tokens: 4096,
    system: 'Você é um assistente jurídico especializado em documentos imobiliários brasileiros. Use a ferramenta extrair_dados_imovel.',
    tools: [tool],
    tool_choice: { type: 'tool', name: 'extrair_dados_imovel' },
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'Extraia os dados deste documento imobiliário.' }] }]
  });
  const toolUse = (resp.content || []).find(b => b.type === 'tool_use');
  console.log('\n— Saída —');
  console.log(JSON.stringify(toolUse?.input, null, 2));
  console.log('\nValidador aceita resposta real:', _validarSchema(toolUse?.input));
  console.log('Tokens — input:', resp.usage?.input_tokens, '| output:', resp.usage?.output_tokens);
}

main().catch(e => {
  console.error('Erro:', e.message);
  process.exit(1);
});
