// services/monitorApi.js
// Rastreia falhas operacionais de APIs externas (saldo, token, quota) em memória + arquivo.
// Fornece status consolidado para o painel admin e aciona alertas por email quando detecta falha.
//
// Não depende de endpoint de saldo da DirectData (que não existe publicamente): usa a própria
// resposta de erro das chamadas regulares para inferir que o saldo/token falhou.

const fs = require('fs');
const path = require('path');
const storagePaths = require('./storage_paths');

// BUG #2: respeita DATA_DIR (Railway Volume) com fallback ./data em dev.
const LOG_DIR = storagePaths.DATA_DIR;
const LOG_FILE = path.join(LOG_DIR, 'monitor_api.json');
const COOLDOWN_ALERTA_MS = 6 * 60 * 60 * 1000; // 6h entre alertas para não spammar
const JANELA_STATUS_MS = 60 * 60 * 1000; // 1h para considerar falha como "recente"
const MAX_ENTRADAS_HISTORICO = 200; // rotaciona histórico

// Garante diretório
function garantirDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}

function carregar() {
  try {
    if (!fs.existsSync(LOG_FILE)) return { historico: [], ultimo_alerta_por_api: {} };
    const raw = fs.readFileSync(LOG_FILE, 'utf-8');
    const d = JSON.parse(raw);
    return {
      historico: Array.isArray(d.historico) ? d.historico : [],
      ultimo_alerta_por_api: d.ultimo_alerta_por_api || {}
    };
  } catch (_) {
    return { historico: [], ultimo_alerta_por_api: {} };
  }
}

function salvar(estado) {
  try {
    garantirDir();
    // Rotaciona histórico
    if (estado.historico.length > MAX_ENTRADAS_HISTORICO) {
      estado.historico = estado.historico.slice(-MAX_ENTRADAS_HISTORICO);
    }
    fs.writeFileSync(LOG_FILE, JSON.stringify(estado, null, 2));
  } catch (e) {
    console.error('[monitorApi] Falha ao salvar:', e.message);
  }
}

/**
 * Registra uma falha de API. Chamado por services/consultas.js → logarFalhaAPI.
 * @param {string} origem - ex: 'Direct Data PF', 'Score', 'Vinculos'
 * @param {object} falha - { categoria, etiqueta, mensagem } vindo de classificarErroAPI
 */
function registrarFalha(origem, falha) {
  if (!falha || !falha.categoria) return;
  // Só persiste falhas operacionais críticas (saldo/token/quota). Outras (timeout/sem_dados)
  // são ruído normal e não devem gerar alerta.
  const criticas = ['saldo', 'token', 'quota'];
  if (!criticas.includes(falha.categoria)) return;

  const estado = carregar();
  estado.historico.push({
    ts: new Date().toISOString(),
    origem,
    categoria: falha.categoria,
    etiqueta: falha.etiqueta,
    mensagem: String(falha.mensagem || '').slice(0, 200)
  });
  salvar(estado);

  // Dispara alerta (fire-and-forget) respeitando cooldown por (origem+categoria)
  const chave = `${origem}::${falha.categoria}`;
  const ultimo = estado.ultimo_alerta_por_api[chave] ? new Date(estado.ultimo_alerta_por_api[chave]).getTime() : 0;
  if (Date.now() - ultimo > COOLDOWN_ALERTA_MS) {
    estado.ultimo_alerta_por_api[chave] = new Date().toISOString();
    salvar(estado);
    _disparar_alerta(origem, falha).catch(e => console.error('[monitorApi] Alerta falhou:', e.message));
  }
}

/**
 * Status consolidado para /api/admin/status-apis.
 * Retorna { status, alertas, historico_recente, ultimas_24h, counts_por_categoria }
 */
