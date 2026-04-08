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
    return await consultarCNPJviaCpfCnpj(doc);
  }
}

// Fallback 1: CPF.CNPJ (pacote 6 — dados completos com sócios, tempo real)
async function consultarCNPJviaCpfCnpj(doc) {
  if (!process.env.CPFCNPJ_API_KEY) return await consultarCNPJFallback(doc);
  try {
    const res = await axios.get(
      `https://api.cpfcnpj.com.br/${process.env.CPFCNPJ_API_KEY}/6/${doc}`,
      { timeout: 60000 }
    );
    const d = res.data;
    if (d.status === 0) return await consultarCNPJFallback(doc);
    const addr = d.matrizEndereco || {};
    const sit = (d.situacao || [])[0] || {};
    const nat = (d.naturezaJuridica || [])[0] || {};
    const cnae = (d.cnae || [])[0] || {};
    const porte = (d.porte || [])[0] || {};
    const simples = (d.simplesNacional || [])[0] || {};
    return {
      cnpj: doc,
      cnpj_formatado: d.cnpj || formatarCNPJ(doc),
      razao_social: d.razao || '',
      nome_fantasia: d.fantasia || '',
      situacao: sit.nome || '',
      data_abertura: d.inicioAtividade || '',
      porte: porte.descricao || '',
      natureza_juridica: nat.descricao || '',
      capital_social: 0,
      atividade_principal: cnae.descricao || '',
      simples_nacional: simples.optante === 'Sim' ? 'Optante' : 'Não optante',
      endereco: addr.logradouro ? `${addr.tipo || ''} ${addr.logradouro}, ${addr.numero || 'S/N'} ${addr.complemento || ''} - ${addr.bairro || ''}, ${addr.cidade || ''} / ${addr.uf || ''} - CEP: ${addr.cep || ''}` : 'Não informado',
      email: d.email || '',
      telefone: (d.telefones || [])[0] ? `(${d.telefones[0].ddd}) ${d.telefones[0].numero}` : '',
      socios: (d.socios || []).map(s => ({
        nome: s.nome || '',
        qualificacao: s.qualificacao_socio?.descricao || '',
        desde: s.data_entrada || ''
      })),
      fonte: 'Receita Federal via CPF.CNPJ',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    return await consultarCNPJFallback(doc);
  }
}

// Fallback 2: CNPJ.ws (gratuito)
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
// 2. CPF — Direct Data com fallback CPF.CNPJ
// Direct Data: https://app.directd.com.br (R$50 grátis)
// CPF.CNPJ: https://www.cpfcnpj.com.br (R$0,53/consulta)
// Env: DIRECTD_TOKEN, CPFCNPJ_API_KEY
// ─────────────────────────────────────────────

async function consultarCPF(cpf) {
  const doc = limparDoc(cpf);
  if (process.env.DIRECTD_TOKEN) {
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
      // Direct Data falhou, tenta fallback CPF.CNPJ
      const fallback = await consultarCPFviaCpfCnpj(doc);
      if (!fallback.erro) return fallback;
    }
  }
  // Sem Direct Data ou falhou — tenta CPF.CNPJ
  return await consultarCPFviaCpfCnpj(doc);
}

async function consultarCPFviaCpfCnpj(doc) {
  if (!process.env.CPFCNPJ_API_KEY) {
    return {
      cpf: doc,
      cpf_formatado: formatarCPF(doc),
      aviso: 'Nenhuma API de CPF configurada.',
      instrucao: 'Configure DIRECTD_TOKEN ou CPFCNPJ_API_KEY no .env',
      fonte: 'Não configurada',
      consultado_em: new Date().toISOString()
    };
  }
  try {
    const res = await axios.get(
      `https://api.cpfcnpj.com.br/${process.env.CPFCNPJ_API_KEY}/9/${doc}`,
      { timeout: 60000 }
    );
    const d = res.data;
    if (d.status === 0) {
      return { cpf: doc, cpf_formatado: formatarCPF(doc), erro: d.mensagem || 'CPF não encontrado', fonte: 'CPF.CNPJ' };
    }
    return {
      cpf: doc,
      cpf_formatado: d.cpf || formatarCPF(doc),
      nome: d.nome || '',
      sexo: d.genero === 'M' ? 'Masculino' : d.genero === 'F' ? 'Feminino' : d.genero || '',
      data_nascimento: d.nascimento || '',
      nome_mae: d.mae || '',
      situacao_rf: d.situacao || '',
      telefones: (d.telefones || []).slice(0, 5).map(t => ({
        numero: t.ddd ? `(${t.ddd}) ${t.numero}` : t.numero || '',
        tipo: '',
        operadora: '',
        whatsapp: false
      })),
      enderecos: d.endereco ? [{
        logradouro: d.endereco || '',
        numero: d.numero || '',
        bairro: d.bairro || '',
        cidade: d.cidade || '',
        uf: d.uf || '',
        cep: d.cep || ''
      }] : [],
      emails: (d.emails || []).slice(0, 3),
      fonte: 'Receita Federal via CPF.CNPJ',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    return {
      cpf: doc,
      cpf_formatado: formatarCPF(doc),
      erro: 'Falha na consulta CPF.CNPJ',
      detalhes: e.response?.data?.mensagem || e.message,
      fonte: 'CPF.CNPJ',
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
  // API pública e gratuita do CNJ — cobre todos os tribunais do Brasil
  // Chave pública (rate limit generoso para uso B2B)
  const API_KEY = process.env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendFbzFmbkdqclY0OHFKcFk=';
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
// Token gratuito: https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email
// Env: TRANSPARENCIA_TOKEN
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
// 6. LINK JUSBRASIL (consulta manual)
// ─────────────────────────────────────────────

function gerarLinkJusBrasil(nome, documento) {
  const query = encodeURIComponent(nome || documento);
  return `https://www.jusbrasil.com.br/consulta-processual/busca?q=${query}`;
}

// ─────────────────────────────────────────────
// ORQUESTRADOR — executa tudo em paralelo
// ─────────────────────────────────────────────

async function executarConsultaCompleta(pedido) {
  const { alvo_documento, alvo_tipo, alvo_nome } = pedido;
  const [cadastral, processos, transparencia, serasa] = await Promise.all([
    alvo_tipo === 'PJ' ? consultarCNPJ(alvo_documento) : consultarCPF(alvo_documento),
    consultarProcessos(alvo_documento, alvo_tipo, alvo_nome),
    alvo_tipo === 'PJ' ? consultarTransparencia(alvo_documento, alvo_nome) : Promise.resolve(null),
    consultarSerasa(alvo_documento)
  ]);
  return {
    receita_federal: cadastral,
    processos,
    ...(transparencia ? { transparencia } : {}),
    serasa
  };
}

module.exports = {
  consultarCNPJ,
  consultarCNPJviaCpfCnpj,
  consultarCPF,
  consultarCPFviaCpfCnpj,
  consultarProcessos,
  consultarEscavador,
  consultarDatajud,
  consultarTransparencia,
  consultarSerasa,
  gerarLinkJusBrasil,
  executarConsultaCompleta
};
