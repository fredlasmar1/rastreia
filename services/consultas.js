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
    console.error(`[CNPJa] Erro: ${e.response?.status || e.message}`);
    // Tentar CPF.CNPJ como fallback
    if (process.env.CPFCNPJ_API_KEY) {
      try {
        const res2 = await axios.get(
          `https://api.cpfcnpj.com.br/${process.env.CPFCNPJ_API_KEY}/6/${doc}`,
          { timeout: 60000 }
        );
        const d = res2.data;
        if (d.status !== 0 && (d.razao || d.fantasia)) {
          const addr = d.matrizEndereco || {};
          return {
            cnpj: doc, cnpj_formatado: d.cnpj || formatarCNPJ(doc),
            razao_social: d.razao || '', nome_fantasia: d.fantasia || '',
            situacao: (d.situacao || [])[0]?.nome || '',
            data_abertura: d.inicioAtividade || '',
            porte: (d.porte || [])[0]?.descricao || '',
            natureza_juridica: (d.naturezaJuridica || [])[0]?.descricao || '',
            capital_social: 0,
            atividade_principal: (d.cnae || [])[0]?.descricao || '',
            simples_nacional: (d.simplesNacional || [])[0]?.optante === 'Sim' ? 'Optante' : 'Nao optante',
            endereco: addr.logradouro ? `${addr.tipo || ''} ${addr.logradouro}, ${addr.numero || 'S/N'} - ${addr.bairro || ''}, ${addr.cidade || ''} / ${addr.uf || ''}` : 'Nao informado',
            email: d.email || '',
            telefone: (d.telefones || [])[0] ? `(${d.telefones[0].ddd}) ${d.telefones[0].numero}` : '',
            socios: (d.socios || []).map(s => ({ nome: s.nome || '', qualificacao: s.qualificacao_socio?.descricao || '', desde: s.data_entrada || '' })),
            fonte: 'Receita Federal via CPF.CNPJ', consultado_em: new Date().toISOString()
          };
        }
      } catch (e2) {
        console.error(`[CPF.CNPJ CNPJ] Erro: ${e2.response?.status || e2.message}`);
      }
    }
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
// 2. CPF — Direct Data com fallback CPF.CNPJ
// Direct Data: https://app.directd.com.br | Env: DIRECTD_TOKEN
// CPF.CNPJ: https://www.cpfcnpj.com.br | Env: CPFCNPJ_API_KEY
// ─────────────────────────────────────────────

