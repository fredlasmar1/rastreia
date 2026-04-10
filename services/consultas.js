const axios = require('axios');

// ─────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────

function limparDoc(doc) { return doc.replace(/\D/g, ''); }
function formatarCPF(cpf) { return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'); }
function formatarCNPJ(cnpj) { return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'); }

// ─────────────────────────────────────────────
// 1. CNPJ — CNPJá (grátis) com fallback CNPJ.ws
// ─────────────────────────────────────────────

async function consultarCNPJ(cnpj) {
  const doc = limparDoc(cnpj);
  try {
    const headers = process.env.CNPJA_API_KEY ? { Authorization: process.env.CNPJA_API_KEY } : {};
    const res = await axios.get(`https://api.cnpja.com/office/${doc}`, { headers, timeout: 12000 });
    const d = res.data;
    const company = d.company || {};
    const address = d.address || {};
    return {
      cnpj: doc,
      cnpj_formatado: formatarCNPJ(doc),
      razao_social: company.name || '',
      nome_fantasia: d.alias || '',
      situacao: d.status?.text || '',
      data_abertura: d.founded || '',
      porte: company.size?.text || '',
      natureza_juridica: company.nature?.text || '',
      capital_social: company.equity || 0,
      atividade_principal: d.mainActivity?.text || '',
      atividades_secundarias: (d.sideActivities || []).map(a => a.text).slice(0, 3),
      simples_nacional: d.taxRegime?.simples ? 'Optante' : 'Não optante',
      regime_tributario: d.taxRegime?.text || 'Não informado',
      endereco: address.street ? `${address.street}, ${address.number || 'S/N'} ${address.complement || ''} - ${address.district || ''}, ${address.city || ''} / ${address.state || ''} - CEP: ${address.zip || ''}` : 'Não informado',
      email: (d.emails || [])[0]?.address || '',
      telefone: (d.phones || [])[0] ? `(${d.phones[0].area}) ${d.phones[0].number}` : '',
      socios: (company.members || []).map(s => ({
        nome: s.person?.name || s.name || '',
        qualificacao: s.role?.text || '',
        desde: s.since || ''
      })),
      fonte: 'Receita Federal via CNPJá',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    return await consultarCNPJFallback(doc);
  }
}

async function consultarCNPJFallback(doc) {
  try {
    const res = await axios.get(`https://publica.cnpj.ws/cnpj/${doc}`, { timeout: 10000 });
    const d = res.data;
    const est = d.estabelecimento || {};
    return {
      cnpj: doc,
      cnpj_formatado: formatarCNPJ(doc),
      razao_social: d.razao_social || '',
      nome_fantasia: est.nome_fantasia || '',
      situacao: est.situacao_cadastral?.descricao || '',
      data_abertura: est.data_inicio_atividade || '',
      porte: d.porte?.descricao || '',
      natureza_juridica: d.natureza_juridica?.descricao || '',
      capital_social: d.capital_social || 0,
      atividade_principal: est.atividade_principal?.descricao || '',
      endereco: est.logradouro ? `${est.logradouro}, ${est.numero || 'S/N'} - ${est.municipio?.nome || ''} / ${est.estado?.sigla || ''}` : 'Não informado',
      email: est.email || '',
      telefone: est.ddd1 ? `(${est.ddd1}) ${est.telefone1}` : '',
      socios: (d.socios || []).map(s => ({ nome: s.nome || '', qualificacao: s.qualificacao_socio?.descricao || '', desde: s.data_entrada || '' })),
      fonte: 'Receita Federal via CNPJ.ws (fallback)',
      consultado_em: new Date().toISOString()
    };
  } catch (e2) {
    return { erro: 'CNPJ não encontrado em nenhuma fonte', cnpj: doc };
  }
}

// ─────────────────────────────────────────────
// 2. CPF — Direct Data
// Cadastro em: https://app.directd.com.br (R$50 grátis)
// Env: DIRECTD_TOKEN
// ─────────────────────────────────────────────

async function consultarCPF(cpf) {
  const doc = limparDoc(cpf);
  if (!process.env.DIRECTD_TOKEN) {
    return {
      cpf: doc,
      cpf_formatado: formatarCPF(doc),
      aviso: 'Direct Data não configurada.',
      instrucao: 'Criar conta em https://app.directd.com.br (R$50 grátis para testar)',
      fonte: 'Não configurada',
      consultado_em: new Date().toISOString()
    };
  }
  try {
    const res = await axios.get('https://apiv3.directd.com.br/api/CadastroPessoaFisicaPlus', {
      params: { Cpf: doc, Token: process.env.DIRECTD_TOKEN },
      timeout: 15000
    });
    const r = res.data?.retorno || {};
    return {
      cpf: doc,
      cpf_formatado: formatarCPF(doc),
      nome: r.nome || '',
      sexo: r.sexo || '',
      data_nascimento: r.dataNascimento || '',
      idade: r.idade || null,
      nome_mae: r.nomeMae || '',
      nome_pai: r.nomePai || '',
      situacao_rf: r.situacaoCadastral || '',
      obito: r.possuiObito || false,
      classe_social: r.classeSocial || '',
      renda_estimada: r.rendaEstimada || '',
      faixa_salarial: r.rendaFaixaSalarial || '',
      telefones: (r.telefones || []).slice(0, 5).map(t => ({
        numero: t.telefoneComDDD || '',
        tipo: t.tipoTelefone || '',
        operadora: t.operadora || '',
        whatsapp: t.whatsApp || false
      })),
      enderecos: (r.enderecos || []).slice(0, 3).map(e => ({
        logradouro: e.logradouro || '',
        numero: e.numero || '',
        bairro: e.bairro || '',
        cidade: e.cidade || '',
        uf: e.uf || '',
        cep: e.cep || ''
      })),
      emails: (r.emails || []).slice(0, 3).map(e => e.enderecoEmail || e),
      fonte: 'Direct Data',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    return {
      cpf: doc,
      cpf_formatado: formatarCPF(doc),
      erro: 'Falha na consulta Direct Data',
      detalhes: e.response?.data?.mensagem || e.message,
      consultado_em: new Date().toISOString()
    };
  }
}

// ─────────────────────────────────────────────
// 3. PROCESSOS — Escavador (pago) + Datajud CNJ (grátis)
// Escavador: api.escavador.com | Env: ESCAVADOR_API_KEY
// Datajud: api-publica.datajud.cnj.jus.br | gratuito
// ─────────────────────────────────────────────

async function consultarProcessos(documento, tipo, nome) {
  const doc = limparDoc(documento);
  if (process.env.ESCAVADOR_API_KEY) {
    const r = await consultarEscavador(doc, tipo, nome);
    if (!r.erro) return r;
  }
  return await consultarDatajud(doc, tipo, nome);
}

async function consultarEscavador(doc, tipo, nome) {
  try {
    const res = await axios.get(
      `https://api.escavador.com/api/v2/envolvido/processos?cpf_cnpj=${doc}`,
      {
        headers: { Authorization: `Bearer ${process.env.ESCAVADOR_API_KEY}` },
        timeout: 20000
      }
    );
    const items = res.data?.items || [];
    return {
      total: res.data?.meta?.total || items.length,
      processos: items.slice(0, 30).map(p => ({
        numero: p.numero_cnj || '',
        tribunal: p.fontes?.[0]?.nome || p.tribunal?.sigla || '',
        classe: p.classe?.nome || '',
        assunto: p.assuntos?.[0]?.nome || '',
        polo_ativo: p.titulo_polo_ativo || '',
        polo_passivo: p.titulo_polo_passivo || '',
        data_inicio: p.data_inicio || '',
        ultima_movimentacao: p.data_ultima_movimentacao || '',
        valor_causa: p.valor_causa ? `R$ ${Number(p.valor_causa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null
      })),
      link_jusbrasil: gerarLinkJusBrasil(nome, doc),
      fonte: 'Escavador',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    return { erro: 'Escavador indisponível', detalhes: e.response?.data?.message || e.message, processos: [] };
  }
}

async function consultarDatajud(doc, tipo, nome) {
  const API_KEY = process.env.DATAJUD_API_KEY;
  if (!API_KEY) {
    return { total: 0, processos: [], link_jusbrasil: gerarLinkJusBrasil(nome, doc), fonte: 'Datajud CNJ', nota: 'Configure DATAJUD_API_KEY para consultar processos via Datajud.', consultado_em: new Date().toISOString() };
  }
  const headers = { Authorization: `ApiKey ${API_KEY}`, 'Content-Type': 'application/json' };

  const query = {
    query: {
      bool: {
        should: [
          { match: { 'partes.cpfCnpj': doc } },
          ...(nome ? [{ match: { 'partes.nome': nome } }] : [])
        ],
        minimum_should_match: 1
      }
    },
    size: 10,
    sort: [{ dataAjuizamento: { order: 'desc' } }]
  };

  // Prioriza TJGO (Goiás) + TRF1 (região de Anápolis) + STJ
  const tribunais = ['tjgo', 'trf1', 'stj', 'tst'];

  const respostas = await Promise.allSettled(
    tribunais.map(t =>
      axios.post(
        `https://api-publica.datajud.cnj.jus.br/api_publica_${t}/_search`,
        query,
        { headers, timeout: 12000 }
      )
    )
  );

  const processos = [];
  respostas.forEach(r => {
    if (r.status === 'fulfilled') {
      const hits = r.value.data?.hits?.hits || [];
      hits.forEach(h => {
        const s = h._source || {};
        processos.push({
          numero: s.numeroProcesso || '',
          tribunal: s.tribunal || '',
          classe: s.classe?.nome || '',
          assunto: s.assuntos?.[0]?.nome || '',
          polo_ativo: (s.partes || []).filter(p => p.polo === 'ATIVO').map(p => p.nome).join(', '),
          polo_passivo: (s.partes || []).filter(p => p.polo === 'PASSIVO').map(p => p.nome).join(', '),
          data_inicio: s.dataAjuizamento || '',
          ultima_movimentacao: s.dataUltimaAtualizacao || '',
          valor_causa: s.valorCausa ? `R$ ${Number(s.valorCausa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null
        });
      });
    }
  });

  return {
    total: processos.length,
    processos: processos.slice(0, 30),
    link_jusbrasil: gerarLinkJusBrasil(nome, doc),
    nota: processos.length === 0 ? 'Verificar manualmente no JusBrasil pelo link abaixo.' : null,
    fonte: 'Datajud CNJ (gratuito — TJGO + TRF1 + STJ + TST)',
    consultado_em: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────
// 4. PORTAL DA TRANSPARÊNCIA — gratuito
// ─────────────────────────────────────────────

async function consultarTransparencia(documento, nome) {
  const doc = limparDoc(documento);
  if (!process.env.TRANSPARENCIA_TOKEN) {
    return {
      disponivel: false,
      nota: 'Configure TRANSPARENCIA_TOKEN. Token gratuito em: https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email',
      fonte: 'Portal da Transparência (CGU)'
    };
  }
  try {
    const headers = { 'chave-api-dados': process.env.TRANSPARENCIA_TOKEN };
    const [ceis, cnep] = await Promise.allSettled([
      axios.get('https://api.portaldatransparencia.gov.br/api-de-dados/ceis', { params: { cnpjCpf: doc, pagina: 1 }, headers, timeout: 10000 }),
      axios.get('https://api.portaldatransparencia.gov.br/api-de-dados/cnep', { params: { cnpjCpf: doc, pagina: 1 }, headers, timeout: 10000 })
    ]);
    const ceis_data = ceis.status === 'fulfilled' ? ceis.value.data || [] : [];
    const cnep_data = cnep.status === 'fulfilled' ? cnep.value.data || [] : [];
    return {
      em_lista_negra: ceis_data.length > 0 || cnep_data.length > 0,
      ceis: ceis_data.slice(0, 5).map(r => ({
        tipo: 'CEIS - Empresa Inidônea/Suspensa',
        orgao: r.orgaoSancionador?.nome || '',
        sancao: r.tipoSancao?.descricao || '',
        inicio: r.dataInicioSancao || '',
        fim: r.dataFimSancao || ''
      })),
      cnep: cnep_data.slice(0, 5).map(r => ({
        tipo: 'CNEP - Empresa Punida',
        orgao: r.orgaoSancionador?.nome || '',
        sancao: r.tipoSancao?.descricao || '',
        valor_multa: r.valorMulta || null
      })),
      fonte: 'Portal da Transparência (CGU)',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    return { disponivel: false, erro: e.message, fonte: 'Portal da Transparência' };
  }
}

// ─────────────────────────────────────────────
// 5. SERASA — requer contrato empresarial (placeholder)
// ─────────────────────────────────────────────

async function consultarSerasa(documento) {
  if (!process.env.SERASA_API_KEY) {
    return {
      disponivel: false,
      nota: 'Integração Serasa requer contrato empresarial.',
      instrucao: 'Contratar em: https://www.serasaexperian.com.br/solucoes/api/',
      alternativa: 'Boa Vista SCPC também disponível: https://developers.boavistascpc.com.br',
      fonte: 'Serasa Experian'
    };
  }
  return { disponivel: false, nota: 'Em implementação.' };
}

// ─────────────────────────────────────────────
// 6. ONR — RI Digital (matrícula de imóveis)
// Docs: integracao.registrodeimoveis.org.br
// ─────────────────────────────────────────────

async function consultarONR(cpf, estado = 'GO') {
  if (!process.env.ONR_API_KEY) {
    return {
      disponivel: false,
      nota: 'ONR RI Digital não configurado. Consulta manual em: registradores.onr.org.br',
      link: 'https://registradores.onr.org.br',
      fonte: 'ONR RI Digital'
    };
  }
  try {
    const res = await axios.get('https://integracao.registrodeimoveis.org.br/api/v1/imoveis/buscar', {
      params: { cpf: limparDoc(cpf), estado },
      headers: { Authorization: `Bearer ${process.env.ONR_API_KEY}` },
      timeout: 20000
    });
    const imoveis = res.data?.imoveis || [];
    return {
      total: imoveis.length,
      imoveis: imoveis.slice(0, 20).map(i => ({
        matricula: i.matricula || '',
        cartorio: i.cartorio || '',
        endereco: i.endereco || '',
        tipo: i.tipo || '',
        valor_estimado: i.valor_estimado || null,
        proprietarios: i.proprietarios || [],
        onus: i.onus || []
      })),
      fonte: 'ONR RI Digital',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    return { disponivel: false, erro: 'ONR indisponível', detalhes: e.response?.data?.message || e.message, fonte: 'ONR RI Digital' };
  }
}

async function consultarMatricula(matricula, estado = 'GO') {
  if (!process.env.ONR_API_KEY) {
    return {
      disponivel: false,
      nota: 'ONR RI Digital não configurado.',
      link: 'https://registradores.onr.org.br',
      matricula,
      fonte: 'ONR RI Digital'
    };
  }
  try {
    const res = await axios.get('https://integracao.registrodeimoveis.org.br/api/v1/matricula', {
      params: { numero: matricula, estado },
      headers: { Authorization: `Bearer ${process.env.ONR_API_KEY}` },
      timeout: 20000
    });
    return {
      ...res.data,
      fonte: 'ONR RI Digital',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    return { disponivel: false, erro: 'Matrícula não encontrada', detalhes: e.message, matricula, fonte: 'ONR RI Digital' };
  }
}

// ─────────────────────────────────────────────
// 7. VEÍCULOS — Infosimples (DETRAN-GO)
// Docs: infosimples.com
// ─────────────────────────────────────────────

async function consultarVeiculos(cpf) {
  if (!process.env.INFOSIMPLES_TOKEN) {
    return {
      disponivel: false,
      nota: 'Infosimples não configurado. Consulta manual em: detran.go.gov.br',
      link: 'https://www.detran.go.gov.br',
      fonte: 'Infosimples DETRAN-GO'
    };
  }
  try {
    const res = await axios.post('https://api.infosimples.com/api/v2/consultas/detran/go/veiculos', {
      cpf: limparDoc(cpf),
      token: process.env.INFOSIMPLES_TOKEN,
      timeout: 600
    }, { timeout: 30000 });
    const data = res.data?.data?.[0] || {};
    const veiculos = data.veiculos || [];
    return {
      total: veiculos.length,
      veiculos: veiculos.slice(0, 20).map(v => ({
        placa: v.placa || '',
        modelo: v.modelo || '',
        marca: v.marca || '',
        ano: v.ano || '',
        chassi: v.chassi || '',
        cor: v.cor || '',
        situacao: v.situacao || '',
        restricoes: v.restricoes || []
      })),
      fonte: 'Infosimples DETRAN-GO',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    return { disponivel: false, erro: 'Infosimples indisponível', detalhes: e.response?.data?.message || e.message, fonte: 'Infosimples DETRAN-GO' };
  }
}

// ─────────────────────────────────────────────
// 8. LINK JUSBRASIL (consulta manual)
// ─────────────────────────────────────────────

function gerarLinkJusBrasil(nome, documento) {
  const query = encodeURIComponent(nome || documento);
  return `https://www.jusbrasil.com.br/consulta-processual/busca?q=${query}`;
}

// ─────────────────────────────────────────────
// ORQUESTRADOR — executa tudo em paralelo
// ─────────────────────────────────────────────

async function executarConsultaCompleta(pedido) {
  const { alvo_documento, alvo_tipo, alvo_nome, tipo } = pedido;

  // Consultas comuns a todos os produtos
  const promises = [
    alvo_tipo === 'PJ' ? consultarCNPJ(alvo_documento) : consultarCPF(alvo_documento),
    consultarProcessos(alvo_documento, alvo_tipo, alvo_nome),
    alvo_tipo === 'PJ' ? consultarTransparencia(alvo_documento, alvo_nome) : Promise.resolve(null),
    consultarSerasa(alvo_documento)
  ];

  // Consultas extras para Investigação Patrimonial e Due Diligence Imobiliária
  const precisaImoveis = ['investigacao_patrimonial', 'due_diligence_imobiliaria'].includes(tipo);
  const precisaVeiculos = ['investigacao_patrimonial', 'due_diligence_imobiliaria'].includes(tipo);

  if (precisaImoveis) promises.push(consultarONR(alvo_documento, 'GO'));
  if (precisaVeiculos) promises.push(consultarVeiculos(alvo_documento));

  const resultados = await Promise.all(promises);
  const [cadastral, processos, transparencia, serasa] = resultados;
  let idx = 4;
  const imoveis = precisaImoveis ? resultados[idx++] : null;
  const veiculos = precisaVeiculos ? resultados[idx++] : null;

  // Para Due Diligence Imobiliária: consultar também o segundo alvo (vendedor) e a matrícula
  let cadastral2 = null, processos2 = null, matricula = null;
  if (tipo === 'due_diligence_imobiliaria' && pedido.alvo2_documento) {
    const [c2, p2] = await Promise.all([
      pedido.alvo2_tipo === 'PJ' ? consultarCNPJ(pedido.alvo2_documento) : consultarCPF(pedido.alvo2_documento),
      consultarProcessos(pedido.alvo2_documento, pedido.alvo2_tipo, pedido.alvo2_nome)
    ]);
    cadastral2 = c2;
    processos2 = p2;
  }
  if (tipo === 'due_diligence_imobiliaria' && pedido.imovel_matricula) {
    matricula = await consultarMatricula(pedido.imovel_matricula, pedido.imovel_estado || 'GO');
  }

  return {
    receita_federal: cadastral,
    processos,
    ...(transparencia ? { transparencia } : {}),
    serasa,
    ...(imoveis ? { imoveis } : {}),
    ...(veiculos ? { veiculos } : {}),
    ...(cadastral2 ? { receita_federal_2: cadastral2 } : {}),
    ...(processos2 ? { processos_2: processos2 } : {}),
    ...(matricula ? { matricula } : {})
  };
}

module.exports = {
  consultarCNPJ,
  consultarCPF,
  consultarProcessos,
  consultarEscavador,
  consultarDatajud,
  consultarTransparencia,
  consultarSerasa,
  consultarONR,
  consultarMatricula,
  consultarVeiculos,
  gerarLinkJusBrasil,
  executarConsultaCompleta
};
