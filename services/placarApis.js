// services/placarApis.js
//
// Placar de saúde das APIs externas para o dashboard admin.
//
// Combina TRÊS fontes para classificar cada provedor de forma semântica
// (operante / sem_credito / limite / token_invalido / fora_do_ar / nao_configurada):
//
//  1. Probe ativo GRÁTIS (auto):     APIs cujo health-check não custa nada
//     (Credify /auth, Escavador /usuario, Datajud, Transparência, Mercado Pago).
//     Rodam automaticamente quando o cache passa do TTL.
//
//  2. Probe ativo PAGO (manual):     DirectData e CNPJá — consomem 1 consulta.
//     Só rodam quando o admin clica "Testar agora" (montarPlacar incluirPagas=true).
//
//  3. Monitor passivo (uso real):    falhas registradas pelas consultas reais dos
//     operadores (services/monitorApi). Uma falha de saldo/token/quota na última
//     hora SEMPRE vence o status do probe — reflete o que está acontecendo de fato.
//
// O resultado é cacheado em DATA_DIR/placar_apis.json para não re-rodar probes a
// cada load do dashboard.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const storagePaths = require('./storage_paths');
const monitorApi = require('./monitorApi');

const CACHE_FILE = path.join(storagePaths.DATA_DIR, 'placar_apis.json');
const TTL_GRATIS_MS = 5 * 60 * 1000; // re-roda os probes grátis se o cache estiver mais velho que isso

// Documentos públicos/de teste usados nos probes.
const CNPJ_TESTE = '00000000000191'; // Banco do Brasil (CNPJ público válido)
const CPF_TESTE = '11144477735';     // CPF de teste com dígito verificador válido

// ──────────────────────────────────────────────────────────────
// Cache
// ──────────────────────────────────────────────────────────────
function carregarCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return { apis: {}, geral_em: null, incluiu_pagas: false };
    const d = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    return { apis: d.apis || {}, geral_em: d.geral_em || null, incluiu_pagas: !!d.incluiu_pagas };
  } catch (_) {
    return { apis: {}, geral_em: null, incluiu_pagas: false };
  }
}

