/**
 * RASTREIA — Definição dos Produtos
 *
 * Para cada produto: o que entrega, para quem, por que compra,
 * quais dados são críticos, e como calcular o score de risco.
 */

const PRODUTOS = {

  dossie_pf: {
    nome: 'Dossiê Pessoa Física',
    preco: 197,
    prazo_horas: 2,
    icone: '👤',
    publico_alvo: [
      'Empresário que vai vender a prazo para pessoa física',
      'Proprietário que vai alugar imóvel para inquilino',
      'Empresa que vai contratar prestador de serviço PF',
      'Quem vai firmar sociedade com pessoa física',
      'Quem vai emprestar dinheiro para alguém',
    ],
    argumento: 'Antes de assinar qualquer contrato com uma pessoa física, você precisa saber: ela tem processos como réu? Está com nome sujo? Existe patrimônio que garanta a dívida? Em 2 horas você tem a resposta.',
    dados_entregues: [
      { secao: 'IDENTIFICAÇÃO', campos: ['Nome completo', 'CPF', 'Data de nascimento', 'Idade', 'Sexo', 'Nome da mãe', 'Nome do pai', 'Situação cadastral na Receita Federal', 'Flag de óbito'] },
      { secao: 'CONTATOS E LOCALIZAÇÃO', campos: ['Endereços (até 3 mais recentes)', 'Telefones com operadora e flag WhatsApp', 'Emails cadastrados', 'CEP e bairro'] },
      { secao: 'PERFIL ECONÔMICO', campos: ['Classe social estimada', 'Faixa de renda estimada', 'Ocupação (CBO)'] },
      { secao: 'PROCESSOS JUDICIAIS', campos: ['Total de processos como réu', 'Total como autor', 'Processos trabalhistas', 'Processos cíveis', 'Execuções', 'Valor total das causas', 'Tribunais envolvidos (TJGO, TRF1, STJ)'] },
      { secao: 'RESTRIÇÕES E NEGATIVAÇÕES', campos: ['Situação Serasa (quando disponível)', 'Protestos em cartório', 'Inscrições em dívida ativa', 'Cheques sem fundo (quando disponível)'] },
      { secao: 'LISTAS NEGRAS', campos: ['CEIS - Lista de inidôneos federais', 'CNEP - Empresas punidas (se tiver PJ vinculada)'] },
      { secao: 'SCORE E PARECER', campos: ['Score de risco (0-100)', 'Classificação: BAIXO / MÉDIO / ALTO / CRÍTICO', 'Recomendação do analista', 'Pontos de atenção'] },
    ],
    fatores_score: [
      { fator: 'processos_como_reu', peso: 30 },
      { fator: 'execucoes_ativas', peso: 25 },
      { fator: 'situacao_rf', peso: 20 },
      { fator: 'negativacoes', peso: 15 },
      { fator: 'protestos', peso: 10 },
    ],
  },

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

  due_diligence_imobiliaria: {
    nome: 'Due Diligence Imobiliária',
    preco: 997,
    prazo_horas: 24,
    icone: '🏠',
    alvos_multiplos: true,
    publico_alvo: [
      'Comprador de imóvel antes de assinar contrato',
      'Imobiliária que intermedia vendas',
      'Advogado que faz contrato de compra e venda',
      'Quem vai financiar imóvel',
      'Quem vai investir em imóvel comercial',
    ],
    argumento: 'Antes de assinar o contrato de compra e venda, descubra: o comprador tem crédito? O vendedor tem penhora no imóvel? O imóvel está com a matrícula limpa? Em 24h entregamos análise completa dos 3 elementos da transação.',
    dados_entregues: [
      { secao: 'COMPRADOR', campos: ['Dossiê PF completo', 'Score de crédito', 'Processos como réu', 'Capacidade de pagamento estimada', 'Endereços e telefones'] },
      { secao: 'VENDEDOR', campos: ['Dossiê PF completo', 'Processos de execução ativos', 'Penhoras registradas', 'Situação fiscal', 'Outros imóveis vinculados'] },
      { secao: 'IMÓVEL', campos: ['Situação da matrícula no cartório', 'Ônus e gravames (hipoteca, alienação fiduciária)', 'Histórico de transferências', 'Pesquisa de bens vinculados ao CPF do vendedor'] },
      { secao: 'PARECER FINAL', campos: ['Recomendação: PROSSEGUIR / COM RESSALVAS / NÃO PROSSEGUIR', 'Cláusulas contratuais sugeridas', 'Documentos a exigir antes da assinatura'] },
    ],
    fatores_score: [
      { fator: 'matricula_limpa', peso: 35 },
      { fator: 'capacidade_pagamento_comprador', peso: 25 },
      { fator: 'execucoes_vendedor', peso: 25 },
      { fator: 'historico_transferencias', peso: 15 },
    ],
  },

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

  consulta_restricoes: {
    nome: 'Consulta de Restrições no CPF',
    preco: 19,
    prazo_horas: 0.25,
    icone: '🚦',
    publico_alvo: [
      'Quem precisa apenas conferir se um CPF/CNPJ está negativado',
      'Triagem rápida antes de iniciar uma negociação',
      'Cobrança que quer saber se vale enviar carta/SMS',
      'Vendedor que quer pré-checar cliente antes de fechar',
    ],
    argumento: 'Versão light e barata: em poucos minutos verificamos se o CPF/CNPJ tem protestos, negativações e qual o score de crédito (QUOD). Sem processos, sem patrimônio — apenas restrições financeiras.',
    dados_entregues: [
      { secao: 'IDENTIFICAÇÃO', campos: ['Nome/Razão Social', 'CPF/CNPJ', 'Situação na Receita Federal'] },
      { secao: 'RESTRIÇÕES', campos: ['Score QUOD (0-1000) com faixa', 'Protestos em cartório', 'Negativações (SCPC/Serasa via Direct Data)', 'Cheques sem fundo (quando disponível)'] },
      { secao: 'PARECER', campos: ['Status: SEM RESTRIÇÕES / COM RESTRIÇÕES', 'Total de pendências em R$', 'Resumo dos cartórios e credores'] },
    ],
    fatores_score: [],
  },

  consulta_veicular: {
    nome: 'Consulta Veicular',
    preco: 97,
    prazo_horas: 0.5,
    icone: '🚗',
    sem_alvo_documento: true,
    // Tiers comerciais (catálogo Credify). Admin pode ajustar o preço final por pedido.
    // O campo `preco` acima continua sendo o piso do Completo (tier padrão).
    tiers: {
      basico:   { preco: 47,  servicos: 5,  descricao: 'Checagem rápida pré-compra' },
      completo: { preco: 97,  servicos: 9,  descricao: 'Dossiê completo com histórico', padrao: true },
      premium:  { preco: 147, servicos: 11, descricao: 'Completo + leilão + chassi decodificado' }
    },
    addons: {
      leilao:             { preco: 29, descricao: 'Consulta em bases de leilão' },
      cnh_proprietario:   { preco: 15, descricao: 'Validação da CNH do proprietário' },
      veiculos_por_cpf:   { preco: 19, descricao: 'Outros veículos do proprietário' }
    },
    publico_alvo: [
      'Comprador de veículo usado antes de fechar negócio',
      'Quem vai receber veículo como pagamento ou garantia',
      'Locadora verificando situação de veículo',
      'Credor pesquisando veículos de devedor por placa específica',
      'Mecânica, revenda, leiloéiro validando procedencia',
    ],
    argumento: 'Antes de comprar um veículo usado ou aceitar como pagamento, descubra em 30 minutos: há restrições? Alienacao fiduciária? Roubo/furto? Qual o valor FIPE real? Basta a placa.',
    dados_entregues: [
      { secao: 'IDENTIFICAÇÃO DO VEÍCULO', campos: ['Placa', 'Marca e modelo', 'Ano de fabricação e modelo', 'Cor', 'Combustível', 'Chassi', 'Renavam', 'Município e UF de registro'] },
      { secao: 'SITUAÇÃO E RESTRIÇÕES', campos: ['Situação atual do veículo', 'Restrições administrativas', 'Alienação fiduciária', 'Restrições judiciais', 'Roubo/furto'] },
      { secao: 'AVALIAÇÃO FIPE', campos: ['Valor FIPE atualizado', 'Código FIPE', 'Mês de referência'] },
    ],
    fatores_score: [],
  },
};

