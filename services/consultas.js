const axios = require('axios');
const monitorApi = require('./monitorApi');

// ─────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────

function limparDoc(doc) { return doc.replace(/\D/g, ''); }
function formatarCPF(cpf) { return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'); }
function formatarCNPJ(cnpj) { return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'); }

// Classifica erros HTTP/mensagens de API externa em categorias estáveis.
// Retorna { categoria, etiqueta, mensagem } onde categoria é uma das:
// 'saldo' | 'token' | 'quota' | 'cpf_invalido' | 'sem_dados' | 'timeout' | 'servidor' | 'rede' | 'outro'
function classificarErroAPI(status, mensagem) {
  const m = String(mensagem || '').toLowerCase();
  if (status === 402 || /saldo.*(insuficient|zero|negativ)|sem\s+saldo|cr[eé]dito.*insuficient|recarg|pagamento\s+pendent/i.test(m))
    return { categoria: 'saldo', etiqueta: 'SALDO INSUFICIENTE', mensagem: mensagem || 'Saldo insuficiente na API externa' };
  if (status === 401 || status === 403 || /token.*(invalid|expirad|revogad)|unauthoriz|forbidden|chave.*invalid|api[_ ]?key.*invalid/i.test(m))
    return { categoria: 'token', etiqueta: 'TOKEN INVÁLIDO/EXPIRADO', mensagem: mensagem || 'Token de autenticação recusado' };
  if (status === 429 || /rate.?limit|too.?many.?requests|limite.*(atingid|diário|mensal|excedid)/i.test(m))
    return { categoria: 'quota', etiqueta: 'LIMITE/QUOTA ATINGIDO', mensagem: mensagem || 'Limite de requisições atingido' };
  if (/cpf.*(invalid|incorret)|documento.*invalid|placa.*invalid|cnpj.*invalid/i.test(m))
    return { categoria: 'doc_invalido', etiqueta: 'DOCUMENTO INVÁLIDO', mensagem: mensagem || 'Documento rejeitado pela API' };
  if (status === 404 || /n[aã]o.?encontrad|nao.?localizad|sem.?registr|sem.?dados|sem.?hist[oó]ric/i.test(m))
    return { categoria: 'sem_dados', etiqueta: 'SEM DADOS', mensagem: mensagem || 'API respondeu sem registros' };
  if (/timeout|ETIMEDOUT|ECONNABORTED/i.test(m))
    return { categoria: 'timeout', etiqueta: 'TIMEOUT', mensagem: mensagem || 'API externa não respondeu a tempo' };
  if (typeof status === 'number' && status >= 500)
    return { categoria: 'servidor', etiqueta: 'ERRO NO SERVIDOR DA API', mensagem: mensagem || `HTTP ${status}` };
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN|network/i.test(m))
    return { categoria: 'rede', etiqueta: 'FALHA DE REDE', mensagem: mensagem || 'Erro de rede ao alcançar a API' };
  return { categoria: 'outro', etiqueta: 'ERRO', mensagem: mensagem || `HTTP ${status || '?'}` };
}

// Log padrão destacado para falhas de APIs pagas (aparece claro no Railway)
function logarFalhaAPI(origem, status, mensagem) {
  const c = classificarErroAPI(status, mensagem);
  const prefixo = c.categoria === 'saldo' || c.categoria === 'token' || c.categoria === 'quota'
    ? '[!!! FALHA API]'
    : '[FALHA API]';
  console.error(`${prefixo} ${origem} | ${c.etiqueta} | status=${status || '-'} | msg=${c.mensagem}`);
  try { monitorApi.registrarFalha(origem, c); } catch (_) {}
  return c;
}

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
      var _erroDirectd = logarFalhaAPI('Direct Data PF', status, msg);
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
      var _erroCpfCnpj = logarFalhaAPI('CPF.CNPJ', e.response?.status, e.response?.data?.message || e.message);
    }
  }

  // Nenhuma API disponível ou todas falharam — monta aviso específico com base nas falhas
  const falhaPrincipal = (typeof _erroDirectd !== 'undefined' && _erroDirectd)
    || (typeof _erroCpfCnpj !== 'undefined' && _erroCpfCnpj)
    || null;
  let aviso = 'Nenhuma API de CPF retornou dados.';
  let instrucao = 'Verifique DIRECTD_TOKEN ou CPFCNPJ_API_KEY';
  if (falhaPrincipal) {
    if (falhaPrincipal.categoria === 'saldo') {
      aviso = 'Consulta bloqueada por saldo insuficiente no provedor de dados cadastrais.';
      instrucao = 'Recarregar saldo da DirectData em app.directd.com.br para restabelecer o dossiê completo.';
    } else if (falhaPrincipal.categoria === 'token') {
      aviso = 'Provedor de dados cadastrais recusou o token de autenticação.';
      instrucao = 'Atualizar DIRECTD_TOKEN no Railway (token pode ter sido revogado ou expirou).';
    } else if (falhaPrincipal.categoria === 'quota') {
      aviso = 'Limite de requisições do provedor de dados cadastrais foi atingido.';
      instrucao = 'Aguardar reset da quota ou fazer upgrade do plano na DirectData.';
    } else if (falhaPrincipal.categoria === 'timeout' || falhaPrincipal.categoria === 'rede' || falhaPrincipal.categoria === 'servidor') {
      aviso = 'Provedor de dados cadastrais está temporariamente indisponível.';
      instrucao = 'Reexecutar a consulta em alguns minutos.';
    }
  }
  return {
    cpf: doc, cpf_formatado: formatarCPF(doc),
    aviso,
    instrucao,
    falha_categoria: falhaPrincipal?.categoria || 'indisponivel',
    falha_detalhes: falhaPrincipal?.mensagem || null,
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
    const c = logarFalhaAPI('Score', status, msg);
    return { disponivel: false, erro: status || e.message, detalhes: msg, falha_categoria: c.categoria, fonte: 'Direct Data Score' };
  }
}