function obterStatus() {
  const estado = carregar();
  const agora = Date.now();
  const recentes = estado.historico.filter(h => (agora - new Date(h.ts).getTime()) < JANELA_STATUS_MS);
  const ultimas24h = estado.historico.filter(h => (agora - new Date(h.ts).getTime()) < 24 * 60 * 60 * 1000);

  // Conta por categoria nas últimas 24h
  const counts = {};
  ultimas24h.forEach(h => { counts[h.categoria] = (counts[h.categoria] || 0) + 1; });

  // Classifica status geral
  let status = 'ok';
  const alertas = [];
  if (recentes.some(h => h.categoria === 'saldo')) {
    status = 'critico';
    alertas.push({
      nivel: 'critico',
      titulo: 'Saldo insuficiente em provedor de dados',
      descricao: 'Uma ou mais APIs recusaram consultas por saldo insuficiente na última hora. Recarregue o saldo para restabelecer os dossiês completos.',
      acao: 'Acesse app.directd.com.br e faça a recarga.',
      origens: [...new Set(recentes.filter(h => h.categoria === 'saldo').map(h => h.origem))]
    });
  }
  if (recentes.some(h => h.categoria === 'token')) {
    status = status === 'critico' ? 'critico' : 'critico';
    alertas.push({
      nivel: 'critico',
      titulo: 'Token de API recusado',
      descricao: 'Uma ou mais APIs recusaram o token de autenticação. O token pode ter sido revogado ou expirou.',
      acao: 'Atualize a variável DIRECTD_TOKEN (ou equivalente) no Railway.',
      origens: [...new Set(recentes.filter(h => h.categoria === 'token').map(h => h.origem))]
    });
  }
  if (recentes.some(h => h.categoria === 'quota')) {
    if (status === 'ok') status = 'alerta';
    alertas.push({
      nivel: 'alerta',
      titulo: 'Limite de requisições atingido',
      descricao: 'Uma ou mais APIs atingiram o limite diário/mensal de requisições.',
      acao: 'Aguarde o reset da quota ou contrate um plano maior.',
      origens: [...new Set(recentes.filter(h => h.categoria === 'quota').map(h => h.origem))]
    });
  }

  // Se não há falha recente mas houve falha nas últimas 24h, marca como "alerta informativo"
  if (status === 'ok' && ultimas24h.length > 0) {
    status = 'alerta';
    alertas.push({
      nivel: 'info',
      titulo: 'Falhas resolvidas recentemente',
      descricao: `Houve ${ultimas24h.length} falha(s) crítica(s) de API nas últimas 24h. Nenhuma falha na última hora (aparentemente resolvida).`,
      acao: 'Monitore o painel de uso das APIs para confirmar.',
      origens: [...new Set(ultimas24h.map(h => h.origem))]
    });
  }

  return {
    status,
    verificado_em: new Date().toISOString(),
    alertas,
    historico_recente: recentes.slice(-20),
    contagem_ultimas_24h: counts,
    total_historico: estado.historico.length
  };
}

/**
 * Limpa o histórico (endpoint admin de reset).
 */
function limpar() {
  salvar({ historico: [], ultimo_alerta_por_api: {} });
}

// ─────────────────────────────────────────────────────────────
// DISPARO DE ALERTAS
// ─────────────────────────────────────────────────────────────

async function _disparar_alerta(origem, falha) {
  const msg = `[ALERTA RASTREIA] ${falha.etiqueta} em ${origem}\n\n${falha.mensagem}\n\nHorário: ${new Date().toISOString()}\n\nAcesse https://rastreia-production.up.railway.app/api/admin/status-apis para mais detalhes.`;

  // 1) Log destacado no console (Railway captura)
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error(`  ALERTA CRÍTICO: ${falha.etiqueta}`);
  console.error(`  API: ${origem}`);
  console.error(`  Mensagem: ${falha.mensagem}`);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 2) WhatsApp via Evolution API (se configurado)
  const adminWpp = process.env.ADMIN_WPP_ALERTAS;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const evolutionInstance = process.env.EVOLUTION_API_INSTANCE;
  if (adminWpp && evolutionKey && evolutionUrl && evolutionInstance) {
    try {
      const axios = require('axios');
      await axios.post(
        `${evolutionUrl}/message/sendText/${evolutionInstance}`,
        { number: adminWpp, text: msg },
        { headers: { apikey: evolutionKey }, timeout: 10000 }
      );
      console.log('[monitorApi] Alerta enviado por WhatsApp para', adminWpp);
    } catch (e) {
      console.error('[monitorApi] Falha ao enviar WhatsApp:', e.response?.status || e.message);
    }
  }

  // 3) Email via SendGrid/Resend (se configurado — não implementado ainda, fica hook)
  //    Placeholder para quando o user adicionar SENDGRID_API_KEY ou RESEND_API_KEY
}

module.exports = {
  registrarFalha,
  obterStatus,
  limpar
};
