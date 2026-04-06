/**
 * RASTREIA — Definição dos Produtos
 * 
 * Para cada produto: o que entrega, para quem, por que compra,
 * quais dados são críticos, e como calcular o score de risco.
 */

const PRODUTOS = {

  // ─────────────────────────────────────────────────────────
  // DOSSIÊ PF — R$ 197 | Entrega em 2h
  // "Saiba com quem você está negociando antes de assinar"
  // ─────────────────────────────────────────────────────────
  dossie_pf: {
    nome: 'Dossiê Pessoa Física',
    preco: 197,
    prazo_horas: 2,
    icone: '👤',

    // Para quem vender:
    publico_alvo: [
      'Empresário que vai vender a prazo para pessoa física',
      'Proprietário que vai alugar imóvel para inquilino',
      'Empresa que vai contratar prestador de serviço PF',
      'Quem vai firmar sociedade com pessoa física',
      'Quem vai emprestar dinheiro para alguém',
    ],

    // Argumento de venda:
    argumento: 'Antes de assinar qualquer contrato com uma pessoa física, você precisa saber: ela tem processos como réu? Está com nome sujo? Existe patrimônio que garanta a dívida? Em 2 horas você tem a resposta.',

    // Dados que o relatório entrega:
    dados_entregues: [
      { secao: 'IDENTIFICAÇÃO', campos: ['Nome completo', 'CPF', 'Data de nascimento', 'Idade', 'Sexo', 'Nome da mãe', 'Nome do pai', 'Situação cadastral na Receita Federal', 'Flag de óbito'] },
      { secao: 'CONTATOS E LOCALIZAÇÃO', campos: ['Endereços (até 3 mais recentes)', 'Telefones com operadora e flag WhatsApp', 'Emails cadastrados', 'CEP e bairro'] },
      { secao: 'PERFIL ECONÔMICO', campos: ['Classe social estimada', 'Faixa de renda estimada', 'Ocupação (CBO)'] },
      { secao: 'PROCESSOS JUDICIAIS', campos: ['Total de processos como réu', 'Total como autor', 'Processos trabalhistas', 'Processos cíveis', 'Execuções', 'Valor total das causas', 'Tribunais envolvidos (TJGO, TRF1, STJ)'] },
      { secao: 'RESTRIÇÕES E NEGATIVAÇÕES', campos: ['Situação Serasa (quando disponível)', 'Protestos em cartório', 'Inscrições em dívida ativa', 'Cheques sem fundo (quando disponível)'] },
      { secao: 'LISTAS NEGRAS', campos: ['CEIS - Lista de inidôneos federais', 'CNEP - Empresas punidas (se tiver PJ vinculada)'] },
      { secao: 'SCORE E PARECER', campos: ['Score de risco (0-100)', 'Classificação: BAIXO / MÉDIO / ALTO / CRÍTICO', 'Recomendação do analista', 'Pontos de atenção'] },
    ],

    // Campos críticos para o score
    fatores_score: [
      { fator: 'processos_como_reu', peso: 30 },
      { fator: 'execucoes_ativas', peso: 25 },
      { fator: 'situacao_rf', peso: 20 },
      { fator: 'negativacoes', peso: 15 },
      { fator: 'protestos', peso: 10 },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // DOSSIÊ PJ — R$ 397 | Entrega em 2h
  // "Saiba com quem sua empresa está negociando"
  // ─────────────────────────────────────────────────────────
  dossie_pj: {
    nome: 'Dossiê Pessoa Jurídica',
    preco: 397,
    prazo_horas: 2,
    icone: '🏢',

    publico_alvo: [
      'Empresa que vai vender a prazo para outra empresa',
      'Fornecedor que vai conceder crédito a cliente PJ',
      'Quem vai fechar contrato de prestação de serviços',
      'Empresa que vai firmar parceria ou representação comercial',
      'Quem vai aceitar cheque ou boleto de empresa desconhecida',
    ],

    argumento: 'Empresa com CNPJ ativo não significa empresa saudável. Antes de vender fiado ou assinar contrato, descubra: a empresa tem dívidas trabalhistas, execuções fiscais, sócios problemáticos? Em 2 horas você sabe.',

    dados_entregues: [
      { secao: 'IDENTIFICAÇÃO EMPRESARIAL', campos: ['Razão social e nome fantasia', 'CNPJ formatado', 'Data de abertura', 'Tempo de existência', 'Porte (ME, EPP, Grande)', 'Natureza jurídica', 'Capital social', 'Situação cadastral na RF'] },
      { secao: 'ATIVIDADE E LOCALIZAÇÃO', campos: ['Atividade principal (CNAE)', 'Atividades secundárias', 'Endereço completo com CEP', 'Telefones e email cadastrados', 'Filiais (quantidade)'] },
      { secao: 'REGIME TRIBUTÁRIO', campos: ['Simples Nacional (optante/não optante)', 'MEI (sim/não)', 'Regime tributário (Lucro Real/Presumido)', 'Situação no Simples'] },
      { secao: 'QUADRO SOCIETÁRIO', campos: ['Nome de todos os sócios', 'CPF parcial de cada sócio', 'Qualificação (administrador, cotista, etc.)', 'Data de entrada na sociedade', 'Histórico de alterações societárias'] },
      { secao: 'PROCESSOS JUDICIAIS', campos: ['Total de processos como réu', 'Processos trabalhistas (risco de passivo oculto)', 'Execuções fiscais e tributárias', 'Ações cíveis', 'Valor total das causas', 'Tribunais: TJGO, TRF1, TST, STJ'] },
      { secao: 'SITUAÇÃO FISCAL E DÍVIDAS', campos: ['Dívida ativa federal (quando disponível)', 'Certidão de regularidade fiscal', 'Protestos em cartório', 'Negativações Serasa (quando disponível)'] },
      { secao: 'LISTAS NEGRAS FEDERAIS', campos: ['CEIS - Empresa inidônea ou suspensa', 'CNEP - Empresa punida com multa', 'Tipo de sanção e órgão sancionador', 'Período da sanção'] },
      { secao: 'SCORE E PARECER', campos: ['Score de risco empresarial (0-100)', 'Classificação: BAIXO / MÉDIO / ALTO / CRÍTICO', 'Recomendação: liberar crédito / exigir garantias / não negociar', 'Pontos de atenção'] },
    ],

    fatores_score: [
      { fator: 'situacao_rf', peso: 25 },
      { fator: 'processos_trabalhistas', peso: 20 },
      { fator: 'lista_negra_federal', peso: 20 },
      { fator: 'execucoes', peso: 20 },
      { fator: 'tempo_existencia', peso: 15 },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // DUE DILIGENCE EMPRESARIAL — R$ 997 | Entrega em 24h
  // "Antes de comprar, investir ou virar sócio"
  // ─────────────────────────────────────────────────────────
  due_diligence: {
    nome: 'Due Diligence Empresarial',
    preco: 997,
    prazo_horas: 24,
    icone: '🔎',

    publico_alvo: [
      'Quem vai comprar uma empresa ou ponto comercial',
      'Investidor que vai aportar capital numa empresa',
      'Quem vai se tornar sócio de uma empresa existente',
      'Empresa que vai adquirir outra (M&A)',
      'Advogado que precisa de due diligence para cliente',
      'Banco ou fundo que vai conceder crédito empresarial alto',
    ],

    argumento: 'Comprar uma empresa sem due diligence é assinar um cheque em branco. Passivos trabalhistas ocultos, sócios com histórico criminal, dívidas fiscais não declaradas — você herda tudo. Em 24h entregamos um laudo completo para sua decisão.',

    dados_entregues: [
      { secao: 'IDENTIFICAÇÃO COMPLETA', campos: ['Todos os dados do Dossiê PJ', 'Histórico completo de alterações no CNPJ', 'Razões sociais anteriores', 'Histórico de endereços'] },
      { secao: 'ANÁLISE DOS SÓCIOS', campos: ['Dossiê PF de cada sócio atual', 'Histórico de sócios anteriores', 'Outras empresas vinculadas a cada sócio', 'Processos individuais dos sócios como réu', 'Situação financeira pessoal estimada dos sócios'] },
      { secao: 'PASSIVO JUDICIAL DETALHADO', campos: ['Todos os processos com número CNJ', 'Polo ativo e passivo de cada processo', 'Valor de causa de cada processo', 'Fase processual atual', 'Estimativa de risco de condenação', 'Processos trabalhistas (cada reclamante)', 'Execuções fiscais ativas'] },
      { secao: 'SITUAÇÃO FISCAL E REGULARIDADE', campos: ['Certidão de Regularidade Federal (CND)', 'Certidão Estadual Goiás (SEFAZ-GO)', 'Certidão Municipal Anápolis', 'Situação FGTS', 'Dívida ativa PGFN', 'Débitos Simples Nacional'] },
      { secao: 'PATRIMÔNIO DA EMPRESA', campos: ['Imóveis registrados em nome do CNPJ (quando disponível)', 'Veículos registrados (quando disponível)', 'Marcas e patentes (INPI)', 'Contratos públicos ativos (Portal da Transparência)'] },
      { secao: 'LISTAS E RESTRIÇÕES', campos: ['CEIS e CNEP detalhados', 'CEPIM (entidades privadas impedidas)', 'Fornecedores suspensos', 'Registro em Cadastros de Inadimplentes'] },
      { secao: 'ANÁLISE DE RISCO CONSOLIDADA', campos: ['Score de risco 0-100', 'Risco trabalhista (baixo/médio/alto)', 'Risco fiscal (baixo/médio/alto)', 'Risco societário (baixo/médio/alto)', 'Risco judicial (baixo/médio/alto)'] },
      { secao: 'PARECER TÉCNICO FINAL', campos: ['Resumo executivo', 'Pontos críticos identificados', 'Cláusulas contratuais recomendadas (representações e garantias)', 'Recomendação: PROSSEGUIR / PROSSEGUIR COM RESSALVAS / NÃO PROSSEGUIR', 'Sugestão de ajuste no preço baseado nos riscos identificados'] },
    ],

    fatores_score: [
      { fator: 'passivo_trabalhista', peso: 25 },
      { fator: 'divida_fiscal', peso: 25 },
      { fator: 'lista_negra', peso: 20 },
      { fator: 'processos_socios', peso: 15 },
      { fator: 'regularidade_certidoes', peso: 15 },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // ANÁLISE DE DEVEDOR — R$ 250 | Entrega em 2h
  // "Vale a pena cobrar? Descubra antes de gastar com advogado"
  // ─────────────────────────────────────────────────────────
  analise_devedor: {
    nome: 'Análise de Devedor',
    preco: 250,
    prazo_horas: 2,
    icone: '⚖️',

    publico_alvo: [
      'Empresa com cliente inadimplente que não sabe se vale cobrar',
      'Escritório de advocacia antes de aceitar causa de êxito',
      'Credor com título vencido avaliando se ajuíza execução',
      'Clínica médica, escola, loja com devedores antigos',
      'Recobro analisando viabilidade de carteira',
    ],

    argumento: 'Antes de gastar com advogado, cartório e processo, descubra se o devedor tem patrimônio para pagar. Cobrar devedor "laranja" é jogar dinheiro fora. Em 2h você sabe se vale a pena ir atrás.',

    dados_entregues: [
      { secao: 'IDENTIFICAÇÃO DO DEVEDOR', campos: ['Nome/Razão Social', 'CPF/CNPJ', 'Endereços atuais (para citação)', 'Telefones ativos (para contato de cobrança)', 'Emails'] },
      { secao: 'SITUAÇÃO PATRIMONIAL', campos: ['Imóveis identificados (quando disponível)', 'Veículos registrados (quando disponível)', 'Empresas abertas em nome do devedor', 'Participação societária em outras empresas', 'Estimativa de patrimônio'] },
      { secao: 'HISTÓRICO COMO DEVEDOR', campos: ['Processos de execução como réu', 'Protestos em cartório', 'Negativações ativas', 'Histórico de inadimplência', 'Outras dívidas em cobrança judicial'] },
      { secao: 'CAPACIDADE DE PAGAMENTO', campos: ['Renda estimada (PF)', 'Faturamento estimado (PJ)', 'Classe social/porte da empresa', 'Situação cadastral na RF', 'Regime tributário (PJ)'] },
      { secao: 'ESTRATÉGIA DE COBRANÇA RECOMENDADA', campos: ['Abordagem recomendada: amigável / judicial / mista', 'Bens sugeridos para penhora', 'Probabilidade de recebimento: ALTA / MÉDIA / BAIXA / IRRECUPERÁVEL', 'Prazo estimado para recuperação'] },
      { secao: 'SCORE DE RECUPERABILIDADE', campos: ['Score 0-100', 'Classificação: RECUPERÁVEL / PARCIALMENTE RECUPERÁVEL / IRRECUPERÁVEL', 'Recomendação: COBRAR / NEGOCIAR DESCONTO / BAIXAR'] },
    ],

    fatores_score: [
      { fator: 'patrimonio_identificado', peso: 40 },
      { fator: 'renda_estimada', peso: 25 },
      { fator: 'execucoes_como_reu', peso: 20 },
      { fator: 'situacao_rf', peso: 15 },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // INVESTIGAÇÃO PATRIMONIAL — R$ 497 | Entrega em 4h
  // "Localize os bens antes de entrar com a execução"
  // ─────────────────────────────────────────────────────────
  investigacao_patrimonial: {
    nome: 'Investigação Patrimonial',
    preco: 497,
    prazo_horas: 4,
    icone: '🏦',

    publico_alvo: [
      'Advogado com título judicial para executar',
      'Credor com sentença favorável mas devedor "sem bens"',
      'Empresa que ganhou ação e quer receber',
      'Escritório de advocacia para instrução de execução',
      'Quem suspeita que devedor ocultou patrimônio',
    ],

    argumento: 'Ganhar a ação é só metade do caminho. Se não localizar os bens, não recebe. Mapeamos imóveis, veículos, empresas e participações societárias do devedor — tudo para você entrar na execução com alvo certo.',

    dados_entregues: [
      { secao: 'IDENTIFICAÇÃO E LOCALIZAÇÃO ATUAL', campos: ['Dados completos do investigado', 'Todos os endereços identificados', 'Telefones para localização', 'CPF/CNPJ de todos os vínculos'] },
      { secao: 'IMÓVEIS E BENS RAÍZES', campos: ['Imóveis registrados em nome próprio', 'Imóveis em nome de empresas vinculadas', 'Participação em condomínios', 'Matrícula e cartório de registro (quando disponível)', 'Estimativa de valor de mercado'] },
      { secao: 'VEÍCULOS', campos: ['Veículos em nome do investigado', 'Veículos em nome de empresas vinculadas', 'Placa, modelo, ano, chassi (quando disponível)', 'Situação de multas e restrições'] },
      { secao: 'EMPRESAS E PARTICIPAÇÕES SOCIETÁRIAS', campos: ['Todas as empresas abertas em nome do investigado', 'Participação societária em outras empresas', 'CNPJs ativos e encerrados', 'Capital social de cada empresa', 'Situação de cada empresa na RF'] },
      { secao: 'VÍNCULOS E INTERPOSTAS PESSOAS', campos: ['Empresas de familiares diretos (cônjuge, filhos)', 'Histórico de transferências patrimoniais recentes', 'Sócios em comum com outras empresas', 'Possíveis laranjas identificados'] },
      { secao: 'PROCESSOS COMO RÉU', campos: ['Execuções ativas contra o investigado', 'Penhoras já registradas', 'Bloqueios BACENJUD/RENAJUD ativos', 'Ordem de prioridade entre credores'] },
      { secao: 'ESTRATÉGIA DE EXECUÇÃO', campos: ['Bens recomendados para penhora (ordem de preferência)', 'Estimativa do valor total localizável', 'Alertas de possível fraude à execução', 'Recomendação: penhora de imóvel / veículo / conta / quota societária'] },
      { secao: 'CONCLUSÃO', campos: ['Patrimônio total estimado localizado', 'Viabilidade da execução: VIÁVEL / PARCIALMENTE VIÁVEL / INVIÁVEL', 'Próximos passos recomendados'] },
    ],

    fatores_score: [
      { fator: 'imoveis_encontrados', peso: 35 },
      { fator: 'veiculos_encontrados', peso: 25 },
      { fator: 'empresas_ativas', peso: 25 },
      { fator: 'ausencia_penhoras', peso: 15 },
    ],
  },
};

// ─────────────────────────────────────────────────────────
// CALCULADORA DE SCORE DE RISCO
// ─────────────────────────────────────────────────────────

function calcularScore(tipo, dados) {
  let score = 100; // começa no máximo (melhor)
  const alertas = [];

  const processos = dados.processos || {};
  const cadastral = dados.receita_federal || {};
  const transparencia = dados.transparencia || {};

  // Penalidades por processos judiciais
  const totalProcessos = processos.total || 0;
  if (totalProcessos > 0) {
    const penalidade = Math.min(totalProcessos * 5, 40);
    score -= penalidade;
    alertas.push(`${totalProcessos} processo(s) judicial(is) encontrado(s)`);
  }

  // Penalidade por lista negra federal
  if (transparencia.em_lista_negra) {
    score -= 40;
    alertas.push('⚠️ CRÍTICO: Empresa/Pessoa consta em lista negra federal (CEIS/CNEP)');
  }

  // Penalidade por situação irregular na RF
  const situacao = (cadastral.situacao || cadastral.situacao_rf || '').toLowerCase();
  if (situacao && !situacao.includes('ativ') && !situacao.includes('regular')) {
    score -= 25;
    alertas.push(`Situação irregular na Receita Federal: ${situacao}`);
  }

  // Penalidade por óbito (PF)
  if (cadastral.obito === true) {
    score -= 50;
    alertas.push('⚠️ CRÍTICO: Registro de óbito encontrado para este CPF');
  }

  // Bônus por empresa antiga (PJ)
  if (cadastral.data_abertura) {
    const anos = new Date().getFullYear() - new Date(cadastral.data_abertura).getFullYear();
    if (anos >= 5) score = Math.min(score + 5, 100);
    if (anos < 1) { score -= 10; alertas.push('Empresa com menos de 1 ano de existência'); }
  }

  score = Math.max(0, Math.min(100, score));

  let classificacao, cor, recomendacao;
  if (score >= 75) {
    classificacao = 'BAIXO RISCO';
    cor = 'verde';
    recomendacao = 'Perfil favorável para negociação. Recomendamos prosseguir com as devidas cautelas contratuais.';
  } else if (score >= 50) {
    classificacao = 'RISCO MÉDIO';
    cor = 'laranja';
    recomendacao = 'Existem pontos de atenção. Recomendamos exigir garantias antes de prosseguir.';
  } else if (score >= 25) {
    classificacao = 'ALTO RISCO';
    cor = 'vermelho';
    recomendacao = 'Perfil de risco elevado. Recomendamos fortemente exigir garantias reais ou recusar a negociação.';
  } else {
    classificacao = 'RISCO CRÍTICO';
    cor = 'vermelho';
    recomendacao = '⚠️ Não recomendamos prosseguir com esta negociação sem análise jurídica especializada.';
  }

  return { score, classificacao, cor, recomendacao, alertas };
}

// ─────────────────────────────────────────────────────────
// GERADOR DE CHECKLIST POR PRODUTO
// Entrega ao operador o que ainda precisa verificar manualmente
// ─────────────────────────────────────────────────────────

function gerarChecklist(tipo, dadosAutomaticos) {
  const checklists = {
    dossie_pf: [
      { item: 'Consultar Serasa manualmente', link: 'https://www.serasaexperian.com.br', obrigatorio: false },
      { item: 'Verificar protestos no Cartório de Protesto de Anápolis', link: 'https://www.protestodigital.com.br', obrigatorio: false },
      { item: 'Confirmar endereço atual no JusBrasil', link: dadosAutomaticos?.processos?.link_jusbrasil || '#', obrigatorio: true },
      { item: 'Verificar se CPF consta no Cadastro de Inadimplentes do Município', link: '', obrigatorio: false },
    ],
    dossie_pj: [
      { item: 'Verificar Certidão Negativa Federal (PGFN)', link: 'https://solucoes.receita.fazenda.gov.br/servicos/certidaointernet/pj/emitir', obrigatorio: true },
      { item: 'Verificar SEFAZ-GO (situação estadual Goiás)', link: 'https://www.sefaz.go.gov.br', obrigatorio: true },
      { item: 'Verificar protestos no Cartório', link: 'https://www.protestodigital.com.br', obrigatorio: false },
      { item: 'Confirmar processos no JusBrasil', link: dadosAutomaticos?.processos?.link_jusbrasil || '#', obrigatorio: true },
      { item: 'Verificar Serasa PJ manualmente', link: 'https://www.serasaexperian.com.br', obrigatorio: false },
    ],
    due_diligence: [
      { item: 'Emitir CND Federal', link: 'https://solucoes.receita.fazenda.gov.br/servicos/certidaointernet/pj/emitir', obrigatorio: true },
      { item: 'Emitir CND Estadual SEFAZ-GO', link: 'https://www.sefaz.go.gov.br', obrigatorio: true },
      { item: 'Emitir CND Municipal Prefeitura de Anápolis', link: 'https://www.anapolis.go.gov.br', obrigatorio: true },
      { item: 'Emitir CND Trabalhista (TST)', link: 'https://www.tst.jus.br/certidao', obrigatorio: true },
      { item: 'Verificar FGTS (Caixa Econômica)', link: 'https://www.caixa.gov.br', obrigatorio: true },
      { item: 'Pesquisar marcas e patentes (INPI)', link: 'https://busca.inpi.gov.br', obrigatorio: false },
      { item: 'Verificar contratos públicos (Portal da Transparência)', link: 'https://portaldatransparencia.gov.br', obrigatorio: false },
      { item: 'Confirmar Dossiê PF de cada sócio individualmente', link: '', obrigatorio: true },
    ],
    analise_devedor: [
      { item: 'Verificar Serasa Score do devedor', link: 'https://www.serasaexperian.com.br', obrigatorio: false },
      { item: 'Confirmar endereço para citação no JusBrasil', link: dadosAutomaticos?.processos?.link_jusbrasil || '#', obrigatorio: true },
      { item: 'Verificar protestos no Cartório de Anápolis', link: 'https://www.protestodigital.com.br', obrigatorio: false },
      { item: 'Confirmar veículos no DETRAN-GO', link: 'https://www.detran.go.gov.br', obrigatorio: false },
    ],
    investigacao_patrimonial: [
      { item: 'Consultar Cartório de Registro de Imóveis de Anápolis (matrículas)', link: 'https://www.registrodeimoveis.org.br', obrigatorio: true },
      { item: 'Consultar DETRAN-GO (veículos)', link: 'https://www.detran.go.gov.br', obrigatorio: true },
      { item: 'Verificar RENAJUD (restrições judiciais em veículos)', link: 'https://www.cnj.jus.br/sistemas/renajud/', obrigatorio: false },
      { item: 'Verificar BACENJUD/SISBAJUD (bloqueio de contas)', link: 'https://www.cnj.jus.br/sistemas/sisbajud/', obrigatorio: false },
      { item: 'Pesquisar todas as empresas vinculadas no Escavador', link: 'https://www.escavador.com', obrigatorio: true },
      { item: 'Confirmar possíveis laranjas — pesquisar família no JusBrasil', link: dadosAutomaticos?.processos?.link_jusbrasil || '#', obrigatorio: false },
    ],
  };
  return checklists[tipo] || [];
}

module.exports = { PRODUTOS, calcularScore, gerarChecklist };