// ─────────────────────────────────────────────
// 7. DETALHAMENTO NEGATIVO — Direct Data
// Protestos, ações judiciais, falência, cheques (NÃO traz lista de credores)
// Endpoint base: /api/DetalhamentoNegativo | R$ 2,38
// Endpoint complementar: /api/BoaVistaAcertaCompletoPositivoPF (PF) ou
//   /api/BoaVistaDefineLimitePositivoPJ (PJ) — traz a lista detalhada de
//   credores/apontamentos (pendenciasFinanceiras.ocorrencias).
// ─────────────────────────────────────────────

// A Boa Vista marca envolvimento em falência sem detalhes (sem CNPJ, sem
// data, sem natureza). Filtramos itens vazios e deduplicamos pela chave
// estruturada para não exibir "Falência / Falência" repetido no PDF.
function normalizarFalencias(arr) {
  if (!Array.isArray(arr)) return [];
  const limparData = (s) => String(s || '').replace(/\s+00:00:00$/, '').trim();
  const vistos = new Set();
  const result = [];
  for (const f of arr) {
    const cnpj = String(f.cnpj || f.documento || '').replace(/\D/g, '');
    const data = limparData(f.data || f.dataAbertura || '');
    const desc = String(f.descricao || f.tipo || f.natureza || '').trim();
    const temDados = !!(cnpj || data || (desc && desc.toLowerCase() !== 'falencia' && desc.toLowerCase() !== 'falência'));
    if (!temDados) continue;
    const chave = `${cnpj}|${data}|${desc.toLowerCase()}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    result.push({ ...f, data, descricao: desc });
  }
  return result;
}

async function consultarApontamentosBoaVista(doc) {
  // Retorna o array de apontamentos (credor, valor, data, contrato...) via
  // Boa Vista Acerta Completo (PF) / Define Limite Positivo (PJ).
  // Em caso de falha, retorna [] e segue o fluxo principal.
  try {
    const isPF = doc.length <= 11;
    const url = isPF
      ? 'https://apiv3.directd.com.br/api/BoaVistaAcertaCompletoPositivoPF'
      : 'https://apiv3.directd.com.br/api/BoaVistaDefineLimitePositivoPJ';
    const params = isPF
      ? { CPF: doc, Token: process.env.DIRECTD_TOKEN }
      : { CNPJ: doc, Token: process.env.DIRECTD_TOKEN };
    const res = await axios.get(url, { params, timeout: 30000 });
    const retorno = res.data?.retorno || {};
    const pend = isPF
      ? (retorno.pendenciasFinanceiras || {})
      : (retorno.restricoes?.pendenciasFinanceiras || {});
    const ocorrencias = Array.isArray(pend.ocorrencias) ? pend.ocorrencias : [];
    const limparData = (s) => String(s || '').replace(/\s+00:00:00$/, '').trim();
    return ocorrencias.map(o => ({
      credor: o.credor || o.informante || '',
      contrato: o.contrato || '',
      tipo_contrato: o.modalidade || o.origem || '',
      valor: Number(String(o.valor || '0').replace(',', '.')) || 0,
      data_inclusao: limparData(o.dataInclusao),
      data_ocorrencia: limparData(o.dataVencimento),
      cidade: '',
      uf: '',
      telefone: '',
      situacao: o.subjudice && /sim|s$|true/i.test(o.subjudice) ? 'Sub judice' : ''
    }));
  } catch (e) {
    const status = e.response?.status;
    const msg = e.response?.data?.metaDados?.mensagem || e.message;
    console.warn(`[BoaVistaApontamentos] Sem detalhamento (${status || 'erro'}): ${msg}`);
    return [];
  }
}

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
          cidade: c.codigoCidade || c.cidade || '',
          uf: c.uf || c.estado || '',
          telefone: c.telefone || '',
          titulos: (c.titulos || []).slice(0, 10).map(t => ({
            valor: t.valor || 0,
            data: t.data || t.dataProtesto || '',
            tipo: t.especie || t.tipo || '',
            apresentante: t.apresentante || ''
          }))
        });
      });
    });

    // Lista detalhada de credores: DetalhamentoNegativo NÃO retorna o array de
    // credores (apenas total agregado). Buscamos via Boa Vista Acerta Completo
    // (PF) / Define Limite Positivo (PJ), que expõe pendenciasFinanceiras.ocorrencias.
    let itensNeg = [];
    const totalPendencia = Number(pf.totalPendencia || 0);
    const temProtesto = (pf.protestos || []).length > 0;
    if (totalPendencia > 0 || temProtesto) {
      itensNeg = await consultarApontamentosBoaVista(doc);
    }

    return {
      status: pf.status || 'Nao consultado',
      total_pendencias: totalPendencia,
      protestos: todosCartorios,
      pendencias: itensNeg,
      acoes_judiciais: pf.acoesJudiciais || pf.acoes || [],
      cheques_sem_fundo: pf.chequesSemFundo || pf.cheques || [],
      falencias: normalizarFalencias(pf.recuperacoesJudiciaisFalencia || pf.falencias || []),
      fonte: itensNeg.length > 0
        ? 'Direct Data (Detalhamento Negativo + Boa Vista Acerta Completo)'
        : 'Direct Data (Detalhamento Negativo)',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    const status = e.response?.status;
    const msg = e.response?.data?.metaDados?.mensagem
      || e.response?.data?.mensagem
      || e.response?.data?.message
      || e.message;
    const c = logarFalhaAPI('Negativacoes', status, msg);
    return { disponivel: false, erro: status || e.message, detalhes: msg, falha_categoria: c.categoria, fonte: 'Direct Data Negativacoes' };
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
        valor: Number(p.valor || p.valorTotal || 0),
        data: p.data || p.dataProtesto || '',
        cartorio: p.cartorio || p.nomeCartorio || p.nome || '',
        cidade: p.cidade || p.municipio || '',
        uf: p.uf || p.estado || '',
        devedor: p.devedor || p.nomeDevedor || '',
        documento: p.documento || p.numeroTitulo || ''
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
    const c = logarFalhaAPI('Protestos', status, msg);
    return { disponivel: false, erro: status || e.message, detalhes: msg, falha_categoria: c.categoria, fonte: 'Direct Data Protestos' };
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
    logarFalhaAPI('NivelSocio', status, msg);
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
    const c = logarFalhaAPI('Vinculos', status, msg);
    return { disponivel: false, erro: status || e.message, detalhes: msg, falha_categoria: c.categoria, fonte: 'Direct Data Vinculos' };
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
// Fornecedor: Credify (credifyapis.readme.io).
// Docs:  POST https://api.credify.com.br/auth  (ClientID + ClientSecret)
//        POST https://api.credify.com.br/historicoproprietario  (histórico completo via placa)
//        POST https://api.credify.com.br/veiculoproprietarioplaca (proprietário atual + dados cadastrais)
//
// Autenticação: token JWT válido 24h, retornado no campo `Dados`,
// enviado nas próximas chamadas no header `Authorization: Bearer {token}`.
//
// DirectData foi descartada como fonte aqui: o endpoint 'Proprietários Placa'
// aparece no painel web mas NÃO está exposto no cardápio V4.3 e todas as
// variações testadas retornaram 404. HistoricoVeiculos (por CPF/CNPJ) continua
// via DirectData na função abaixo.
// =============================================

const CREDIFY_BASE = process.env.CREDIFY_BASE_URL || 'https://api.credify.com.br';
let _credifyTokenCache = { token: null, expiraEm: 0 };

async function _obterTokenCredify() {
  // Reuso de token por 23h30min (margem de segurança sobre os 24h oficiais).
  const agora = Date.now();
  if (_credifyTokenCache.token && _credifyTokenCache.expiraEm > agora) {
    return _credifyTokenCache.token;
  }
  if (!process.env.CREDIFY_CLIENT_ID || !process.env.CREDIFY_CLIENT_SECRET) {
    const e = new Error('CREDIFY_CLIENT_ID / CREDIFY_CLIENT_SECRET não configurados');
    e.codigo = 'credenciais_ausentes';
    throw e;
  }

  // ClientSecret na doc oficial é integer, mas muitas implementações
  // aceitam string. Enviamos como número quando possível e caímos para string.
  const secretRaw = process.env.CREDIFY_CLIENT_SECRET;
  const secretNum = Number(secretRaw);
  const clientSecret = Number.isFinite(secretNum) && String(secretNum) === String(secretRaw)
    ? secretNum
    : secretRaw;

  const resp = await axios.post(`${CREDIFY_BASE}/auth`, {
    ClientID: process.env.CREDIFY_CLIENT_ID,
    ClientSecret: clientSecret
  }, {
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    timeout: 30000
  });

  const sucesso = resp.data?.Success === true || resp.data?.success === true;
  const token = resp.data?.Dados || resp.data?.dados || resp.data?.token || resp.data?.Token;
  if (!sucesso || !token) {
    const msg = resp.data?.Message || resp.data?.message || 'Autenticação Credify falhou';
    const e = new Error(msg);
    e.codigo = 'auth_falhou';
    throw e;
  }

  // 23h30min de validade para refresh antecipado.
  _credifyTokenCache = { token, expiraEm: agora + 23.5 * 3600 * 1000 };
  return token;
}

async function consultarProprietariosPlaca(placa) {
  const placaLimpa = normalizarPlaca(placa);
  if (!validarPlaca(placaLimpa)) {
    return { disponivel: false, erro: 'Placa inválida', placa: placaLimpa, fonte: 'Credify HistoricoProprietario' };
  }
  if (!process.env.CREDIFY_CLIENT_ID || !process.env.CREDIFY_CLIENT_SECRET) {
    return {
      disponivel: false,
      erro: 'Credify não configurada',
      detalhes: 'Defina CREDIFY_CLIENT_ID e CREDIFY_CLIENT_SECRET nas variáveis de ambiente',
      placa: placaLimpa,
      fonte: 'Credify HistoricoProprietario'
    };
  }

  let token;
  try {
    token = await _obterTokenCredify();
  } catch (e) {
    return {
      disponivel: false,
      erro: 'Falha ao autenticar na Credify',
      detalhes: e.message,
      placa: placaLimpa,
      fonte: 'Credify HistoricoProprietario'
    };
  }

  const idConsulta = String(Date.now()).slice(-10);
  let resp;
  try {
    resp = await axios.post(`${CREDIFY_BASE}/historicoproprietario`, {
      IdConsulta: idConsulta,
      Placa: placaLimpa
    }, {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      timeout: 45000
    });
  } catch (e) {
    const status = e.response?.status;
    const apiMsg = e.response?.data?.Message
      || e.response?.data?.message
      || e.response?.data?.RESPOSTA?.DESCRICAORETORNO
      || e.message;
    return {
      disponivel: false,
      erro: status ? `Credify retornou HTTP ${status}` : 'Credify indisponível',
      detalhes: apiMsg,
      status_http: status || null,
      placa: placaLimpa,
      fonte: 'Credify HistoricoProprietario'
    };
  }

  try {
    // A Credify devolve o payload em UPPERCASE. Normalizamos para o shape
    // estável consumido pelo PDF (idêntico ao que a DirectData devolvia).
    const data = resp.data || {};
    const consulta = data.CONSULTA || data.consulta || {};
    const resposta = data.RESPOSTA || data.resposta || {};
    const bloco = resposta.VEICULOPROPRIETARIOPLACA
      || resposta.veiculoproprietarioplaca
      || resposta.HISTORICOPROPRIETARIO
      || {};

    // Registros vêm como REGISTRO_1, REGISTRO_2, ... dentro do bloco.
    const registros = Object.keys(bloco)
      .filter(k => /^REGISTRO_\d+$/i.test(k))
      .sort((a, b) => parseInt(a.split('_')[1], 10) - parseInt(b.split('_')[1], 10))
      .map(k => bloco[k])
      .filter(r => r && typeof r === 'object');

    if (registros.length === 0) {
      const codigo = resposta.CODIGO || resposta.codigo;
      const descr = resposta.DESCRICAORETORNO || resposta.descricaoretorno;
      return {
        disponivel: false,
        erro: descr || 'Sem histórico de proprietários disponível',
        codigo_api: codigo || null,
        placa: placaLimpa,
        fonte: 'Credify HistoricoProprietario'
      };
    }

    const proprietarios = registros.map(r => {
      const doc = String(r.DOCUMENTO || r.NUMERO_DOCUMENTO_PROPRIETARIO || r.documento || '').replace(/\D/g, '');
      const tipoDoc = doc.length === 14 ? 'CNPJ' : (doc.length === 11 ? 'CPF' : '');
      const docFormatado = doc.length === 14 ? formatarCNPJ(doc) : (doc.length === 11 ? formatarCPF(doc) : (r.DOCUMENTO || ''));
      return {
        documento: doc || String(r.DOCUMENTO || ''),
        documento_formatado: docFormatado,
        tipo_documento: tipoDoc,
        nome: r.NOME_PROPRIETARIO || r.nome_proprietario || r.NOME || '',
        exercicio: String(r.ANO_EXERCICIO || r.ano_exercicio || '').trim(),
        data_pagamento: r.DATA_PROCESSAMENTO || r.data_processamento || '',
        uf_circulacao: r.UF_DUT || r.uf_dut || ''
      };
    }).filter(p => p.documento || p.nome);

    // Ordena por exercício decrescente (mais recente primeiro).
    proprietarios.sort((a, b) => {
      const ea = parseInt(a.exercicio, 10) || 0;
      const eb = parseInt(b.exercicio, 10) || 0;
      return eb - ea;
    });

    const primeiro = registros[0] || {};
    const chassi = primeiro.CHASSI || bloco.CHASSI || '';
    const renavam = primeiro.RENAVAM || bloco.RENAVAM || '';

    return {
      disponivel: true,
      placa: placaLimpa,
      chassi,
      renavam,
      total: proprietarios.length,
      proprietarios,
      raw: resposta,
      id_consulta: consulta.IDCONSULTA || idConsulta,
      fonte: 'Credify HistoricoProprietario',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    return {
      disponivel: false,
      erro: 'Falha ao interpretar resposta Credify',
      detalhes: e.message,
      placa: placaLimpa,
      fonte: 'Credify HistoricoProprietario'
    };
  }
}

// =============================================
// HISTORICO DE VEICULOS (DirectData) - PF/PJ
// Retorna TODOS os veiculos vinculados a um CPF ou CNPJ.
// Endpoint publico documentado no cardapio V4.3 (R$ 0,36).
// =============================================
async function consultarHistoricoVeiculos(cpfCnpj) {
  const doc = String(cpfCnpj || '').replace(/\D/g, '');
  if (!doc || (doc.length !== 11 && doc.length !== 14)) {
    return { disponivel: false, erro: 'CPF/CNPJ invalido', fonte: 'DirectData HistoricoVeiculos' };
  }
  if (!process.env.DIRECTD_TOKEN) {
    return { disponivel: false, erro: 'DIRECTD_TOKEN nao configurado', fonte: 'DirectData HistoricoVeiculos' };
  }

  const endpoint = process.env.DIRECTD_HISTORICO_VEICULOS_URL
    || 'https://apiv3.directd.com.br/api/HistoricoVeiculos';

  const params = { Token: process.env.DIRECTD_TOKEN };
  if (doc.length === 14) params.Cnpj = doc; else params.Cpf = doc;

  try {
    const resp = await axios.get(endpoint, { params, timeout: 45000 });
    const meta = resp.data?.metaDados || {};
    const retorno = resp.data?.retorno || {};
    const resultadoId = Number(meta.resultadoId);

    const listaBruta = Array.isArray(retorno.veiculos) ? retorno.veiculos
      : Array.isArray(retorno.listaVeiculos) ? retorno.listaVeiculos
      : [];

    if ((resultadoId && resultadoId !== 1) || listaBruta.length === 0) {
      return {
        disponivel: false,
        erro: meta.mensagem || meta.resultado || 'Nenhum veiculo vinculado encontrado',
        codigo_api: meta.resultadoId || null,
        documento: doc,
        tempo_ms: meta.tempoExecucaoMs,
        fonte: 'DirectData HistoricoVeiculos'
      };
    }

    const veiculos = listaBruta.map(v => ({
      placa: (v.placa || '').toUpperCase().trim(),
      veiculo: v.veiculo || '',
      marca: v.marca || '',
      modelo: v.modelo || '',
      renavam: String(v.renavam || '').trim(),
      chassi: String(v.chassi || '').trim(),
      data_aquisicao: v.dataAquisicao || v.data_aquisicao || ''
    })).filter(v => v.placa || v.chassi || v.renavam);

    // Ordena por data de aquisicao (mais recente primeiro), placas sem data no fim.
    veiculos.sort((a, b) => {
      const parse = (s) => {
        const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`).getTime() : 0;
      };
      return parse(b.data_aquisicao) - parse(a.data_aquisicao);
    });

    return {
      disponivel: true,
      documento: doc,
      proprietario: retorno.proprietario || '',
      total: veiculos.length,
      veiculos,
      enderecos: Array.isArray(retorno.enderecos) ? retorno.enderecos : [],
      raw: retorno,
      fonte: 'DirectData HistoricoVeiculos',
      consultado_em: new Date().toISOString()
    };
  } catch (e) {
    const status = e.response?.status;
    return {
      disponivel: false,
      erro: status ? `DirectData retornou HTTP ${status}` : 'DirectData indisponivel',
      detalhes: e.response?.data?.metaDados?.mensagem || e.message,
      status_http: status || null,
      documento: doc,
      fonte: 'DirectData HistoricoVeiculos'
    };
  }
}

