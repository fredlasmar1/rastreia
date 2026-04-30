// services/credify/api.js
// Cliente HTTP da Credify específico para a Consulta Veicular (3 pacotes).
//
// Decisão arquitetural do dono do produto:
//   "Só vamos usar os serviços da Credify para consultas veiculares.
//    Qualquer outra demanda é para usar as APIs já cadastradas no sistema."
//
// Por isso este módulo isola todas as chamadas Credify usadas pelos pacotes
// Simples / Mediano / Completo. Demais produtos (dossiê, dd, etc) continuam
// usando DirectData, Escavador e companhia em services/consultas.js.
//
// Auth: ClientID + ClientSecret -> JWT (24h). O token é cacheado em memória.
// Reusa a mesma fonte de credenciais que services/consultas.js já consome.
//
// Cada função retorna SEMPRE um objeto. Em caso de erro, devolve
// `{ erro: <msg>, fonte, ... }` em vez de lançar exceção — assim o PDF
// consegue mostrar "indisponível" sem quebrar o pedido inteiro.

const axios = require('axios');

const BASE = process.env.CREDIFY_BASE_URL || 'https://api.credify.com.br';

let _tokenCache = { token: null, expiraEm: 0 };

function normalizarPlaca(placa) {
  return String(placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

function placaValida(placa) {
  const p = normalizarPlaca(placa);
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p);
}

async function obterToken() {
  const agora = Date.now();
  if (_tokenCache.token && _tokenCache.expiraEm > agora) return _tokenCache.token;

  if (!process.env.CREDIFY_CLIENT_ID || !process.env.CREDIFY_CLIENT_SECRET) {
    const e = new Error('CREDIFY_CLIENT_ID / CREDIFY_CLIENT_SECRET não configurados no Railway');
    e.codigo = 'credenciais_ausentes';
    throw e;
  }

  // ClientSecret na doc oficial é integer; alguns ambientes aceitam string.
  const raw = process.env.CREDIFY_CLIENT_SECRET;
  const num = Number(raw);
  const clientSecret = Number.isFinite(num) && String(num) === String(raw) ? num : raw;

  const resp = await axios.post(`${BASE}/auth`, {
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

  // Margem de 30 min sobre as 24h oficiais.
  _tokenCache = { token, expiraEm: agora + 23.5 * 3600 * 1000 };
  return token;
}

// Wrapper de POST com auth + tratamento de erro padronizado.
async function chamar(endpoint, body, fonte) {
  if (!placaValida(body?.Placa || body?.placa)) {
    return { erro: 'Placa inválida', fonte, disponivel: false };
  }
  if (!process.env.CREDIFY_CLIENT_ID || !process.env.CREDIFY_CLIENT_SECRET) {
    return {
      erro: 'Credify não configurada',
      detalhes: 'Defina CREDIFY_CLIENT_ID e CREDIFY_CLIENT_SECRET no Railway',
      fonte,
      disponivel: false
    };
  }

  let token;
  try {
    token = await obterToken();
  } catch (e) {
    return { erro: 'Falha ao autenticar na Credify', detalhes: e.message, fonte, disponivel: false };
  }

  try {
    const resp = await axios.post(`${BASE}${endpoint}`, body, {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      timeout: 45000
    });
    return resp.data || {};
  } catch (e) {
    const status = e.response?.status;
    const apiMsg = e.response?.data?.Message
      || e.response?.data?.message
      || e.response?.data?.RESPOSTA?.DESCRICAORETORNO
      || e.message;
    console.warn(`[Credify ${fonte}] HTTP ${status || '?'}: ${apiMsg}`);
    return {
      erro: status ? `Credify retornou HTTP ${status}` : 'Credify indisponível',
      detalhes: apiMsg,
      status_http: status || null,
      fonte,
      disponivel: false
    };
  }
}

// ─────────────────────────────────────────────
// Helpers de extração — Credify devolve PAYLOAD em UPPERCASE com a estrutura
// { CONSULTA, RESPOSTA: { <BLOCO>, CODIGO, DESCRICAORETORNO } }.
// ─────────────────────────────────────────────

function extrairBloco(data, ...candidatos) {
  if (!data || typeof data !== 'object') return {};
  if (data.erro) return data; // já é erro padronizado nosso
  const resposta = data.RESPOSTA || data.resposta || {};
  for (const k of candidatos) {
    if (resposta[k]) return resposta[k];
    if (resposta[k.toLowerCase()]) return resposta[k.toLowerCase()];
  }
  return resposta;
}

function statusResposta(data) {
  if (!data) return { ok: false };
  if (data.erro) return { ok: false, erro: data.erro };
  const r = data.RESPOSTA || data.resposta || {};
  const codigo = r.CODIGO || r.codigo;
  const descr = r.DESCRICAORETORNO || r.descricaoretorno;
  // Credify usa "1" para sucesso na maioria dos serviços.
  return { ok: !codigo || String(codigo) === '1', codigo, descricao: descr };
}

function novoIdConsulta() {
  return String(Date.now()).slice(-10);
}

// ─────────────────────────────────────────────
// 1. VeicularBNacionalOnLine — dados básicos do veículo (R$ 1,17)
// ─────────────────────────────────────────────
async function consultarVeicularBNacionalOnLine(placa) {
  const placaLimpa = normalizarPlaca(placa);
  const data = await chamar('/veicularbnacionalonline', {
    IdConsulta: novoIdConsulta(),
    Placa: placaLimpa
  }, 'Credify VeicularBNacionalOnLine');
  if (data.erro) return data;

  const status = statusResposta(data);
  const v = extrairBloco(data, 'VEICULARBNACIONALONLINE', 'VEICULAR') || {};

  if (!status.ok && !v.PLACA && !v.placa) {
    return {
      disponivel: false,
      erro: status.descricao || 'Sem dados retornados',
      placa: placaLimpa,
      fonte: 'Credify VeicularBNacionalOnLine'
    };
  }

  return {
    disponivel: true,
    placa: v.PLACA || v.placa || placaLimpa,
    marca: v.MARCA || v.marca || '',
    modelo: v.MODELO || v.modelo || '',
    marca_modelo: [(v.MARCA || v.marca || ''), (v.MODELO || v.modelo || '')].filter(Boolean).join(' '),
    ano_fabricacao: v.ANO_FABRICACAO || v.anoFabricacao || '',
    ano_modelo: v.ANO_MODELO || v.anoModelo || '',
    cor: v.COR || v.cor || '',
    combustivel: v.COMBUSTIVEL || v.combustivel || '',
    chassi: v.CHASSI || v.chassi || '',
    renavam: v.RENAVAM || v.renavam || '',
    municipio: v.MUNICIPIO || v.municipio || '',
    uf: v.UF || v.uf || '',
    tipo_veiculo: v.TIPO || v.tipo || '',
    categoria: v.CATEGORIA || v.categoria || '',
    especie: v.ESPECIE || v.especie || '',
    situacao: v.SITUACAO || v.situacao || '',
    raw: v,
    fonte: 'Credify VeicularBNacionalOnLine',
    consultado_em: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────
// 2. Gravame — financiamento / alienação fiduciária (R$ 2,09)
// ─────────────────────────────────────────────
async function consultarGravame(placa) {
  const placaLimpa = normalizarPlaca(placa);
  const data = await chamar('/gravame', {
    IdConsulta: novoIdConsulta(),
    Placa: placaLimpa
  }, 'Credify Gravame');
  if (data.erro) return data;

  const status = statusResposta(data);
  const g = extrairBloco(data, 'GRAVAME') || {};

  // "Sem gravame" é um SUCESSO (veículo livre); não tratar como erro.
  const temGravame = !!(g.AGENTE_FINANCEIRO || g.agente_financeiro || g.CONTRATO || g.contrato);
  return {
    disponivel: true,
    placa: placaLimpa,
    tem_gravame: temGravame,
    status: temGravame ? 'COM GRAVAME' : 'LIVRE',
    agente_financeiro: g.AGENTE_FINANCEIRO || g.agente_financeiro || '',
    cnpj_agente: g.CNPJ_AGENTE || g.cnpj_agente || '',
    contrato: g.CONTRATO || g.contrato || '',
    data_inclusao: g.DATA_INCLUSAO || g.data_inclusao || '',
    data_vigencia: g.DATA_VIGENCIA || g.data_vigencia || '',
    tipo_restricao: g.TIPO_RESTRICAO || g.tipo_restricao || '',
    descricao: status.descricao || '',
    raw: g,
    fonte: 'Credify Gravame',
    consultado_em: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────
// 3. Renainf — multas federais (R$ 0,64)
// ─────────────────────────────────────────────
async function consultarRenainf(placa) {
  const placaLimpa = normalizarPlaca(placa);
  const data = await chamar('/renainf', {
    IdConsulta: novoIdConsulta(),
    Placa: placaLimpa
  }, 'Credify Renainf');
  if (data.erro) return data;

  const r = extrairBloco(data, 'RENAINF') || {};
  const registros = Object.keys(r)
    .filter(k => /^REGISTRO_\d+$/i.test(k))
    .sort((a, b) => parseInt(a.split('_')[1], 10) - parseInt(b.split('_')[1], 10))
    .map(k => r[k])
    .filter(x => x && typeof x === 'object');

  const multas = registros.map(m => ({
    auto: m.AUTO_INFRACAO || m.auto_infracao || '',
    orgao: m.ORGAO_AUTUADOR || m.orgao_autuador || m.ORGAO || '',
    data: m.DATA_INFRACAO || m.data_infracao || '',
    hora: m.HORA_INFRACAO || m.hora_infracao || '',
    local: m.LOCAL_INFRACAO || m.local_infracao || '',
    infracao: m.INFRACAO || m.infracao || m.DESC_INFRACAO || '',
    valor: Number(String(m.VALOR || m.valor || '0').replace(',', '.')) || 0,
    situacao: m.SITUACAO || m.situacao || ''
  }));

  return {
    disponivel: true,
    placa: placaLimpa,
    total: multas.length,
    multas,
    fonte: 'Credify Renainf',
    consultado_em: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────
// 4. RENAJUD — restrições judiciais (R$ 1,60)
// ─────────────────────────────────────────────
async function consultarRenajud(placa) {
  const placaLimpa = normalizarPlaca(placa);
  const data = await chamar('/renajud', {
    IdConsulta: novoIdConsulta(),
    Placa: placaLimpa
  }, 'Credify RENAJUD');
  if (data.erro) return data;

  const r = extrairBloco(data, 'RENAJUD') || {};
  const registros = Object.keys(r)
    .filter(k => /^REGISTRO_\d+$/i.test(k))
    .sort((a, b) => parseInt(a.split('_')[1], 10) - parseInt(b.split('_')[1], 10))
    .map(k => r[k])
    .filter(x => x && typeof x === 'object');

  const restricoes = registros.map(x => ({
    tribunal: x.ORGAO_JUDICIAL || x.tribunal || x.TRIBUNAL || '',
    processo: x.PROCESSO || x.processo || x.NUMERO_PROCESSO || '',
    data: x.DATA_INCLUSAO || x.data_inclusao || x.DATA || '',
    tipo_restricao: x.TIPO_RESTRICAO || x.tipo_restricao || '',
    detalhe: x.DETALHE || x.detalhe || x.OBSERVACAO || ''
  }));

  return {
    disponivel: true,
    placa: placaLimpa,
    total: restricoes.length,
    tem_restricao: restricoes.length > 0,
    restricoes,
    fonte: 'Credify RENAJUD',
    consultado_em: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────
// 5. HistoricoProprietarios — histórico de donos (R$ 8,00)
// ─────────────────────────────────────────────
async function consultarHistoricoProprietarios(placa) {
  const placaLimpa = normalizarPlaca(placa);
  const data = await chamar('/historicoproprietario', {
    IdConsulta: novoIdConsulta(),
    Placa: placaLimpa
  }, 'Credify HistoricoProprietarios');
  if (data.erro) return data;

  const bloco = extrairBloco(data, 'VEICULOPROPRIETARIOPLACA', 'HISTORICOPROPRIETARIO') || {};
  const registros = Object.keys(bloco)
    .filter(k => /^REGISTRO_\d+$/i.test(k))
    .sort((a, b) => parseInt(a.split('_')[1], 10) - parseInt(b.split('_')[1], 10))
    .map(k => bloco[k])
    .filter(r => r && typeof r === 'object');

  if (registros.length === 0) {
    const status = statusResposta(data);
    return {
      disponivel: false,
      erro: status.descricao || 'Sem histórico de proprietários disponível',
      placa: placaLimpa,
      fonte: 'Credify HistoricoProprietarios'
    };
  }

  const proprietarios = registros.map(r => {
    const doc = String(r.DOCUMENTO || r.documento || '').replace(/\D/g, '');
    const tipoDoc = doc.length === 14 ? 'CNPJ' : (doc.length === 11 ? 'CPF' : '');
    return {
      documento_mascarado: doc ? (doc.length === 14 ? `**.***.***/****-${doc.slice(-2)}` : `***.***.***-${doc.slice(-2)}`) : '',
      tipo_documento: tipoDoc,
      nome: r.NOME_PROPRIETARIO || r.nome || '',
      exercicio: String(r.ANO_EXERCICIO || r.exercicio || '').trim(),
      data_pagamento: r.DATA_PROCESSAMENTO || r.data_processamento || '',
      uf: r.UF_DUT || r.uf || ''
    };
  });

  proprietarios.sort((a, b) => (parseInt(b.exercicio, 10) || 0) - (parseInt(a.exercicio, 10) || 0));

  return {
    disponivel: true,
    placa: placaLimpa,
    total: proprietarios.length,
    proprietarios,
    fonte: 'Credify HistoricoProprietarios',
    consultado_em: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────
// 6. IndicioSinistroVeicular — indício de batida/sinistro (R$ 1,92)
// ─────────────────────────────────────────────
async function consultarIndicioSinistro(placa) {
  const placaLimpa = normalizarPlaca(placa);
  const data = await chamar('/indiciosinistroveicular', {
    IdConsulta: novoIdConsulta(),
    Placa: placaLimpa
  }, 'Credify IndicioSinistroVeicular');
  if (data.erro) return data;

  const r = extrairBloco(data, 'INDICIOSINISTROVEICULAR', 'INDICIOSINISTRO') || {};
  const indicio = String(r.INDICIO_SINISTRO || r.indicio || r.SINISTRO || '').toUpperCase();
  const temIndicio = /SIM|TRUE|1|S/.test(indicio);

  return {
    disponivel: true,
    placa: placaLimpa,
    tem_indicio: temIndicio,
    nivel: r.NIVEL || r.nivel || (temIndicio ? 'POSITIVO' : 'NEGATIVO'),
    descricao: r.DESCRICAO || r.descricao || (temIndicio
      ? 'Indício de sinistro identificado — investigar laudo, leilão, recuperação de seguradora.'
      : 'Sem indício de sinistro registrado.'),
    raw: r,
    fonte: 'Credify IndicioSinistroVeicular',
    consultado_em: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────
// 7. VeiculoTotal — pacote único Credify (R$ 31,27)
//    Retorna TUDO em uma chamada: dados + gravame + restrições + multas +
//    histórico + roubo/furto + leilão + indício de sinistro.
// ─────────────────────────────────────────────
async function consultarVeiculoTotal(placa) {
  const placaLimpa = normalizarPlaca(placa);
  const data = await chamar('/veiculototal', {
    IdConsulta: novoIdConsulta(),
    Placa: placaLimpa
  }, 'Credify VeiculoTotal');
  if (data.erro) return data;

  const r = extrairBloco(data, 'VEICULOTOTAL', 'VEICULO_TOTAL') || {};
  const status = statusResposta(data);

  // Cada bloco interno pode vir com chave diferente — normalizamos defensivamente.
  function pick(obj, ...keys) {
    if (!obj) return undefined;
    for (const k of keys) {
      if (obj[k] !== undefined) return obj[k];
      if (obj[k.toUpperCase()] !== undefined) return obj[k.toUpperCase()];
      if (obj[k.toLowerCase()] !== undefined) return obj[k.toLowerCase()];
    }
    return undefined;
  }

  // Dados básicos
  const veiculo = {
    placa: pick(r, 'PLACA', 'placa') || placaLimpa,
    marca: pick(r, 'MARCA', 'marca') || '',
    modelo: pick(r, 'MODELO', 'modelo') || '',
    ano_fabricacao: pick(r, 'ANO_FABRICACAO', 'anoFabricacao') || '',
    ano_modelo: pick(r, 'ANO_MODELO', 'anoModelo') || '',
    cor: pick(r, 'COR', 'cor') || '',
    combustivel: pick(r, 'COMBUSTIVEL', 'combustivel') || '',
    chassi: pick(r, 'CHASSI', 'chassi') || '',
    renavam: pick(r, 'RENAVAM', 'renavam') || '',
    municipio: pick(r, 'MUNICIPIO', 'municipio') || '',
    uf: pick(r, 'UF', 'uf') || '',
    tipo_veiculo: pick(r, 'TIPO', 'tipo') || '',
    situacao: pick(r, 'SITUACAO', 'situacao') || ''
  };
  veiculo.marca_modelo = [veiculo.marca, veiculo.modelo].filter(Boolean).join(' ');

  // Subblocos (a Credify devolve cada um sob chave específica).
  const gravameBloco = pick(r, 'GRAVAME') || {};
  const renajudBloco = pick(r, 'RENAJUD') || {};
  const renainfBloco = pick(r, 'RENAINF') || {};
  const historicoBloco = pick(r, 'HISTORICOPROPRIETARIO', 'VEICULOPROPRIETARIOPLACA') || {};
  const sinistroBloco = pick(r, 'INDICIOSINISTROVEICULAR', 'INDICIOSINISTRO') || {};
  const rouboBloco = pick(r, 'HISTORICOROUBOFURTO', 'ROUBOFURTO') || {};
  const leilaoBloco = pick(r, 'LEILAOCONJUGADO', 'LEILAO') || {};

  function listaRegistros(bloco) {
    return Object.keys(bloco || {})
      .filter(k => /^REGISTRO_\d+$/i.test(k))
      .sort((a, b) => parseInt(a.split('_')[1], 10) - parseInt(b.split('_')[1], 10))
      .map(k => bloco[k])
      .filter(x => x && typeof x === 'object');
  }

  const gravame = (() => {
    const tem = !!(pick(gravameBloco, 'AGENTE_FINANCEIRO', 'agente_financeiro') || pick(gravameBloco, 'CONTRATO', 'contrato'));
    return {
      tem_gravame: tem,
      status: tem ? 'COM GRAVAME' : 'LIVRE',
      agente_financeiro: pick(gravameBloco, 'AGENTE_FINANCEIRO', 'agente_financeiro') || '',
      contrato: pick(gravameBloco, 'CONTRATO', 'contrato') || '',
      data_inclusao: pick(gravameBloco, 'DATA_INCLUSAO', 'data_inclusao') || '',
      tipo_restricao: pick(gravameBloco, 'TIPO_RESTRICAO', 'tipo_restricao') || ''
    };
  })();

  const restricoesJud = listaRegistros(renajudBloco).map(x => ({
    tribunal: pick(x, 'ORGAO_JUDICIAL', 'tribunal') || '',
    processo: pick(x, 'PROCESSO', 'processo') || '',
    data: pick(x, 'DATA_INCLUSAO', 'data') || '',
    tipo_restricao: pick(x, 'TIPO_RESTRICAO', 'tipo_restricao') || '',
    detalhe: pick(x, 'DETALHE', 'detalhe') || ''
  }));

  const multas = listaRegistros(renainfBloco).map(m => ({
    auto: pick(m, 'AUTO_INFRACAO', 'auto') || '',
    orgao: pick(m, 'ORGAO_AUTUADOR', 'orgao') || '',
    data: pick(m, 'DATA_INFRACAO', 'data') || '',
    local: pick(m, 'LOCAL_INFRACAO', 'local') || '',
    infracao: pick(m, 'INFRACAO', 'infracao') || '',
    valor: Number(String(pick(m, 'VALOR', 'valor') || '0').replace(',', '.')) || 0,
    situacao: pick(m, 'SITUACAO', 'situacao') || ''
  }));

  const proprietarios = listaRegistros(historicoBloco).map(p => {
    const doc = String(pick(p, 'DOCUMENTO', 'documento') || '').replace(/\D/g, '');
    return {
      documento_mascarado: doc ? (doc.length === 14 ? `**.***.***/****-${doc.slice(-2)}` : `***.***.***-${doc.slice(-2)}`) : '',
      tipo_documento: doc.length === 14 ? 'CNPJ' : (doc.length === 11 ? 'CPF' : ''),
      nome: pick(p, 'NOME_PROPRIETARIO', 'nome') || '',
      exercicio: String(pick(p, 'ANO_EXERCICIO', 'exercicio') || '').trim(),
      data_pagamento: pick(p, 'DATA_PROCESSAMENTO', 'data_pagamento') || '',
      uf: pick(p, 'UF_DUT', 'uf') || ''
    };
  });
  proprietarios.sort((a, b) => (parseInt(b.exercicio, 10) || 0) - (parseInt(a.exercicio, 10) || 0));

  const indicioSinistroFlag = String(pick(sinistroBloco, 'INDICIO_SINISTRO', 'indicio') || '').toUpperCase();
  const sinistro = {
    tem_indicio: /SIM|TRUE|1|S/.test(indicioSinistroFlag),
    nivel: pick(sinistroBloco, 'NIVEL', 'nivel') || '',
    descricao: pick(sinistroBloco, 'DESCRICAO', 'descricao') || ''
  };

  const rouboFlag = String(pick(rouboBloco, 'INDICADOR_ROUBO_FURTO', 'situacao', 'STATUS') || '').toUpperCase();
  const rouboFurto = {
    tem_registro: /SIM|TRUE|1|S|POSITIV/.test(rouboFlag) || (Array.isArray(rouboBloco) && rouboBloco.length > 0),
    detalhe: pick(rouboBloco, 'DESCRICAO', 'detalhe', 'OBSERVACAO') || ''
  };

  const leilaoFlag = String(pick(leilaoBloco, 'INDICADOR_LEILAO', 'situacao', 'STATUS') || '').toUpperCase();
  const leilao = {
    tem_registro: /SIM|TRUE|1|S|POSITIV/.test(leilaoFlag),
    detalhe: pick(leilaoBloco, 'DESCRICAO', 'detalhe', 'OBSERVACAO') || ''
  };

  return {
    disponivel: true,
    placa: placaLimpa,
    veiculo,
    gravame,
    restricoes_judiciais: restricoesJud,
    multas,
    proprietarios,
    sinistro,
    roubo_furto: rouboFurto,
    leilao,
    descricao_api: status.descricao || '',
    raw: r,
    fonte: 'Credify VeiculoTotal',
    consultado_em: new Date().toISOString()
  };
}

module.exports = {
  normalizarPlaca,
  placaValida,
  consultarVeicularBNacionalOnLine,
  consultarGravame,
  consultarRenainf,
  consultarRenajud,
  consultarHistoricoProprietarios,
  consultarIndicioSinistro,
  consultarVeiculoTotal
};
