/**
 * services/pdf/dossie_pj.js
 * Dossiê Pessoa Jurídica (R$ 397).
 *
 * Refino frente ao template antigo:
 *  - REGIME TRIBUTÁRIO como bloco próprio (Simples/MEI/Lucro).
 *  - LISTAS NEGRAS DETALHADAS (CEIS + CNEP + CEPIM separados).
 *  - Mantém processos, protestos, vínculos e checklist.
 */

const chrome = require('./chrome');
const {
  secaoCadastralPJ, secaoRegimeTributario,
  secaoProcessos, secaoListasNegrasDetalhadas,
  secaoProtestos, secaoVinculosSocietarios,
  secaoChecklist, secaoParecerAnalista
} = require('./sections');
const { secao, linha, boxEmIntegracao, COR, MARGEM, LARGURA, verificarPagina } = require('./helpers');

// Situação fiscal resumida (CND/FGTS/PGFN) — quando Credify entregar, substituir
function secaoSituacaoFiscalPJ(doc, y, dados) {
  const cadastral = dados.receita_federal || {};
  y = secao(doc, 'SITUAÇÃO FISCAL E REGULARIDADE', y);
  y = linha(doc, 'Situacao RF', cadastral.situacao || '-', y, 13);
  y = linha(doc, 'Divida Ativa PGFN', dados.pgfn?.status || 'Em integração (Credify)', y, 13);
  y = linha(doc, 'Regularidade FGTS', dados.fgts?.status || 'Em integração (Credify)', y, 13);
  y = linha(doc, 'Debitos Estaduais', dados.debitos_estaduais?.status || 'Em integração (Credify)', y, 13);
  return y + 4;
}

// Faturamento presumido (quando Credify entregar)
function secaoFaturamentoPresumido(doc, y, dados) {
  const fat = dados.faturamento_presumido || {};
  if (fat.valor) {
    y = secao(doc, 'FATURAMENTO PRESUMIDO', y);
    y = linha(doc, 'Faixa', fat.faixa || '-', y, 13);
    y = linha(doc, 'Valor', fat.valor_formatado || `R$ ${Number(fat.valor).toLocaleString('pt-BR')}`, y, 13);
    if (fat.fonte) {
      doc.fillColor(COR.cinza).fontSize(6).font('Helvetica').text(`Fonte: ${fat.fonte}`, MARGEM, y);
      y += 10;
    }
    return y + 4;
  }
  return boxEmIntegracao(doc, y,
    'FATURAMENTO PRESUMIDO — Em integração',
    'Será disponibilizado via Credify no próximo release (endpoint /faturamentopresumidopjcredify).'
  );
}

function render(doc, pedido, dados, score, checklist, produto) {
  let y = chrome.cabecalho(doc, pedido, produto);
  y = chrome.resumoExecutivo(doc, y, score);
  y = chrome.blocoAlvo(doc, y, pedido);
  y = chrome.blocoAlertasDetalhados(doc, y, score);
  y = chrome.blocoComposicaoScore(doc, y, score);
  y = chrome.blocoHistoricoScores(doc, y, dados, pedido, score);

  y = secaoCadastralPJ(doc, y, dados);
  y = secaoRegimeTributario(doc, y, dados);
  y = secaoSituacaoFiscalPJ(doc, y, dados);
  y = secaoFaturamentoPresumido(doc, y, dados);
  y = secaoProcessos(doc, y, dados, pedido);
  y = secaoListasNegrasDetalhadas(doc, y, dados);
  y = secaoProtestos(doc, y, dados);
  y = secaoVinculosSocietarios(doc, y, dados);
  y = secaoChecklist(doc, y, checklist);
  y = secaoParecerAnalista(doc, y, pedido);

  chrome.blocoFinal(doc, y);
}

module.exports = { render };