// =============================================
// ORQUESTRADOR — executa tudo em paralelo
// =============================================

async function executarConsultaCompleta(pedido) {
  const { alvo_documento, alvo_tipo, alvo_nome, tipo, alvo_placa } = pedido;

  // Produto standalone: Consulta Veicular
  // Chamadas em paralelo para enriquecer com historico de proprietarios.
  // Se o veiculo atual tiver CPF/CNPJ do proprietario, consulta tambem o
  // patrimonio veicular desse dono via HistoricoVeiculos.
  if (tipo === 'consulta_veicular') {
    // Tier comercial (basico/completo/premium) — gravado no pedido pela rota /api/pedidos.
    // Padrão é 'completo' (9 serviços) para manter comportamento atual quando vier sem tier.
    const tier = pedido.tier_veicular || 'completo';
    const addons = (pedido.addons_veicular || '').split(',').map(s => s.trim()).filter(Boolean);

    const [veiculo_placa, proprietarios_placa] = await Promise.all([
      consultarVeiculoPorPlaca(alvo_placa),
      consultarProprietariosPlaca(alvo_placa)
    ]);

    // Extrai documento do proprietario atual para nova chamada.
    // consultarVeiculoPorPlaca expoe `proprietario_documento` no root.
    const docDono = String(
      veiculo_placa?.proprietario_documento
      || veiculo_placa?.veiculo?.documento
      || ''
    ).replace(/\D/g, '');

    // Histórico de proprietários (incluso só a partir do Completo e no add-on veiculos_por_cpf)
    const temHistoricoProp = tier !== 'basico' || addons.includes('veiculos_por_cpf');
    let historico_veiculos_proprietario = null;
    if (temHistoricoProp && docDono && (docDono.length === 11 || docDono.length === 14)) {
      historico_veiculos_proprietario = await consultarHistoricoVeiculos(docDono);
    }

    // TODO(credify): quando a API Credify estiver ativa, chamar APENAS os serviços
    // do tier + add-ons (ex: LeilaoConjugado só no Premium ou com addon 'leilao').
    // Por enquanto usamos o agregado DirectData + HistoricoProprietario/Veiculos.

    return {
      veiculo_placa,
      proprietarios_placa: temHistoricoProp ? proprietarios_placa : null,
      historico_veiculos_proprietario,
      _tier: tier,
      _addons: addons
    };
  }

  // Produto standalone: Consulta de Restrições
  // Subset leve do Direct Data — apenas o necessário para responder
  // se o CPF/CNPJ está negativado/protestado/com score ruim.
  if (tipo === 'consulta_restricoes') {
    if (!alvo_documento) return {};
    const tipoAlvoCR = alvo_tipo || (limparDoc(alvo_documento).length === 14 ? 'PJ' : 'PF');
    const [cadastral, score_credito, negativacoes, protestos] = await Promise.all([
      tipoAlvoCR === 'PJ' ? consultarCNPJ(alvo_documento) : consultarCPF(alvo_documento),
      consultarScore(alvo_documento),
      consultarNegativacoes(alvo_documento),
      consultarProtestos(alvo_documento)
    ]);
    return {
      receita_federal: cadastral,
      ...(score_credito?.score ? { score_credito } : {}),
      ...(negativacoes?.status ? { negativacoes } : {}),
      ...(protestos && protestos.disponivel !== false ? { protestos } : {})
    };
  }

  // Vínculos societários para produtos premium
  const precisaVinculos = ['due_diligence', 'investigacao_patrimonial', 'due_diligence_imobiliaria'].includes(tipo);
  // Veículos e imóveis para investigação patrimonial e imobiliária
  const precisaVeiculos = ['investigacao_patrimonial', 'due_diligence_imobiliaria'].includes(tipo);

  // V3: para due_diligence_imobiliaria, podem haver múltiplos alvos vindos de
  // pedido_alvos (extraídos da IA). Roda o mesmo conjunto de consultas para
  // cada um. Para os demais produtos, usa apenas o alvo principal do pedido.
  if (tipo === 'due_diligence_imobiliaria') {
    const { pool } = require('../db');
    const r = await pool.query(
      `SELECT nome, documento, tipo_documento, principal
         FROM pedido_alvos
        WHERE pedido_id = $1
        ORDER BY principal DESC, id ASC`,
      [pedido.id]
    );
    const alvos = r.rows.map(a => ({
      nome: a.nome,
      documento: a.documento,
      tipo: a.tipo_documento === 'cnpj' ? 'PJ' : 'PF'
    }));

    // Compat: se nada em pedido_alvos mas há alvo_documento legado, usa esse
    if (!alvos.length && alvo_documento) {
      alvos.push({ nome: alvo_nome, documento: alvo_documento, tipo: alvo_tipo || 'PF' });
    }
    // Compat: alvo2 legado adicional (caso pedido_alvos esteja vazio)
    if (!r.rows.length && pedido.alvo2_documento) {
      alvos.push({ nome: pedido.alvo2_nome, documento: pedido.alvo2_documento, tipo: pedido.alvo2_tipo || 'PF' });
    }

    if (!alvos.length) {
      // Sem alvos — retorna resultado vazio (a UI mostra cpf_ilegivel)
      return {};
    }

    const out = {};
    for (let idx = 0; idx < alvos.length; idx++) {
      const a = alvos[idx];
      console.log(`[v3] consultas alvo ${idx + 1}/${alvos.length}: doc=${a.documento} tipo=${a.tipo}`);
      const r1 = await executarConsultasParaAlvo(a, { precisaVinculos, precisaVeiculos, tipo });
      // O primeiro alvo (principal) usa nomes padrão; demais ganham sufixo _N (2, 3, …).
      const sufixo = idx === 0 ? '' : `_${idx + 1}`;
      for (const [k, v] of Object.entries(r1)) {
        if (v == null) continue;
        out[`${k}${sufixo}`] = v;
      }
    }
    return out;
  }

  // Demais produtos: alvo único do pedido
  return executarConsultasParaAlvo(
    { nome: alvo_nome, documento: alvo_documento, tipo: alvo_tipo },
    { precisaVinculos, precisaVeiculos, tipo }
  );
}

