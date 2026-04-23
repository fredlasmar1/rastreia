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
        timeout: 30000
      });
      // DirectData às vezes retorna {retorno: {...}} e às vezes {retorno: [{...}]}
      let r = res.data?.retorno || {};
      if (Array.isArray(r)) r = r[0] || {};
      console.log('[DirectData PF] Keys:', Object.keys(r).join(', '));
      console.log('[DirectData PF] nome:', JSON.stringify(r.nome), '| cpf:', JSON.stringify(r.cpf), '| sexo:', r.sexo, '| genero:', r.genero, '| situacao:', r.situacaoCadastral, '| situacaoRF:', r.situacaoReceitaFederal);
      // Aceita se tiver nome OU cpf (algumas respostas vem com nome vazio mas cpf preenchido)
      if (r.nome || r.cpf) {
        try {
          // Mapear sexo corretamente
          let sexo = r.sexo || r.genero || '';
          if (sexo === 'M' || sexo === 'm') sexo = 'Masculino';
          else if (sexo === 'F' || sexo === 'f') sexo = 'Feminino';
          // Formatar data sem hora (blindado contra null/undefined/número)
          let dataNasc = r.dataNascimento || r.nascimento || '';
          if (typeof dataNasc === 'string') {
            if (dataNasc.includes(' ')) dataNasc = dataNasc.split(' ')[0];
            if (dataNasc.includes('T')) dataNasc = dataNasc.split('T')[0];
          } else {
            dataNasc = '';
          }
          // Formatar renda (aceita string BR '3.000,50' também) + sanity check
          const rendaRaw = r.rendaEstimada || r.renda || '';
          let rendaFormatada = '';
          let rendaNumerica = null;
          let rendaInconsistente = false;
          let rendaMotivoInconsistencia = '';
          if (rendaRaw) {
            const rendaNum = typeof rendaRaw === 'number'
              ? rendaRaw
              : Number(String(rendaRaw).replace(/\./g, '').replace(',', '.'));
            if (!isNaN(rendaNum) && rendaNum > 0) {
              rendaNumerica = rendaNum;
              rendaFormatada = `R$ ${rendaNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
              // Sanity check: teto por CBO de baixa qualificação + cap absoluto
              const cboStr = String(r.cbo || r.codigoCBO || '').toLowerCase();
              const cboBaixaQualif = /motofret|mototaxi|bikeboy|entregad|auxiliar|ajudant|motorista de entrega|atendent|caixa|vigilant|porteir|doméstic|faxineir|zelador|aux\./i.test(cboStr);
              // Cap geral: renda > R$ 100k/mês é flag (0,3% da população brasileira)
              if (rendaNum > 100000) {
                rendaInconsistente = true;
                rendaMotivoInconsistencia = `Renda estimada (${rendaFormatada}) é improvável e não será usada no cálculo de score`;
              } else if (cboBaixaQualif && rendaNum > 15000) {
                // CBO de baixa qualificação com renda > R$ 15k = inconsistente
                rendaInconsistente = true;
                rendaMotivoInconsistencia = `Renda estimada (${rendaFormatada}) incompatível com CBO ${cboStr || 'informado'} - descartada do score`;
              }
            }
          }
          // Normaliza arrays (DirectData às vezes retorna objeto único)
          const toArray = (v) => Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : []);
          const parentescosArr = toArray(r.parentescos);
          const telefonesArr  = toArray(r.telefones);
          const enderecosArr  = toArray(r.enderecos);
          const emailsArr     = toArray(r.emails);
          return {
            cpf: doc, cpf_formatado: formatarCPF(doc),
            nome: r.nome || '', sexo: sexo,
            data_nascimento: dataNasc, idade: r.idade || null,
            nome_mae: r.nomeMae || r.mae || '', nome_pai: r.nomePai || r.pai || '',
            situacao_rf: r.situacaoCadastral || r.situacaoReceitaFederal || r.situacao || '',
            obito: r.possuiObito || r.obito || false,
            classe_social: r.classeSocial || '', renda_estimada: rendaFormatada,
            renda_numerica: rendaNumerica,
            renda_inconsistente: rendaInconsistente,
            renda_motivo_inconsistencia: rendaMotivoInconsistencia,
            faixa_salarial: r.rendaFaixaSalarial || '',
            profissao: r.cbo || r.codigoCBO || '',
            signo: r.signo || '',
            parentescos: parentescosArr.slice(0, 10).map(p => ({
              nome: p.nome || '', cpf: p.cpf || '', tipo: p.tipoVinculo || p.parentesco || p.tipo || ''
            })),
            telefones: telefonesArr.slice(0, 5).map(t => ({
              numero: t.telefoneComDDD || t.numero || t.telefone || '',
              tipo: t.tipoTelefone || '',
              operadora: t.operadora || '', whatsapp: t.whatsApp || false
            })),
            enderecos: enderecosArr.slice(0, 3).map(e => ({
              logradouro: e.logradouro || '', numero: e.numero || '',
              bairro: e.bairro || '', cidade: e.cidade || '', uf: e.uf || '', cep: e.cep || ''
            })),
            emails: emailsArr.slice(0, 3).map(e => typeof e === 'string' ? e : (e?.enderecoEmail || '')).filter(Boolean),
            fonte: 'Direct Data', consultado_em: new Date().toISOString()
          };
        } catch (mapErr) {
          console.error('[Direct Data PF] Erro no mapeamento:', mapErr.message, '| stack:', mapErr.stack?.split('\n')[1]);
          // Deixa cair no próximo try/catch ou fallback
        }
      } else {
        console.warn('[Direct Data PF] Retorno sem nome nem CPF. Payload:', JSON.stringify(r).slice(0, 500));
      }
    } catch (e) {
      const status = e.response?.status;
      const msg = e.response?.data?.metaDados?.mensagem
        || e.response?.data?.mensagem
        || e.response?.data?.message
        || e.message;
      console.error(`[Direct Data PF] Erro ${status || ''}: ${msg}`);
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
  let escavadorResult = null;
  if (process.env.ESCAVADOR_API_KEY) {
    escavadorResult = await consultarEscavador(doc, tipo, nome);
    if (!escavadorResult.erro) return escavadorResult;
  }
  // Escavador falhou ou nao configurado -> tenta Datajud, mas preserva diagnostico do Escavador
  const datajud = await consultarDatajud(doc, tipo, nome);
  if (escavadorResult?.erro) {
    datajud.escavador_falhou = true;
    datajud.escavador_detalhes = escavadorResult.detalhes;
    datajud.escavador_status_http = escavadorResult.status_http;
    if (datajud.total === 0) {
      datajud.nota = `Escavador indisponivel (${escavadorResult.status_http || 'erro'}): ${escavadorResult.detalhes}. Datajud consultado como fallback (cobertura limitada a TJGO/TRF1/STJ/TST) — nenhum processo encontrado.`;
    }
  }
  return datajud;
}

async function consultarEscavador(doc, tipo, nome) {
  const url = `https://api.escavador.com/api/v2/envolvido/processos?cpf_cnpj=${doc}`;
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.ESCAVADOR_API_KEY}`, Accept: 'application/json' },
      timeout: 20000,
      maxRedirects: 0,
      validateStatus: s => s >= 200 && s < 300
    });
    const items = res.data?.items || [];
    console.log(`[Escavador] doc=${doc} nome="${nome}" status=${res.status} items=${items.length}`);

    // Filtrar: manter apenas processos onde a pessoa e PARTE (nao advogado)
    const comoParte = items.filter(p => {
      const poloA = (p.titulo_polo_ativo || '').toLowerCase();
      const poloP = (p.titulo_polo_passivo || '').toLowerCase();
      const nomeLower = (nome || '').toLowerCase().trim();
      // Match por nome: tenta nome completo OU primeiro+ultimo sobrenome
      if (nomeLower && (poloA.includes(nomeLower) || poloP.includes(nomeLower))) return true;
      if (nomeLower) {
        // Stopwords que nao contam como sobrenome significativo
        const stop = new Set(['de','da','do','das','dos','e']);
        const tokens = nomeLower.split(/\s+/).filter(t => t && !stop.has(t));
        if (tokens.length >= 2) {
          const primeiro = tokens[0];
          // Match se primeiro nome + pelo menos UM outro sobrenome aparecem
          const sobrenomes = tokens.slice(1);
          const bateu = (polo) => polo.includes(primeiro) && sobrenomes.some(s => s.length >= 3 && polo.includes(s));
          if (bateu(poloA) || bateu(poloP)) return true;
        }
      }
      // Verificar envolvimentos
      const envolvimentos = p.envolvimentos || p.partes || [];
      const ehParte = envolvimentos.some(e => {
        const tipoEnv = (e.tipo_envolvimento || e.tipo || e.polo || '').toLowerCase();
        const cpfEnv = (e.cpf || e.documento || '').replace(/\D/g, '');
        return cpfEnv === doc && !tipoEnv.includes('advog') && !tipoEnv.includes('repres');
      });
      if (ehParte) return true;
      // Se nao conseguiu determinar, incluir (melhor mostrar do que esconder)
      if (!nomeLower) return true;
      return false;
    });

    // Se filtrou 100% mas havia items, loga e devolve todos como "revisar"
    let processosFinal = comoParte;
    let aviso = null;
    if (items.length > 0 && comoParte.length === 0) {
      console.warn(`[Escavador] Filtro excluiu todos os ${items.length} processos do doc=${doc}. Retornando sem filtro com flag revisar.`);
      processosFinal = items;
      aviso = `${items.length} processo(s) encontrado(s) - revisar manualmente se a pessoa figura como parte ou apenas como advogada.`;
    }

    return {
      total: processosFinal.length,
      total_geral: items.length,
      excluidos_advogado: items.length - comoParte.length,
      aviso,
      processos: processosFinal.slice(0, 30).map(p => {
        const ultMov = p.data_ultima_movimentacao || '';
        const anoUltMov = ultMov ? new Date(ultMov).getFullYear() : 0;
        const anoAtual = new Date().getFullYear();
        const statusOriginal = p.status?.nome || p.situacao?.nome || p.grau || '';
        let status = 'Ativo';
        if (statusOriginal.toLowerCase().includes('arquiv') || statusOriginal.toLowerCase().includes('baixa') || statusOriginal.toLowerCase().includes('extint')) {
          status = 'Baixado/Arquivado';
        } else if (anoUltMov > 0 && (anoAtual - anoUltMov) >= 3) {
          status = 'Possivelmente inativo (sem movimentacao ha 3+ anos)';
        }
        return {
          numero: p.numero_cnj || '',
          tribunal: p.fontes?.[0]?.nome || p.tribunal?.sigla || '',
          classe: p.classe?.nome || '',
          assunto: p.assuntos?.[0]?.nome || '',
          polo_ativo: p.titulo_polo_ativo || '',
          polo_passivo: p.titulo_polo_passivo || '',
          data_inicio: p.data_inicio || '',
          ultima_movimentacao: ultMov,
          valor_causa: p.valor_causa ? `R$ ${Number(p.valor_causa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null,
          status: status
        };
      }),
      fonte: 'Escavador',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    const status = e.response?.status;
    const msg = e.response?.data?.error || e.response?.data?.message || e.message;
    console.error(`[Escavador] FALHA doc=${doc} status=${status} msg=${msg}`);
    return {
      erro: 'Escavador indisponível',
      status_http: status,
      detalhes: msg,
      processos: [],
      fonte: 'Escavador (falha)'
    };
  }
}

