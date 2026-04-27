/**
 * services/pdf/dossie_pf.js
 * Dossiê Pessoa Física (R$ 197) — padrão ouro.
 */

const chrome = require('./chrome');
const {
  secaoCadastralPF, secaoProcessos, secaoListasNegras,
  secaoScoreCredito, secaoProtestos, secaoVinculosSocietarios,
  secaoChecklist, secaoParecerAnalista, secaoPerfilFinanceiroPF
} = require('./sections');

function render(doc, pedido, dados, score, checklist, produto) {
  let y = chrome.cabecalho(doc, pedido, produto);
  y = chrome.resumoExecutivo(doc, y, score);
  y = chrome.blocoAlvo(doc, y, pedido);
  y = chrome.blocoAlertasDetalhados(doc, y, score);
  y = chrome.blocoComposicaoScore(doc, y, score);
  y = chrome.blocoHistoricoScores(doc, y, dados, pedido, score);

  y = secaoCadastralPF(doc, y, dados);
  y = secaoProcessos(doc, y, dados, pedido);
  y = secaoListasNegras(doc, y, dados);
  y = secaoScoreCredito(doc, y, dados);
  y = secaoProtestos(doc, y, dados);
  y = secaoPerfilFinanceiroPF(doc, y, dados);
  y = secaoVinculosSocietarios(doc, y, dados);
  y = secaoChecklist(doc, y, checklist);
  y = secaoParecerAnalista(doc, y, pedido);

  chrome.blocoFinal(doc, y);
}

module.exports = { render };
