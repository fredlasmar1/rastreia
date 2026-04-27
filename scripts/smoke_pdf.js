/**
 * Smoke test: gera um dossiê de cada tipo com dados minimamente plausíveis,
 * apenas para garantir que não há exceção em runtime após a modularização.
 */
const fs = require('fs');
const path = require('path');
const { gerarDossie } = require('../services/pdf');

const dadosDB = [
  { fonte: 'receita_federal', dados: { nome: 'Joao Silva', cpf: '12345678900', cpf_formatado: '123.456.789-00', situacao_rf: 'REGULAR', data_nascimento: '01/01/1980', idade: 45, sexo: 'M', classe_social: 'B1', renda_estimada: 'R$ 8.500,00', enderecos: [{ logradouro: 'Rua X', numero: '10', cidade: 'Goiania', uf: 'GO', cep: '74000-000' }], telefones: [{ numero: '62999999999', tipo: 'Celular', whatsapp: true }], emails: ['joao@ex.com'], razao_social: 'EMPRESA LTDA', nome_fantasia: 'Empresa', cnpj_formatado: '12.345.678/0001-90', situacao: 'ATIVA', data_abertura: '01/01/2010', porte: 'ME', capital_social: 50000, atividade_principal: 'Comercio varejista', endereco: 'Rua Y, 20', simples_nacional: 'Optante', socios: [{ nome: 'Maria Silva', qualificacao: 'Administrador', desde: '2010', cpf: '***.456.789-**' }] } },
  { fonte: 'processos', dados: { total: 2, fonte: 'Escavador', processos: [
    { numero: '1234567-89.2024.8.09.0001', classe: 'Execucao Fiscal', status: 'Ativo', polo_ativo: 'Fazenda Publica', polo_passivo: 'Joao Silva', valor_causa: 'R$ 10.000,00', tribunal: 'TJGO', data_inicio: '2024-01-10' },
    { numero: '9876543-21.2023.5.18.0001', classe: 'Reclamatoria Trabalhista', status: 'Baixado', polo_ativo: 'Fulano', polo_passivo: 'Empresa Ltda', valor_causa: 'R$ 5.000,00', tribunal: 'TRT18', data_inicio: '2023-03-15' }
  ] } },
  { fonte: 'transparencia', dados: { em_lista_negra: false, ceis: [], cnep: [] } },
  { fonte: 'score_credito', dados: { score: 650, faixa: 'Medio', motivos: ['Tempo de CPF adequado', 'Sem protestos recentes'] } },
  { fonte: 'negativacoes', dados: { status: 'Nada Consta', total_pendencias: 0 } },
  { fonte: 'vinculos', dados: { total: 2, empresas: [{ razao_social: 'Outra Empresa', cnpj: '98.765.432/0001-10', cargo: 'Socio', situacao: 'ATIVA', data_entrada: '2015' }] } },
  { fonte: 'historico_veiculos_proprietario', dados: { disponivel: true, total: 2, proprietario: 'Joao Silva', veiculos: [{ placa: 'ABC1234', veiculo: 'VW Gol 1.0', renavam: '12345', chassi: '9BWZZZ377VT000001', data_aquisicao: '2020-05-10' }] } }
];

const tipos = ['dossie_pf', 'dossie_pj', 'due_diligence', 'due_diligence_imobiliaria', 'investigacao_patrimonial', 'analise_devedor'];

async function main() {
  const outDir = path.join(__dirname, '../public/relatorios');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const tipo of tipos) {
    const pedido = {
      id: 'abcdef0123456789',
      numero: 'T001',
      tipo,
      cliente_nome: 'Recobro Teste',
      alvo_nome: 'Joao Silva',
      alvo_documento: '12345678900',
      alvo_tipo: tipo === 'dossie_pj' || tipo === 'due_diligence' ? 'PJ' : 'PF',
      observacoes: 'Parecer de teste do analista.'
    };
    try {
      const r = await gerarDossie(pedido, dadosDB);
      const size = fs.statSync(r.filepath).size;
      console.log(`OK ${tipo}: ${r.filename} (${size} bytes)`);
    } catch (e) {
      console.error(`FAIL ${tipo}: ${e.message}`);
      console.error(e.stack);
      process.exit(1);
    }
  }

  // consulta veicular
  const pedV = { id: 'abcdef0123456789', numero: 'V001', tipo: 'consulta_veicular', cliente_nome: 'Teste', alvo_placa: 'ABC1234' };
  const dadosV = [
    { fonte: 'veiculo_placa', dados: { disponivel: true, placa: 'ABC1234', marca: 'VW', modelo: 'Gol', marca_modelo: 'VW Gol 1.0', ano_fabricacao: 2019, ano_modelo: 2020, cor: 'Branco', combustivel: 'Flex', chassi: '9BWZZZ377VT000001', renavam: '12345', municipio: 'Goiania', uf: 'GO', situacao: 'Licenciado', proprietario: 'Joao Silva', proprietario_documento: '***.456.789-**', restricoes: [], indicadores: {} } },
    { fonte: 'historico_veiculos_proprietario', dados: { disponivel: true, total: 2, proprietario: 'Joao Silva', veiculos: [{ placa: 'ABC1234', veiculo: 'VW Gol', renavam: '12345', chassi: '9BW', data_aquisicao: '2020-05-10' }, { placa: 'DEF5678', veiculo: 'Fiat Uno', renavam: '67890', chassi: 'ZFA', data_aquisicao: '2018-01-01' }] } },
    { fonte: 'proprietarios_placa', dados: { disponivel: true, total: 2, proprietarios: [{ exercicio: '2024', documento: '12345678900', documento_formatado: '123.456.789-00', nome: 'Joao Silva', uf_circulacao: 'GO', data_pagamento: '2024-05-10' }, { exercicio: '2022', documento: '98765432100', documento_formatado: '987.654.321-00', nome: 'Maria Souza', uf_circulacao: 'SP', data_pagamento: '2022-04-05' }] } }
  ];
  const r = await gerarDossie(pedV, dadosV);
  const size = fs.statSync(r.filepath || r.path).size;
  console.log(`OK consulta_veicular: ${r.filename || r.url} (${size} bytes)`);
}

main().catch(e => { console.error(e); process.exit(1); });
