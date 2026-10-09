/**
 * services/pdf/index.js
 *
 * Ponto de entrada do gerador de dossiês. Mesma assinatura e contrato
 * do antigo services/pdf.js para não quebrar server.js e routes/pedidos.js:
 *
 *   gerarDossie(pedido, dadosDB) => Promise<{
 *     filepath, filename, url, score
 *   }>
 *
 * Despacha por `pedido.tipo` para o módulo correto. Se o tipo não tiver
 * módulo dedicado, cai no dossiê PF como fallback seguro (mantém o
 * comportamento do pdf.js original que aplicava o template PF/PJ genérico).
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { PRODUTOS, calcularScore, gerarChecklist, sugerirProximoDegrau } = require('../produtos');
const storagePaths = require('../storage_paths');

const renderers = {
  dossie_pf: require('./dossie_pf').render,
  dossie_pj: require('./dossie_pj').render,
  dossie_pj_socios: require('./dossie_pj_socios').render,
  due_diligence: require('./due_diligence').render,
  due_diligence_imobiliaria: require('./due_diligence_imobiliaria').render,
  investigacao_patrimonial: require('./investigacao_patrimonial').render,
  analise_devedor: require('./analise_devedor').render,
  analise_inquilino: require('./analise_inquilino').render,
  capacidade_compra: require('./capacidade_compra').render,
  checagem_vendedor: require('./checagem_vendedor').render,
  consulta_veicular: require('./consulta_veicular').render,
  // Pacotes veiculares pela Direct Data (a Credify saiu em 09/10/2026)
  consulta_veicular_simples: require('./consulta_veicular_dd').render,
  consulta_veicular_mediana: require('./consulta_veicular_dd').render,
  consulta_veicular_completa: require('./consulta_veicular_dd').render,
  consulta_restricoes: require('./consulta_restricoes').render,
};

const TIPOS_VEICULAR_PACOTES = new Set([
  'consulta_veicular_simples',
  'consulta_veicular_mediana',
  'consulta_veicular_completa'
]);

function montarDados(dadosDB) {
  const dados = {};
  (dadosDB || []).forEach(d => {
    try { dados[d.fonte] = typeof d.dados === 'string' ? JSON.parse(d.dados) : d.dados; }
    catch { dados[d.fonte] = d.dados || {}; }
  });
  return dados;
}

function gerarDossie(pedido, dadosDB) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const filename = `rastreia_${pedido.tipo}_${pedido.id.substring(0, 8)}_${Date.now()}.pdf`;
      // BUG #2: usa RELATORIOS_DIR (Railway Volume) com fallback ./public/relatorios em dev.
      const dirRelatorios = storagePaths.RELATORIOS_DIR;
      storagePaths.garantirDiretorio(dirRelatorios);
      const filepath = path.join(dirRelatorios, filename);
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      const dados = montarDados(dadosDB);
      const produto = PRODUTOS[pedido.tipo] || {};

      // Consulta veicular não calcula score geral — próprio renderer lida
      let score, checklist;
      if (pedido.tipo === 'consulta_veicular' || pedido.tipo === 'consulta_restricoes' || TIPOS_VEICULAR_PACOTES.has(pedido.tipo)) {
        score = { score: '-', classificacao: '-', alertas: [], contribuicoes: [] };
        checklist = [];
      } else {
        // PJ + Sócios usa as mesmas regras de score/checklist do Dossiê PJ
        const tipoRegra = pedido.tipo === 'dossie_pj_socios' ? 'dossie_pj' : pedido.tipo;
        score = calcularScore(tipoRegra, dados);
        checklist = gerarChecklist(tipoRegra, dados);
      }

      // Próximo degrau da escada: chrome.blocoFinal desenha antes do aviso LGPD
      try { doc.__proximoDegrau = sugerirProximoDegrau(pedido.tipo, dados, pedido.alvo_tipo); } catch (_) { doc.__proximoDegrau = null; }

      // Despacho
      const renderFn = renderers[pedido.tipo] || renderers.dossie_pf;
      renderFn(doc, pedido, dados, score, checklist, produto);

      doc.end();
      stream.on('finish', () => {
        // Consulta veicular mantém contrato antigo { path, url } pra compat;
        // o resto mantém { filepath, filename, url, score }.
        if (pedido.tipo === 'consulta_veicular' || TIPOS_VEICULAR_PACOTES.has(pedido.tipo)) {
          resolve({ path: filepath, filepath, filename, url: `/relatorios/${filename}` });
        } else {
          resolve({
            filepath,
            filename,
            url: `/relatorios/${filename}`,
            score: score && typeof score.valor !== 'undefined' ? {
              valor: score.valor,
              classificacao: score.classificacao || null
            } : null
          });
        }
      });
      stream.on('error', reject);
    } catch (e) {
      console.error('[PDF] Erro ao gerar PDF:', e.message, e.stack);
      reject(e);
    }
  });
}

module.exports = { gerarDossie };