// ─────────────────────────────────────────────────────────
// CALCULADORA DE SCORE DE RISCO
// ─────────────────────────────────────────────────────────

// Helper: dias entre data ISO/string e hoje
function diasDesde(dataStr) {
  if (!dataStr) return null;
  try {
    const d = new Date(dataStr);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  } catch { return null; }
}

function calcularScore(tipo, dados) {
  if (!dados) dados = {};
  const alertas = [];
  const contribuicoes = []; // dimensão, delta, motivo - para transparência

  const processos = dados.processos || {};
  const cadastral = dados.receita_federal || {};
  const transparencia = dados.transparencia || {};
  const scoreQuod = dados.score_credito || {};
  const negativacoes = dados.negativacoes || {};

  // Verificar se temos dados suficientes para calcular score
  const temDadosCadastrais = cadastral.nome || cadastral.razao_social;
  const temDadosProcessos = processos.fonte && !processos.erro;
  const fontesConsultadas = (temDadosCadastrais ? 1 : 0) + (temDadosProcessos ? 1 : 0) + (transparencia.em_lista_negra !== undefined ? 1 : 0);

  if (fontesConsultadas === 0) {
    alertas.push({ texto: 'Nenhuma fonte de dados retornou informações — score não calculado', severidade: 'critico' });
    alertas.push({ texto: 'Verifique se as APIs estão configuradas (DIRECTD_TOKEN, ESCAVADOR_API_KEY)', severidade: 'observar' });
    return {
      score: '-',
      classificacao: 'INDISPONÍVEL',
      cor: 'cinza',
      recomendacao: 'Não foi possível calcular o score de risco porque nenhuma fonte de dados retornou informações. Configure as APIs necessárias e refaça a consulta.',
      alertas,
      contribuicoes,
      versao: 'v2'
    };
  }

  let score = 100;
  // alertas agora podem ser strings (compat) ou objetos { texto, severidade }
  // severidade: 'critico' | 'atencao' | 'observar' | 'positivo'
  const alertar = (texto, severidade) => {
    alertas.push({ texto, severidade: severidade || 'observar' });
  };
  const aplicar = (dim, delta, motivo) => {
    if (delta === 0) return;
    score += delta;
    contribuicoes.push({ dimensao: dim, delta, motivo });
  };

  // ============================================================
  // 1. DADOS CADASTRAIS INCOMPLETOS
  // ============================================================
  if (!temDadosCadastrais) {
    aplicar('Dados cadastrais', -15, 'Dados cadastrais indisponíveis');
    alertar('Dados cadastrais indisponíveis — score parcial', 'atencao');
  }
  if (cadastral.aviso || cadastral.erro) {
    aplicar('Dados cadastrais', -10, 'Retorno incompleto da API de dados cadastrais');
    alertar('API de dados cadastrais não retornou informações completas', 'observar');
  }

  // ============================================================
  // 2. SCORE QUOD (birô) — com peso reduzido quando há processos
  // ============================================================
  const processosAtivosArr = (processos.processos || []).filter(p => p.status === 'Ativo');
  const temSinalJudicial = processosAtivosArr.length > 0;

  if (scoreQuod.score) {
    const sq = Number(scoreQuod.score);
    // Pesos reduzidos quando há processos ativos (QUOD não capta sinal judicial)
    const reducao = temSinalJudicial ? 0.7 : 1.0;
    let penalQuod = 0;
    if (sq < 300) penalQuod = 30;
    else if (sq < 500) penalQuod = 20;
    else if (sq < 700) penalQuod = 10;
    else if (sq < 800) penalQuod = 3; // faixa 700-799 não é isenta
    penalQuod = Math.round(penalQuod * reducao);
    if (penalQuod > 0) {
      aplicar('QUOD', -penalQuod, `Score QUOD ${sq}/1000 (${scoreQuod.faixa || 'sem faixa'})${reducao < 1 ? ' - peso reduzido por sinal judicial' : ''}`);
      const sevQ = sq < 300 ? 'critico' : sq < 500 ? 'atencao' : 'observar';
      alertar(`Score QUOD: ${sq}/1000 — ${scoreQuod.faixa || ''}`, sevQ);
    } else if (sq >= 800) {
      alertar(`Score QUOD: ${sq}/1000 — ${scoreQuod.faixa || 'Excelente'}`, 'positivo');
    }
    if (scoreQuod.motivos?.length > 0) {
      scoreQuod.motivos.slice(0, 2).forEach(m => alertar(`QUOD: ${m}`, 'observar'));
    }
  }

  // ============================================================
  // 3. NEGATIVAÇÕES / PROTESTOS (Direct Data)
  // ============================================================
  if (negativacoes.total_pendencias > 0) {
    const valorPend = Number(negativacoes.total_pendencias);
    let penal = 10, sev = 'atencao';
    if (valorPend > 100000) { penal = 30; sev = 'critico'; }
    else if (valorPend > 10000) { penal = 20; sev = 'atencao'; }
    aplicar('Pendências', -penal, `Pendências R$ ${valorPend.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
    alertar(`Pendências financeiras: R$ ${valorPend.toLocaleString('pt-BR', {minimumFractionDigits:2})} — ${negativacoes.status || ''}`, sev);
  }

  // ============================================================
  // 4. PROCESSOS JUDICIAIS — com peso por recência
  // ============================================================
  const totalProcessos = processos.total || 0;
  const processosAtivos = processosAtivosArr.length;
  const processosInativos = totalProcessos - processosAtivos;

  if (processosAtivos > 0) {
    const penalBase = Math.min(processosAtivos * 6, 30);
    aplicar('Processos ativos', -penalBase, `${processosAtivos} processo(s) ativo(s)`);
    alertar(`${processosAtivos} processo(s) ativo(s) encontrado(s)`, processosAtivos >= 3 ? 'critico' : 'atencao');

    let recentes180 = 0;
    let recentes90 = 0;
    let maisRecenteDias = null;
    processosAtivosArr.forEach(p => {
      const dias = diasDesde(p.data_inicio);
      if (dias !== null && dias >= 0) {
        if (dias < 90) recentes90++;
        if (dias < 180) recentes180++;
        if (maisRecenteDias === null || dias < maisRecenteDias) maisRecenteDias = dias;
      }
    });
    if (recentes90 > 0) {
      aplicar('Recência judicial', -20, `${recentes90} processo(s) ativo(s) ajuizado(s) nos últimos 90 dias`);
      alertar(`${recentes90} processo(s) ajuizado(s) há menos de 90 dias`, 'critico');
    } else if (recentes180 > 0) {
      aplicar('Recência judicial', -12, `${recentes180} processo(s) ativo(s) ajuizado(s) nos últimos 180 dias`);
      alertar(`${recentes180} processo(s) ajuizado(s) há menos de 180 dias`, 'atencao');
    }
    if (maisRecenteDias !== null && maisRecenteDias < 60) {
      alertar(`Processo mais recente ajuizado há ${maisRecenteDias} dias`, 'critico');
    }
  }
  if (processosInativos > 0) {
    if (processosInativos >= 3) {
      aplicar('Histórico judicial', -5, `${processosInativos} processo(s) histórico(s) (recorrência)`);
      alertar(`Recorrência: ${processosInativos} processo(s) baixado(s)/arquivado(s) no histórico`, 'atencao');
    } else {
      alertar(`${processosInativos} processo(s) baixado(s)/arquivado(s) no histórico`, 'observar');
    }
  }

  // ============================================================
  // 5. LISTA NEGRA FEDERAL
  // ============================================================
  if (transparencia.em_lista_negra) {
    aplicar('Lista negra', -40, 'Consta em CEIS/CNEP');
    alertar('Empresa/Pessoa consta em lista negra federal (CEIS/CNEP)', 'critico');
  }

  // ============================================================
  // 6. SITUAÇÃO RECEITA FEDERAL
  // ============================================================
  const situacao = (cadastral.situacao || cadastral.situacao_rf || '').toLowerCase();
  if (situacao && !situacao.includes('ativ') && !situacao.includes('regular')) {
    aplicar('Situação RF', -25, `Irregular: ${situacao}`);
    alertar(`Situação irregular na Receita Federal: ${situacao}`, 'critico');
  }

  // ============================================================
  // 7. ÓBITO
  // ============================================================
  if (cadastral.obito === true) {
    aplicar('Óbito', -50, 'Registro de óbito no CPF');
    alertar('Registro de óbito encontrado para este CPF', 'critico');
  }

  // ============================================================
  // 8. EMPRESA NOVA/ANTIGA (PJ)
  // ============================================================
  if (cadastral.data_abertura) {
    const anos = new Date().getFullYear() - new Date(cadastral.data_abertura).getFullYear();
    if (anos >= 5) aplicar('Tempo de empresa', +5, `Empresa com ${anos} anos de existência`);
    if (anos < 1) {
      aplicar('Tempo de empresa', -10, 'Empresa com menos de 1 ano');
      alertar('Empresa com menos de 1 ano de existência', 'atencao');
    } else if (anos >= 5) {
      alertar(`Empresa consolidada (${anos} anos de existência)`, 'positivo');
    }
  }

  // ============================================================
  // 9. MULTIPLICIDADE CADASTRAL (antifraude)
  // ============================================================
  const telefones = Array.isArray(cadastral.telefones) ? cadastral.telefones : [];
  const enderecos = Array.isArray(cadastral.enderecos) ? cadastral.enderecos : [];
  if (telefones.length >= 5) {
    aplicar('Multiplicidade', -8, `${telefones.length} telefones cadastrados`);
    alertar(`Sinal antifraude: ${telefones.length} telefones cadastrados`, 'atencao');
  } else if (telefones.length >= 4) {
    aplicar('Multiplicidade', -4, `${telefones.length} telefones cadastrados`);
    alertar(`${telefones.length} telefones cadastrados`, 'observar');
  }
  if (enderecos.length >= 3) {
    aplicar('Multiplicidade', -6, `${enderecos.length} endereços cadastrados`);
    alertar(`Sinal antifraude: ${enderecos.length} endereços cadastrados`, 'atencao');
  }

  // ============================================================
  // 10. RENDA INCONSISTENTE
  // ============================================================
  if (cadastral.renda_inconsistente) {
    alertar(cadastral.renda_motivo_inconsistencia || 'Renda estimada inconsistente - desconsiderada', 'observar');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // ============================================================
  // BANDAS DE DECISÃO EXPLÍCITAS (v2)
  // 86-100 EXCELENTE / 71-85 BOM / 51-70 MODERADO / 31-50 ALTO / 0-30 CRÍTICO
  // ============================================================
  let classificacao, cor, recomendacao;
  if (score >= 86) {
    classificacao = 'BAIXO RISCO';
    cor = 'verde';
    recomendacao = 'Perfil favorável. Prosseguir com cautelas contratuais padrão.';
  } else if (score >= 71) {
    classificacao = 'RISCO BAIXO-MODERADO';
    cor = 'verde';
    recomendacao = 'Perfil aceitável com pontos pontuais de atenção. Documentar riscos no contrato.';
  } else if (score >= 51) {
    classificacao = 'RISCO MODERADO';
    cor = 'laranja';
    recomendacao = 'Existem pontos de atenção relevantes. Recomendamos exigir garantias antes de prosseguir.';
  } else if (score >= 31) {
    classificacao = 'ALTO RISCO';
    cor = 'vermelho';
    recomendacao = 'Perfil de risco elevado. Exigir garantias reais, avalista ou recusar a negociação.';
  } else {
    classificacao = 'RISCO CRÍTICO';
    cor = 'vermelho';
    recomendacao = 'Não recomendamos prosseguir sem análise jurídica especializada e garantias robustas.';
  }

  return { score, classificacao, cor, recomendacao, alertas, contribuicoes, versao: 'v2' };
}

// ─────────────────────────────────────────────────────────
// GERADOR DE CHECKLIST POR PRODUTO
// ─────────────────────────────────────────────────────────

function gerarChecklist(tipo, dadosAutomaticos) {
  const checklists = {
    dossie_pf: [
      { item: 'Consultar Serasa manualmente', link: 'https://www.serasaexperian.com.br', obrigatorio: false },
      { item: 'Verificar protestos no Cartório de Protesto de Anápolis', link: 'https://www.protestodigital.com.br', obrigatorio: false },
      { item: 'Confirmar endereço atual via Escavador/Datajud (verificação automática)', link: 'https://painel.escavador.com', obrigatorio: true },
      { item: 'Verificar se CPF consta no Cadastro de Inadimplentes do Município', link: '', obrigatorio: false },
    ],
    dossie_pj: [
      { item: 'Verificar Certidão Negativa Federal (PGFN)', link: 'https://solucoes.receita.fazenda.gov.br/servicos/certidaointernet/pj/emitir', obrigatorio: true },
      { item: 'Verificar SEFAZ-GO (situação estadual Goiás)', link: 'https://www.sefaz.go.gov.br', obrigatorio: true },
      { item: 'Verificar protestos no Cartório', link: 'https://www.protestodigital.com.br', obrigatorio: false },
      { item: 'Revisar detalhes dos processos no painel Escavador', link: 'https://painel.escavador.com', obrigatorio: true },
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
      { item: 'Confirmar endereço para citação via Receita Federal / Escavador', link: 'https://painel.escavador.com', obrigatorio: true },
      { item: 'Verificar protestos no Cartório de Anápolis', link: 'https://www.protestodigital.com.br', obrigatorio: false },
      { item: 'Confirmar veículos no DETRAN-GO', link: 'https://www.detran.go.gov.br', obrigatorio: false },
    ],
    investigacao_patrimonial: [
      { item: 'Consultar Cartório de Registro de Imóveis de Anápolis (matrículas)', link: 'https://www.registrodeimoveis.org.br', obrigatorio: true },
      { item: 'Consultar DETRAN-GO (veículos)', link: 'https://www.detran.go.gov.br', obrigatorio: true },
      { item: 'Verificar RENAJUD (restrições judiciais em veículos)', link: 'https://www.cnj.jus.br/sistemas/renajud/', obrigatorio: false },
      { item: 'Verificar BACENJUD/SISBAJUD (bloqueio de contas)', link: 'https://www.cnj.jus.br/sistemas/sisbajud/', obrigatorio: false },
      { item: 'Pesquisar todas as empresas vinculadas no Escavador', link: 'https://www.escavador.com', obrigatorio: true },
      { item: 'Confirmar possíveis laranjas — pesquisar vínculos familiares no Escavador', link: 'https://painel.escavador.com', obrigatorio: false },
    ],
  };
  checklists.due_diligence_imobiliaria = [
    { item: 'Consultar matrícula do imóvel no Cartório de Registro de Imóveis', link: 'https://registradores.onr.org.br', obrigatorio: true },
    { item: 'Verificar ônus e gravames na matrícula (hipoteca, alienação fiduciária)', link: '', obrigatorio: true },
    { item: 'Confirmar proprietário registrado na matrícula x vendedor', link: '', obrigatorio: true },
    { item: 'Verificar certidões negativas do vendedor (Federal, Estadual, Municipal)', link: 'https://solucoes.receita.fazenda.gov.br/servicos/certidaointernet/pf/emitir', obrigatorio: true },
    { item: 'Confirmar IPTU em dia e inexistência de débitos municipais', link: '', obrigatorio: true },
    { item: 'Verificar processos do vendedor no Escavador', link: 'https://painel.escavador.com', obrigatorio: true },
    { item: 'Solicitar parecer jurídico do Balladão Advogados', link: '', obrigatorio: true },
    { item: 'Verificar se imóvel está em área de proteção ambiental', link: '', obrigatorio: false },
    { item: 'Confirmar inexistência de inventário/usucapião sobre o imóvel', link: '', obrigatorio: false },
  ];

  return checklists[tipo] || [];
}

module.exports = { PRODUTOS, calcularScore, gerarChecklist };