function salvarCache(cache) {
  try {
    fs.mkdirSync(storagePaths.DATA_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[placarApis] Falha ao salvar cache:', e.message);
  }
}

// ──────────────────────────────────────────────────────────────
// Classificador genérico de erro HTTP → status semântico
// ──────────────────────────────────────────────────────────────
function temSaldoInsuficiente(body) {
  return /saldo\s*(insuficient|zero|negativ)|sem\s+saldo|cr[eé]dito.*insuficient|pagamento\s+pendent|recarg/i.test(body);
}

function classificarHttp(e, nome) {
  if (!e.response) {
    return { status: 'fora_do_ar', motivo: 'Sem resposta do servidor', detalhe: String(e.message || '').slice(0, 160) };
  }
  const status = e.response.status;
  const body = JSON.stringify(e.response.data || '').toLowerCase();
  if (status === 402 || temSaldoInsuficiente(body)) return { status: 'sem_credito', motivo: 'Saldo insuficiente' };
  if (status === 429) return { status: 'limite', motivo: 'Limite de requisições atingido' };
  if (status === 401) return { status: 'token_invalido', motivo: 'Token/credencial recusado' };
  if (status === 403) return { status: 'token_invalido', motivo: 'Acesso negado' };
  if (status >= 500) return { status: 'fora_do_ar', motivo: `Erro ${status} no provedor` };
  return { status: 'fora_do_ar', motivo: `HTTP ${status}`, detalhe: `${nome}` };
}

// ──────────────────────────────────────────────────────────────
// Probes individuais
// ──────────────────────────────────────────────────────────────
async function probarCredify() {
  if (!process.env.CREDIFY_CLIENT_ID || !process.env.CREDIFY_CLIENT_SECRET) {
    return { status: 'nao_configurada', motivo: 'CLIENT_ID/SECRET ausentes' };
  }
  try {
    const raw = process.env.CREDIFY_CLIENT_SECRET;
    const num = Number(raw);
    const secret = Number.isFinite(num) && String(num) === String(raw) ? num : raw;
    const r = await axios.post('https://api.credify.com.br/auth',
      { ClientID: process.env.CREDIFY_CLIENT_ID, ClientSecret: secret },
      { headers: { accept: 'application/json', 'content-type': 'application/json' }, timeout: 15000 });
    // A API devolve o status com typo ("Sucess"); o sinal real é o token vir preenchido.
    const tk = r.data?.Dados || r.data?.dados || r.data?.token || r.data?.Token;
    if (tk) return { status: 'operante', motivo: 'Autenticação OK' };
    return { status: 'token_invalido', motivo: r.data?.Message || 'Auth sem token' };
  } catch (e) { return classificarHttp(e, 'Credify'); }
}

async function probarEscavador() {
  if (!process.env.ESCAVADOR_API_KEY) return { status: 'nao_configurada', motivo: 'API key ausente' };
  try {
    const r = await axios.get('https://api.escavador.com/api/v2/usuario', {
      headers: { Authorization: `Bearer ${process.env.ESCAVADOR_API_KEY}`, Accept: 'application/json' },
      timeout: 20000, validateStatus: () => true
    });
    const body = JSON.stringify(r.data || '').toLowerCase();
    if (r.status === 200) return { status: 'operante', motivo: 'Autenticação OK' };
    if (r.status === 402 || temSaldoInsuficiente(body)) return { status: 'sem_credito', motivo: 'Créditos esgotados' };
    if (r.status === 429) return { status: 'limite', motivo: 'Limite de requisições atingido' };
    if (r.status === 401 || r.status === 403) return { status: 'token_invalido', motivo: 'Token recusado' };
    return { status: 'fora_do_ar', motivo: `HTTP ${r.status}` };
  } catch (e) { return classificarHttp(e, 'Escavador'); }
}

async function probarDatajud() {
  if (!process.env.DATAJUD_API_KEY) return { status: 'nao_configurada', motivo: 'API key ausente (opcional)' };
  try {
    const r = await axios.post('https://api-publica.datajud.cnj.jus.br/api_publica_tjgo/_search',
      { query: { match_all: {} }, size: 1 },
      { headers: { Authorization: `ApiKey ${process.env.DATAJUD_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000, validateStatus: () => true });
    if (r.status === 200) return { status: 'operante', motivo: 'Consulta OK (gratuito)' };
    if (r.status === 429) return { status: 'limite', motivo: 'Limite de requisições atingido' };
    if (r.status === 401 || r.status === 403) return { status: 'token_invalido', motivo: 'Key recusada' };
    return { status: 'fora_do_ar', motivo: `HTTP ${r.status}` };
  } catch (e) { return classificarHttp(e, 'Datajud'); }
}

async function probarTransparencia() {
  if (!process.env.TRANSPARENCIA_TOKEN) return { status: 'nao_configurada', motivo: 'Token ausente' };
  try {
    const r = await axios.get('https://api.portaldatransparencia.gov.br/api-de-dados/ceis', {
      params: { pagina: 1 }, headers: { 'chave-api-dados': process.env.TRANSPARENCIA_TOKEN }, timeout: 15000, validateStatus: () => true
    });
    if (r.status === 200) return { status: 'operante', motivo: 'Consulta OK (gratuito)' };
    if (r.status === 429) return { status: 'limite', motivo: 'Limite de requisições atingido' };
    if (r.status === 401 || r.status === 403) return { status: 'token_invalido', motivo: 'Token recusado' };
    return { status: 'fora_do_ar', motivo: `HTTP ${r.status}` };
  } catch (e) { return classificarHttp(e, 'Transparência'); }
}

async function probarMercadoPago() {
  const tok = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN;
  if (!tok) return { status: 'nao_configurada', motivo: 'Token ausente' };
  try {
    const r = await axios.get('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${tok}` }, timeout: 12000, validateStatus: () => true
    });
    if (r.status === 200) return { status: 'operante', motivo: 'Conta ' + (r.data?.nickname || 'OK') };
    if (r.status === 401) return { status: 'token_invalido', motivo: 'Token recusado' };
    return { status: 'fora_do_ar', motivo: `HTTP ${r.status}` };
  } catch (e) { return classificarHttp(e, 'Mercado Pago'); }
}

// Pago: consome 1 consulta. Só roda no "Testar agora".
async function probarDirectD() {
  if (!process.env.DIRECTD_TOKEN) return { status: 'nao_configurada', motivo: 'Token ausente' };
  try {
    const r = await axios.get('https://apiv3.directd.com.br/api/CadastroPessoaFisicaPlus', {
      params: { Cpf: CPF_TESTE, Token: process.env.DIRECTD_TOKEN }, timeout: 25000, validateStatus: () => true
    });
    const body = JSON.stringify(r.data || '').toLowerCase();
    if (r.status === 402 || temSaldoInsuficiente(body)) return { status: 'sem_credito', motivo: 'Saldo insuficiente — recarregar' };
    if (r.status === 401) return { status: 'token_invalido', motivo: 'Token recusado' };
    if (r.status === 403) return temSaldoInsuficiente(body)
      ? { status: 'sem_credito', motivo: 'Saldo insuficiente — recarregar' }
      : { status: 'token_invalido', motivo: 'Acesso negado' };
    if (r.status === 429) return { status: 'limite', motivo: 'Limite de requisições atingido' };
    if (r.status >= 500) return { status: 'fora_do_ar', motivo: `Erro ${r.status} no provedor` };
    // 200 (dados) ou 400 (CPF de teste rejeitado) => conta com acesso/saldo OK.
    return { status: 'operante', motivo: 'Acesso e saldo OK' };
  } catch (e) { return classificarHttp(e, 'DirectData'); }
}

// Pago/limitado (tier grátis tem teto mensal). Só roda no "Testar agora".
async function probarCnpja() {
  if (!process.env.CNPJA_API_KEY) return { status: 'nao_configurada', motivo: 'API key ausente' };
  try {
    const r = await axios.get('https://api.cnpja.com/office/' + CNPJ_TESTE, {
      headers: { Authorization: process.env.CNPJA_API_KEY }, timeout: 15000, validateStatus: () => true
    });
    if (r.status === 200) return { status: 'operante', motivo: 'Consulta OK' };
    if (r.status === 429) return { status: 'limite', motivo: 'Limite/quota do plano atingido' };
    if (r.status === 401 || r.status === 403) return { status: 'token_invalido', motivo: 'Key recusada' };
    return { status: 'fora_do_ar', motivo: `HTTP ${r.status}` };
  } catch (e) { return classificarHttp(e, 'CNPJá'); }
}

// ──────────────────────────────────────────────────────────────
// Catálogo
//   auto:true  → probe grátis, roda no carregamento automático
//   auto:false → probe pago, só roda no "Testar agora"
//   probe:null → sem teste ativo; status vem do monitor passivo + env
// ──────────────────────────────────────────────────────────────
const CATALOGO = [
  { chave: 'directd',      nome: 'DirectData',     grupo: 'Dados cadastrais (PF)', auto: false, probe: probarDirectD,      link: 'https://app.directd.com.br' },
  { chave: 'credify',      nome: 'Credify',        grupo: 'Veicular',              auto: true,  probe: probarCredify },
  { chave: 'escavador',    nome: 'Escavador',      grupo: 'Processos',             auto: true,  probe: probarEscavador },
  { chave: 'datajud',      nome: 'Datajud CNJ',    grupo: 'Processos',             auto: true,  probe: probarDatajud },
  { chave: 'cnpja',        nome: 'CNPJá',          grupo: 'Dados cadastrais (PJ)', auto: false, probe: probarCnpja },
  { chave: 'transparencia',nome: 'Transparência',  grupo: 'Listas negras',         auto: true,  probe: probarTransparencia },
  { chave: 'infosimples',  nome: 'InfoSimples',    grupo: 'DETRAN / Certidões',    auto: false, probe: null, envVar: 'INFOSIMPLES_TOKEN' },
  { chave: 'mercadopago',  nome: 'Mercado Pago',   grupo: 'Pagamentos',            auto: true,  probe: probarMercadoPago },
  { chave: 'onr',          nome: 'ONR (imóveis)',  grupo: 'Imobiliário',           auto: false, probe: null, envVar: 'ONR_API_KEY' }
];

// ──────────────────────────────────────────────────────────────
// Overlay do monitor passivo (falhas reais recentes vencem)
// ──────────────────────────────────────────────────────────────
function origemParaChave(origem = '') {
  const o = String(origem).toLowerCase();
  if (/direct\s*data|directd|score|v[ií]nculo|negativ|nivelsocio|n[ií]vel|aml|[oó]bito|protesto|perfil\s*econ/.test(o)) return 'directd';
  if (/escavador/.test(o)) return 'escavador';
  if (/datajud/.test(o)) return 'datajud';
  if (/transpar/.test(o)) return 'transparencia';
  if (/cnpj[aá]/.test(o)) return 'cnpja';
  if (/infosimples|detran|sigef|\bcnd\b|fgts|inpi/.test(o)) return 'infosimples';
  if (/credify/.test(o)) return 'credify';
  return null;
}

const ROTULO_PASSIVO = { saldo: 'Sem crédito (visto em consulta real)', token: 'Token recusado em consulta real', quota: 'Limite atingido em consulta real' };
const CATEGORIA_PARA_STATUS = { saldo: 'sem_credito', token: 'token_invalido', quota: 'limite' };

function aplicarPassivo(apis) {
  let st;
  try { st = monitorApi.obterStatus(); } catch (_) { return; }
  const recentes = st.historico_recente || [];
  recentes.forEach(h => {
    const chave = origemParaChave(h.origem);
    if (!chave || !apis[chave]) return;
    const novo = CATEGORIA_PARA_STATUS[h.categoria];
    if (!novo) return;
    apis[chave] = {
      ...apis[chave],
      status: novo,
      motivo: ROTULO_PASSIVO[h.categoria],
      detalhe: String(h.mensagem || '').slice(0, 160),
      verificado_em: h.ts,
      fonte: 'uso_real'
    };
  });
}

// ──────────────────────────────────────────────────────────────
// Consolidação
// ──────────────────────────────────────────────────────────────
const SEVERIDADE = { fora_do_ar: 4, token_invalido: 4, sem_credito: 3, limite: 2, nao_configurada: 1, nao_testada: 1, operante: 0 };

function consolidar(cache) {
  const apis = CATALOGO.map(c => ({ chave: c.chave, nome: c.nome, grupo: c.grupo, link: c.link || null, auto: !!c.auto, ...(cache.apis[c.chave] || { status: 'nao_testada', motivo: 'Aguardando teste' }) }));
  let pior = 0;
  apis.forEach(a => { pior = Math.max(pior, SEVERIDADE[a.status] || 0); });
  let geral = 'operante';
  if (pior >= 4) geral = 'critico';
  else if (pior >= 3) geral = 'sem_credito';
  else if (pior >= 2) geral = 'atencao';
  return { geral, geral_em: cache.geral_em, incluiu_pagas: !!cache.incluiu_pagas, apis };
}

// ──────────────────────────────────────────────────────────────
// Montagem do placar (roda probes)
// ──────────────────────────────────────────────────────────────
async function montarPlacar({ incluirPagas = false } = {}) {
  const cache = carregarCache();
  cache.apis = cache.apis || {};
  const agoraISO = new Date().toISOString();

  await Promise.all(CATALOGO.map(async (api) => {
    let resultado = null;
    if (api.probe) {
      if (api.auto || incluirPagas) {
        try { resultado = await api.probe(); }
        catch (e) { resultado = { status: 'fora_do_ar', motivo: 'Erro ao testar', detalhe: String(e.message || '').slice(0, 160) }; }
        resultado.verificado_em = agoraISO;
        resultado.fonte = 'probe_ativo';
      }
    } else {
      const temEnv = api.envVar ? !!(process.env[api.envVar] && String(process.env[api.envVar]).trim()) : true;
      resultado = temEnv
        ? { status: 'operante', motivo: 'Configurada (sem teste ativo)', verificado_em: agoraISO, fonte: 'config' }
        : { status: 'nao_configurada', motivo: 'Não configurada', verificado_em: agoraISO, fonte: 'config' };
    }
    if (resultado) {
      cache.apis[api.chave] = { ...(cache.apis[api.chave] || {}), ...resultado };
    } else if (!cache.apis[api.chave]) {
      cache.apis[api.chave] = { status: 'nao_testada', motivo: 'Clique em “Testar agora”', fonte: 'inicial' };
    }
  }));

  aplicarPassivo(cache.apis);
  cache.geral_em = agoraISO;
  if (incluirPagas) cache.incluiu_pagas = true;
  salvarCache(cache);
  return consolidar(cache);
}

// ──────────────────────────────────────────────────────────────
// Leitura para o dashboard: usa cache; re-roda os grátis se estiver velho.
// ──────────────────────────────────────────────────────────────
async function obterPlacar({ forcarPagas = false } = {}) {
  if (forcarPagas) return montarPlacar({ incluirPagas: true });
  const cache = carregarCache();
  const idade = cache.geral_em ? (Date.now() - new Date(cache.geral_em).getTime()) : Infinity;
  if (idade > TTL_GRATIS_MS) return montarPlacar({ incluirPagas: false });
  // Cache fresco: só re-aplica o passivo (barato) e devolve.
  aplicarPassivo(cache.apis || {});
  salvarCache(cache);
  return consolidar(cache);
}

module.exports = { obterPlacar, montarPlacar };