// V3: roda o conjunto de consultas externas para UM alvo (CPF/CNPJ).
// Devolve um dicionário com chaves canônicas (sem sufixo) — o orquestrador
// adiciona _N quando há múltiplos alvos.
async function executarConsultasParaAlvo(alvo, { precisaVinculos, precisaVeiculos, tipo }) {
  const { documento, tipo: tipoAlvo, nome } = alvo;
  if (!documento) return {};

  const promises = [
    tipoAlvo === 'PJ' ? consultarCNPJ(documento) : consultarCPF(documento),
    consultarProcessos(documento, tipoAlvo, nome),
    tipoAlvo === 'PJ' ? consultarTransparencia(documento, nome) : Promise.resolve(null),
    consultarScore(documento),
    consultarNegativacoes(documento),
    tipoAlvo === 'PF' ? consultarPerfilEconomico(documento) : Promise.resolve(null)
  ];

  if (precisaVinculos) promises.push(consultarVinculos(documento));
  if (precisaVeiculos) promises.push(consultarVeiculos(documento));

  const resultados = await Promise.all(promises);
  const [cadastral, processos, transparencia, score_credito, negativacoes, perfil_economico] = resultados;
  let i = 6;
  const vinculos = precisaVinculos ? resultados[i++] : null;
  const veiculos = precisaVeiculos ? resultados[i++] : null;

  return {
    receita_federal: cadastral,
    processos,
    ...(transparencia ? { transparencia } : {}),
    ...(score_credito?.score ? { score_credito } : {}),
    ...(negativacoes?.status ? { negativacoes } : {}),
    ...(perfil_economico ? { perfil_economico } : {}),
    ...(vinculos?.total ? { vinculos } : {}),
    ...(veiculos ? { veiculos } : {})
  };
}

module.exports = {
  consultarCNPJ, consultarCPF, consultarProcessos,
  consultarEscavador, consultarDatajud, consultarTransparencia,
  consultarSerasa, consultarScore, consultarNegativacoes, consultarProtestos,
  consultarPerfilEconomico, consultarVinculos, consultarObito,
  consultarONR, consultarMatricula, consultarVeiculos,
  consultarVeiculoPorPlaca, consultarProprietariosPlaca, consultarHistoricoVeiculos,
  validarPlaca, normalizarPlaca,
  executarConsultaCompleta,
  executarConsultasParaAlvo
};