async function consultarDatajud(doc, tipo, nome) {
  const API_KEY = process.env.DATAJUD_API_KEY;
  if (!API_KEY) {
    return { total: 0, processos: [], fonte: 'Datajud CNJ', nota: 'Configure DATAJUD_API_KEY para consultar processos via Datajud.', consultado_em: new Date().toISOString() };
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
        const ultMov = s.dataUltimaAtualizacao || '';
        const anoUltMov = ultMov ? new Date(ultMov).getFullYear() : 0;
        const sitOriginal = s.situacao?.nome || '';
        let statusProc = 'Ativo';
        if (sitOriginal.toLowerCase().includes('arquiv') || sitOriginal.toLowerCase().includes('baixa') || sitOriginal.toLowerCase().includes('extint')) {
          statusProc = 'Baixado/Arquivado';
        } else if (anoUltMov > 0 && (new Date().getFullYear() - anoUltMov) >= 3) {
          statusProc = 'Possivelmente inativo';
        }
        processos.push({
          numero: s.numeroProcesso || '',
          tribunal: s.tribunal || '',
          classe: s.classe?.nome || '',
          assunto: s.assuntos?.[0]?.nome || '',
          polo_ativo: (s.partes || []).filter(p => p.polo === 'ATIVO').map(p => p.nome).join(', '),
          polo_passivo: (s.partes || []).filter(p => p.polo === 'PASSIVO').map(p => p.nome).join(', '),
          data_inicio: s.dataAjuizamento || '',
          ultima_movimentacao: ultMov,
          valor_causa: s.valorCausa ? `R$ ${Number(s.valorCausa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null,
          status: statusProc
        });
      });
    }
  });

  return {
    total: processos.length,
    processos: processos.slice(0, 30),
    nota: processos.length === 0 ? 'Escavador e Datajud consultados — nenhum processo encontrado nas bases oficiais.' : null,
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
      timeout: 30000
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
    const status = e.response?.status;
    const msg = e.response?.data?.metaDados?.mensagem
      || e.response?.data?.mensagem
      || e.response?.data?.message
      || e.message;
    console.error(`[Score] Erro ${status || ''}: ${msg}`);
    return { disponivel: false, erro: status || e.message, detalhes: msg, fonte: 'Direct Data Score' };
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
      timeout: 30000
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
    const status = e.response?.status;
    const msg = e.response?.data?.metaDados?.mensagem
      || e.response?.data?.mensagem
      || e.response?.data?.message
      || e.message;
    console.error(`[Negativacoes] Erro ${status || ''}: ${msg}`);
    return { disponivel: false, erro: status || e.message, detalhes: msg, fonte: 'Direct Data Negativacoes' };
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
      timeout: 30000
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
    const status = e.response?.status;
    const msg = e.response?.data?.metaDados?.mensagem
      || e.response?.data?.mensagem
      || e.response?.data?.message
      || e.message;
    console.error(`[Protestos] Erro ${status || ''}: ${msg}`);
    return { disponivel: false, erro: status || e.message, detalhes: msg, fonte: 'Direct Data Protestos' };
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
      timeout: 30000
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
    const status = e.response?.status;
    const msg = e.response?.data?.metaDados?.mensagem
      || e.response?.data?.mensagem
      || e.response?.data?.message
      || e.message;
    console.error(`[NivelSocio] Erro ${status || ''}: ${msg}`);
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
      timeout: 30000
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
    const status = e.response?.status;
    const msg = e.response?.data?.metaDados?.mensagem
      || e.response?.data?.mensagem
      || e.response?.data?.message
      || e.message;
    console.error(`[Vinculos] Erro ${status || ''}: ${msg}`);
    return { disponivel: false, erro: status || e.message, detalhes: msg, fonte: 'Direct Data Vinculos' };
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

// =============================================
// CONSULTA VEICULAR POR PLACA (DirectData)
// =============================================

function normalizarPlaca(placa) {
  if (!placa) return '';
  return String(placa).toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

function validarPlaca(placa) {
  const p = normalizarPlaca(placa);
  // Antiga: AAA9999 | Mercosul: AAA9A99
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p);
}

async function consultarVeiculoPorPlaca(placa) {
  const placaLimpa = normalizarPlaca(placa);
  if (!validarPlaca(placaLimpa)) {
    return { disponivel: false, erro: 'Placa inválida', placa: placaLimpa, fonte: 'DirectData' };
  }
  if (!process.env.DIRECTD_TOKEN) {
    return { disponivel: false, erro: 'DIRECTD_TOKEN não configurado', fonte: 'DirectData' };
  }
  try {
    const resp = await axios.get('https://apiv3.directd.com.br/api/ConsultaVeicular', {
      params: { Placa: placaLimpa, Token: process.env.DIRECTD_TOKEN },
      timeout: 45000
    });

    const meta = resp.data?.metaDados || {};
    const retorno = resp.data?.retorno || {};
    // DirectData aninha os dados em retorno.veiculo
    const v = retorno.veiculo || retorno;
    const resultadoId = Number(meta.resultadoId);

    // resultadoId !== 1 significa erro da API (saldo, permissão, placa sem dados, etc)
    const semDados = !v || (!v.placa && !v.marca && !v.modelo && !v.chassi);
    if ((resultadoId && resultadoId !== 1) || semDados) {
      return {
        disponivel: false,
        erro: meta.mensagem || meta.resultado || 'Sem dados retornados pela DirectData',
        codigo_api: meta.resultadoId || null,
        placa: placaLimpa,
        tempo_ms: meta.tempoExecucaoMs,
        raw_meta: meta,
        fonte: 'DirectData ConsultaVeicular'
      };
    }

    const indicadores = v.indicadores || {};
    const restricoesAlertas = [];
    if (indicadores.rouboFurto) restricoesAlertas.push('ROUBO OU FURTO');
    if (indicadores.renajud) restricoesAlertas.push('RENAJUD (restrição judicial)');
    if (indicadores.rfb) restricoesAlertas.push('Restrição Receita Federal');
    if (indicadores.renainf) restricoesAlertas.push('Infrações RENAINF');
    if (indicadores.leilao) restricoesAlertas.push('Veículo em/ex leilão');
    if (indicadores.recall) restricoesAlertas.push('Recall registrado');
    if (indicadores.comunicadoVenda) restricoesAlertas.push('Comunicado de venda');
    if (indicadores.pendenciaEmissao) restricoesAlertas.push('Pendência de emissão de documento');
    if (indicadores.alarme) restricoesAlertas.push('Alarme registrado');
    // Restrições textuais vindas do objeto
    if (Array.isArray(v.restricoes)) {
      v.restricoes.forEach(x => { if (x && String(x).trim()) restricoesAlertas.push(String(x)); });
    }

    return {
      disponivel: true,
      placa: v.placa || placaLimpa,
      marca: v.marca || '',
      modelo: v.modelo || '',
      marca_modelo: [v.marca, v.modelo].filter(Boolean).join(' '),
      ano_modelo: v.anoModelo || '',
      ano_fabricacao: v.anoFabricacao || '',
      cor: v.cor || '',
      combustivel: v.combustivel || '',
      chassi: v.chassi || '',
      renavam: v.renavam || '',
      situacao: v.situacaoVeiculo || v.situacao || '',
      municipio: v.municipio || '',
      uf: v.uf || '',
      tipo_veiculo: v.tipo || '',
      categoria: v.categoria || '',
      especie: v.especie || '',
      potencia: v.potencia || '',
      proprietario: retorno.proprietario || '',
      proprietario_documento: retorno.documento || '',
      ano_exercicio: retorno.anoExercicio || '',
      fipe_valor: v.fipe?.valor || '',
      fipe_ano: v.fipe?.ano || '',
      fipe_mes: v.fipe?.mes || '',
      fipe_mes_referencia: v.fipe?.mes && v.fipe?.ano ? `${v.fipe.mes}/${v.fipe.ano}` : '',
      restricoes: restricoesAlertas,
      indicadores,
      raw: retorno,
      fonte: 'DirectData ConsultaVeicular',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    const status = e.response?.status;
    const apiMsg = e.response?.data?.metaDados?.mensagem
      || e.response?.data?.message
      || e.response?.data?.erro
      || e.message;
    return {
      disponivel: false,
      erro: status ? `DirectData retornou HTTP ${status}` : 'DirectData indisponível',
      detalhes: apiMsg,
      status_http: status || null,
      placa: placaLimpa,
      fonte: 'DirectData ConsultaVeicular'
    };
  }
}

// =============================================
// Proprietários Placa — Histórico de donos por exercício
// Endpoint DirectData (não documentado no cardápio V4.3 público,
// mas disponível no painel). Retorna lista de proprietários com
// ano de exercício, documento (CPF/CNPJ), UF de circulação e data
// de pagamento do licenciamento.
// =============================================

async function consultarProprietariosPlaca(placa) {
  const placaLimpa = normalizarPlaca(placa);
  if (!validarPlaca(placaLimpa)) {
    return { disponivel: false, erro: 'Placa inválida', placa: placaLimpa, fonte: 'DirectData ProprietariosPlaca' };
  }
  if (!process.env.DIRECTD_TOKEN) {
    return { disponivel: false, erro: 'DIRECTD_TOKEN não configurado', fonte: 'DirectData ProprietariosPlaca' };
  }

  // Tenta múltiplos paths conhecidos (DirectData não documenta publicamente
  // a rota da tela 'Proprietários Placa'). Override único via env.
  const override = process.env.DIRECTD_PROPRIETARIOS_URL;
  const candidatos = override ? [override] : [
    'https://apiv3.directd.com.br/api/ProprietariosPlaca',
    'https://apiv3.directd.com.br/api/VeiculoProprietariosPlaca',
    'https://apiv3.directd.com.br/api/HistoricoProprietarios',
    'https://apiv3.directd.com.br/api/ProprietariosVeiculo'
  ];

  let resp = null;
  let endpointUsado = null;
  let ultimoErro = null;

  for (const url of candidatos) {
    try {
      resp = await axios.get(url, {
        params: { Placa: placaLimpa, Token: process.env.DIRECTD_TOKEN },
        timeout: 45000
      });
      endpointUsado = url;
      break;
    } catch (e) {
      ultimoErro = e;
      const status = e.response?.status;
      // 404 = path não existe, tenta próximo. 401/403/400 = path existe mas rejeitou.
      if (status && status !== 404) {
        resp = e.response; // mantém retorno para parsing de metaDados.mensagem
        endpointUsado = url;
        break;
      }
    }
  }

  if (!resp) {
    const status = ultimoErro?.response?.status;
    return {
      disponivel: false,
      erro: status ? `DirectData retornou HTTP ${status}` : 'DirectData indisponível',
      detalhes: ultimoErro?.response?.data?.metaDados?.mensagem || ultimoErro?.message,
      status_http: status || null,
      placa: placaLimpa,
      fonte: 'DirectData ProprietariosPlaca'
    };
  }

  try {
    const meta = resp.data?.metaDados || {};
    const retorno = resp.data?.retorno || {};
    const resultadoId = Number(meta.resultadoId);

    // Possíveis formatos de retorno — normaliza para array de proprietários.
    let lista = [];
    if (Array.isArray(retorno.proprietarios)) {
      lista = retorno.proprietarios;
    } else if (Array.isArray(retorno.listaProprietarios)) {
      lista = retorno.listaProprietarios;
    } else if (Array.isArray(retorno.historico)) {
      lista = retorno.historico;
    } else if (Array.isArray(retorno.historicoProprietarios)) {
      lista = retorno.historicoProprietarios;
    } else if (Array.isArray(retorno)) {
      lista = retorno;
    }

    if ((resultadoId && resultadoId !== 1) || lista.length === 0) {
      return {
        disponivel: false,
        erro: meta.mensagem || meta.resultado || 'Sem histórico de proprietários disponível',
        codigo_api: meta.resultadoId || null,
        placa: placaLimpa,
        tempo_ms: meta.tempoExecucaoMs,
        fonte: 'DirectData ProprietariosPlaca'
      };
    }

    // Normaliza cada proprietário para shape estável consumido pelo PDF.
    const proprietarios = lista.map(p => {
      const doc = String(p.documento || p.cpfCnpj || p.cpf || p.cnpj || '').replace(/\D/g, '');
      const tipoDoc = doc.length === 14 ? 'CNPJ' : (doc.length === 11 ? 'CPF' : '');
      const docFormatado = doc.length === 14 ? formatarCNPJ(doc) : (doc.length === 11 ? formatarCPF(doc) : (p.documento || ''));
      return {
        documento: doc || String(p.documento || ''),
        documento_formatado: docFormatado,
        tipo_documento: tipoDoc,
        nome: p.nome || p.proprietario || p.nomeProprietario || '',
        exercicio: String(p.exercicio || p.anoExercicio || p.ano || '').trim(),
        data_pagamento: p.dataPagamento || p.dataDoPagamento || p.data_pagamento || '',
        uf_circulacao: p.ufCirculacao || p.uf || p.estado || ''
      };
    }).filter(p => p.documento || p.nome);

    // Ordena por exercício decrescente (mais recente primeiro).
    proprietarios.sort((a, b) => {
      const ea = parseInt(a.exercicio, 10) || 0;
      const eb = parseInt(b.exercicio, 10) || 0;
      return eb - ea;
    });

    const chassi = retorno.chassi || retorno.veiculo?.chassi || '';
    const renavam = retorno.renavam || retorno.veiculo?.renavam || '';

    return {
      disponivel: true,
      placa: placaLimpa,
      chassi,
      renavam,
      total: proprietarios.length,
      proprietarios,
      raw: retorno,
      endpoint: endpointUsado,
      fonte: 'DirectData ProprietariosPlaca',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    const status = e.response?.status;
    const apiMsg = e.response?.data?.metaDados?.mensagem
      || e.response?.data?.message
      || e.message;
    return {
      disponivel: false,
      erro: status ? `DirectData retornou HTTP ${status}` : 'DirectData indisponível',
      detalhes: apiMsg,
      status_http: status || null,
      placa: placaLimpa,
      fonte: 'DirectData ProprietariosPlaca'
    };
  }
}

// =============================================
// ORQUESTRADOR — executa tudo em paralelo
// =============================================

async function executarConsultaCompleta(pedido) {
  const { alvo_documento, alvo_tipo, alvo_nome, tipo, alvo_placa } = pedido;

  // Produto standalone: Consulta Veicular
  // Chamadas em paralelo para enriquecer com histórico de proprietários
  if (tipo === 'consulta_veicular') {
    const [veiculo_placa, proprietarios_placa] = await Promise.all([
      consultarVeiculoPorPlaca(alvo_placa),
      consultarProprietariosPlaca(alvo_placa)
    ]);
    return { veiculo_placa, proprietarios_placa };
  }

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
  consultarVeiculoPorPlaca, consultarProprietariosPlaca,
  validarPlaca, normalizarPlaca,
  executarConsultaCompleta
};