async function consultarCPF(cpf) {
  const doc = limparDoc(cpf);

  // Tentar Direct Data primeiro
  if (process.env.DIRECTD_TOKEN) {
    try {
      const res = await axios.get('https://apiv3.directd.com.br/api/CadastroPessoaFisicaPlus', {
        params: { Cpf: doc, Token: process.env.DIRECTD_TOKEN },
        timeout: 15000
      });
      const r = res.data?.retorno || {};
      console.log('[DirectData PF] Keys:', Object.keys(r).join(', '));
      console.log('[DirectData PF] sexo:', r.sexo, '| genero:', r.genero, '| situacao:', r.situacaoCadastral, '| situacaoRF:', r.situacaoReceitaFederal);
      if (r.nome) {
        // Mapear sexo corretamente
        let sexo = r.sexo || r.genero || '';
        if (sexo === 'M' || sexo === 'm') sexo = 'Masculino';
        else if (sexo === 'F' || sexo === 'f') sexo = 'Feminino';
        // Formatar data sem hora
        let dataNasc = r.dataNascimento || r.nascimento || '';
        if (dataNasc && dataNasc.includes(' ')) dataNasc = dataNasc.split(' ')[0];
        if (dataNasc && dataNasc.includes('T')) dataNasc = dataNasc.split('T')[0];
        // Formatar renda
        const renda = r.rendaEstimada || r.renda || '';
        const rendaFormatada = renda ? `R$ ${Number(renda).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : '';
        return {
          cpf: doc, cpf_formatado: formatarCPF(doc),
          nome: r.nome || '', sexo: sexo,
          data_nascimento: dataNasc, idade: r.idade || null,
          nome_mae: r.nomeMae || r.mae || '', nome_pai: r.nomePai || r.pai || '',
          situacao_rf: r.situacaoCadastral || r.situacaoReceitaFederal || r.situacao || '',
          obito: r.possuiObito || r.obito || false,
          classe_social: r.classeSocial || '', renda_estimada: rendaFormatada,
          faixa_salarial: r.rendaFaixaSalarial || '',
          profissao: r.cbo || r.codigoCBO || '',
          signo: r.signo || '',
          parentescos: (r.parentescos || []).slice(0, 10).map(p => ({
            nome: p.nome || '', cpf: p.cpf || '', tipo: p.tipoVinculo || p.parentesco || p.tipo || ''
          })),
          telefones: (r.telefones || []).slice(0, 5).map(t => ({
            numero: t.telefoneComDDD || '', tipo: t.tipoTelefone || '',
            operadora: t.operadora || '', whatsapp: t.whatsApp || false
          })),
          enderecos: (r.enderecos || []).slice(0, 3).map(e => ({
            logradouro: e.logradouro || '', numero: e.numero || '',
            bairro: e.bairro || '', cidade: e.cidade || '', uf: e.uf || '', cep: e.cep || ''
          })),
          emails: (r.emails || []).slice(0, 3).map(e => e.enderecoEmail || e),
          fonte: 'Direct Data', consultado_em: new Date().toISOString()
        };
      }
    } catch (e) {
      console.error(`[Direct Data] Erro: ${e.response?.status || e.message}`);
    }
  }

  // Fallback: CPF.CNPJ (pacote 9)
  if (process.env.CPFCNPJ_API_KEY) {
    try {
      const res = await axios.get(
        `https://api.cpfcnpj.com.br/${process.env.CPFCNPJ_API_KEY}/9/${doc}`,
        { timeout: 60000 }
      );
      const d = res.data;
      if (d.status !== 0 && d.nome) {
        return {
          cpf: doc, cpf_formatado: d.cpf || formatarCPF(doc),
          nome: d.nome || '',
          sexo: d.genero === 'M' ? 'Masculino' : d.genero === 'F' ? 'Feminino' : d.genero || '',
          data_nascimento: d.nascimento || '', nome_mae: d.mae || '',
          situacao_rf: d.situacao || '',
          telefones: (d.telefones || []).slice(0, 5).map(t => ({
            numero: t.ddd ? `(${t.ddd}) ${t.numero}` : t.numero || '',
            tipo: '', operadora: '', whatsapp: false
          })),
          enderecos: d.endereco ? [{
            logradouro: d.endereco || '', numero: d.numero || '',
            bairro: d.bairro || '', cidade: d.cidade || '', uf: d.uf || '', cep: d.cep || ''
          }] : [],
          emails: (d.emails || []).slice(0, 3),
          fonte: 'Receita Federal via CPF.CNPJ', consultado_em: new Date().toISOString()
        };
      }
    } catch (e) {
      console.error(`[CPF.CNPJ] Erro: ${e.response?.status || e.message}`);
    }
  }

  // Nenhuma API disponível ou todas falharam
  return {
    cpf: doc, cpf_formatado: formatarCPF(doc),
    aviso: 'Nenhuma API de CPF retornou dados.',
    instrucao: 'Verifique DIRECTD_TOKEN ou CPFCNPJ_API_KEY',
    fonte: 'Indisponivel', consultado_em: new Date().toISOString()
  };
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
// 6. SCORE DE CRÉDITO — Direct Data (substitui Serasa)
// Endpoint: /api/Score | R$ 1,98
// ─────────────────────────────────────────────

async function consultarScore(documento, tipo) {
  if (!process.env.DIRECTD_TOKEN) {
    return { disponivel: false, fonte: 'Direct Data Score' };
  }
  try {
    const doc = limparDoc(documento);
    const paramDoc = doc.length <= 11 ? { Cpf: doc } : { Cnpj: doc };
    const res = await axios.get('https://apiv3.directd.com.br/api/Score', {
      params: { ...paramDoc, Token: process.env.DIRECTD_TOKEN },
      timeout: 20000
    });
    const retorno = res.data?.retorno || {};
    const r = retorno.pessoaFisica || retorno.pessoaJuridica || retorno || {};
    return {
      score: r.score || null,
      faixa: r.faixaScore || '',
      motivos: r.motivos || [],
      indicadores: r.indicadoresNegocio || null,
      fonte: 'Direct Data Score (QUOD)',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    console.error(`[Score] Erro: ${e.response?.status || e.message}`);
    return { disponivel: false, erro: e.response?.status || e.message, fonte: 'Direct Data Score' };
  }
}

// ─────────────────────────────────────────────
// 7. DETALHAMENTO NEGATIVO — Direct Data
// Protestos, ações judiciais, falência, cheques
// Endpoint: /api/DetalhamentoNegativo | R$ 2,38
// ─────────────────────────────────────────────

async function consultarNegativacoes(documento) {
  if (!process.env.DIRECTD_TOKEN) {
    return { disponivel: false, fonte: 'Direct Data Negativacoes' };
  }
  try {
    const doc = limparDoc(documento);
    const paramDoc = doc.length <= 11 ? { Cpf: doc } : { Cnpj: doc };
    const res = await axios.get('https://apiv3.directd.com.br/api/DetalhamentoNegativo', {
      params: { ...paramDoc, Token: process.env.DIRECTD_TOKEN },
      timeout: 20000
    });
    const retorno = res.data?.retorno || {};
    const r = retorno.pessoaFisica || retorno.pessoaJuridica || retorno || {};
    const pf = r.pendenciaFinanceira || {};
    const protestosArr = pf.protestos || [];
    // Extrair cartorios de dentro de cada protesto
    const todosCartorios = [];
    protestosArr.forEach(p => {
      (p.cartorios || []).forEach(c => {
        todosCartorios.push({
          situacao: p.situacao || '',
          valor_total_protesto: p.valorTotal || 0,
          nome_cartorio: c.nome || '',
          cidade: c.codigoCidade || '',
          telefone: c.telefone || '',
          titulos: (c.titulos || []).slice(0, 10).map(t => ({
            valor: t.valor || 0, data: t.data || t.dataProtesto || '',
            tipo: t.especie || t.tipo || ''
          }))
        });
      });
    });
    return {
      status: pf.status || 'Nao consultado',
      total_pendencias: pf.totalPendencia || 0,
      protestos: todosCartorios,
      acoes_judiciais: pf.acoesJudiciais || pf.acoes || [],
      cheques_sem_fundo: pf.chequesSemFundo || pf.cheques || [],
      falencias: pf.falencias || [],
      fonte: 'Direct Data (Detalhamento Negativo)',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    console.error(`[Negativacoes] Erro: ${e.response?.status || e.message}`);
    return { disponivel: false, erro: e.response?.status || e.message, fonte: 'Direct Data Negativacoes' };
  }
}

// ─────────────────────────────────────────────
// 8. PROTESTOS — Direct Data
// Endpoint: /api/Protestos | R$ 0,72
// ─────────────────────────────────────────────

async function consultarProtestos(documento) {
  if (!process.env.DIRECTD_TOKEN) {
    return { disponivel: false, fonte: 'Direct Data Protestos' };
  }
  try {
    const doc = limparDoc(documento);
    const paramDoc = doc.length <= 11 ? { Cpf: doc } : { Cnpj: doc };
    const res = await axios.get('https://apiv3.directd.com.br/api/Protestos', {
      params: { ...paramDoc, Token: process.env.DIRECTD_TOKEN },
      timeout: 20000
    });
    const r = res.data?.retorno || res.data || {};
    return {
      total: r.quantidade || r.total || 0,
      protestos: (r.protestos || r.itens || []).map(p => ({
        valor: p.valor || 0, data: p.data || p.dataProtesto || '',
        cartorio: p.cartorio || p.nomeCartorio || '', cidade: p.cidade || ''
      })),
      fonte: 'Direct Data Protestos',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    console.error(`[Protestos] Erro: ${e.response?.status || e.message}`);
    return { disponivel: false, erro: e.response?.status || e.message, fonte: 'Direct Data Protestos' };
  }
}

// ─────────────────────────────────────────────
// 9. NIVEL SOCIOECONOMICO — Direct Data
// Endpoint: /api/NivelSocioEconomico | R$ 0,36
// ─────────────────────────────────────────────

async function consultarPerfilEconomico(cpf) {
  if (!process.env.DIRECTD_TOKEN) return null;
  try {
    const res = await axios.get('https://apiv3.directd.com.br/api/NivelSocioEconomico', {
      params: { Cpf: limparDoc(cpf), Token: process.env.DIRECTD_TOKEN },
      timeout: 20000
    });
    const retorno = res.data?.retorno || {};
    const r = retorno.pessoaFisica || retorno || {};
    console.log('[NivelSocio] Keys:', Object.keys(r).join(', '));
    return {
      nivel_socioeconomico: r.nivelSocioEconomico || r.nivel || r.nse || null,
      renda_presumida: r.rendaPresumida || r.renda || null,
      faixa_renda: r.faixaRenda || r.faixa || null,
      escolaridade: r.escolaridade || null,
      ocupacao: r.ocupacao || r.profissao || null,
      poder_aquisitivo: r.poderAquisitivo || null,
      fonte: 'Direct Data (Nivel Socioeconomico)',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    console.error(`[NivelSocio] Erro: ${e.response?.status || e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// 10. VÍNCULOS SOCIETÁRIOS — Direct Data
// Endpoint: /api/VinculosSocietarios | R$ 1,84
// ─────────────────────────────────────────────

async function consultarVinculos(documento) {
  if (!process.env.DIRECTD_TOKEN) {
    return { disponivel: false, fonte: 'Direct Data Vinculos' };
  }
  try {
    const doc = limparDoc(documento);
    const paramDoc = doc.length <= 11 ? { Cpf: doc } : { Cnpj: doc };
    const res = await axios.get('https://apiv3.directd.com.br/api/VinculosSocietarios', {
      params: { ...paramDoc, Token: process.env.DIRECTD_TOKEN },
      timeout: 20000
    });
    const r = res.data?.retorno || res.data || {};
    const empresas = r.empresas || r.participacoes || r.vinculos || [];
    return {
      total: empresas.length,
      empresas: empresas.slice(0, 20).map(e => ({
        cnpj: e.cnpj || e.documento || '',
        razao_social: e.razaoSocial || e.nome || '',
        situacao: e.situacao || e.status || '',
        cargo: e.cargo || e.qualificacao || '',
        data_entrada: e.dataEntrada || e.desde || '',
        capital_social: e.capitalSocial || null,
        porte: e.porte || ''
      })),
      fonte: 'Direct Data (Vinculos Societarios)',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    console.error(`[Vinculos] Erro: ${e.response?.status || e.message}`);
    return { disponivel: false, erro: e.response?.status || e.message, fonte: 'Direct Data Vinculos' };
  }
}

// ─────────────────────────────────────────────
// 10. ÓBITO — Direct Data
// Endpoint: /api/Obito | R$ 0,36
// ─────────────────────────────────────────────

async function consultarObito(cpf) {
  if (!process.env.DIRECTD_TOKEN) return null;
  try {
    const res = await axios.get('https://apiv3.directd.com.br/api/Obito', {
      params: { Cpf: limparDoc(cpf), Token: process.env.DIRECTD_TOKEN },
      timeout: 15000
    });
    const r = res.data?.retorno || res.data || {};
    return {
      possui_obito: r.possuiObito || r.obito || false,
      data_obito: r.dataObito || r.dataFalecimento || null,
      fonte: 'Direct Data Obito',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────
// 11. ONR — RI Digital (matrícula de imóveis)
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
  const INFO_TOKEN = process.env.INFOSIMPLES_TOKEN;
  if (!INFO_TOKEN) {
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
      token: INFO_TOKEN,
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
    consultarScore(alvo_documento),
    consultarNegativacoes(alvo_documento),
    alvo_tipo === 'PF' ? consultarPerfilEconomico(alvo_documento) : Promise.resolve(null)
  ];

  // Vínculos societários para produtos premium
  const precisaVinculos = ['due_diligence', 'investigacao_patrimonial', 'due_diligence_imobiliaria'].includes(tipo);
  if (precisaVinculos) promises.push(consultarVinculos(alvo_documento));

  // Veículos e imóveis para investigação patrimonial e imobiliária
  const precisaVeiculos = ['investigacao_patrimonial', 'due_diligence_imobiliaria'].includes(tipo);
  if (precisaVeiculos) promises.push(consultarVeiculos(alvo_documento));

  const resultados = await Promise.all(promises);
  const [cadastral, processos, transparencia, score_credito, negativacoes, perfil_economico] = resultados;
  let idx = 6;
  const vinculos = precisaVinculos ? resultados[idx++] : null;
  const veiculos = precisaVeiculos ? resultados[idx++] : null;

  // Para Due Diligence Imobiliária: consultar também o segundo alvo (vendedor)
  let cadastral2 = null, processos2 = null, score2 = null, negativacoes2 = null, vinculos2 = null;
  if (tipo === 'due_diligence_imobiliaria' && pedido.alvo2_documento) {
    const [c2, p2, s2, n2, v2] = await Promise.all([
      pedido.alvo2_tipo === 'PJ' ? consultarCNPJ(pedido.alvo2_documento) : consultarCPF(pedido.alvo2_documento),
      consultarProcessos(pedido.alvo2_documento, pedido.alvo2_tipo, pedido.alvo2_nome),
      consultarScore(pedido.alvo2_documento),
      consultarNegativacoes(pedido.alvo2_documento),
      consultarVinculos(pedido.alvo2_documento)
    ]);
    cadastral2 = c2;
    processos2 = p2;
    score2 = s2;
    negativacoes2 = n2;
    vinculos2 = v2;
  }

  return {
    receita_federal: cadastral,
    processos,
    ...(transparencia ? { transparencia } : {}),
    ...(score_credito?.score ? { score_credito } : {}),
    ...(negativacoes?.status ? { negativacoes } : {}),
    ...(perfil_economico ? { perfil_economico } : {}),
    ...(vinculos?.total ? { vinculos } : {}),
    ...(veiculos ? { veiculos } : {}),
    ...(cadastral2 ? { receita_federal_2: cadastral2 } : {}),
    ...(processos2 ? { processos_2: processos2 } : {}),
    ...(score2?.score ? { score_credito_2: score2 } : {}),
    ...(negativacoes2?.status ? { negativacoes_2: negativacoes2 } : {}),
    ...(vinculos2?.total ? { vinculos_2: vinculos2 } : {})
  };
}

module.exports = {
  consultarCNPJ, consultarCPF, consultarProcessos,
  consultarEscavador, consultarDatajud, consultarTransparencia,
  consultarSerasa, consultarScore, consultarNegativacoes, consultarProtestos,
  consultarPerfilEconomico, consultarVinculos, consultarObito,
  consultarONR, consultarMatricula, consultarVeiculos,
  gerarLinkJusBrasil, executarConsultaCompleta
};
