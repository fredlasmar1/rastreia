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

// Situação fiscal: certidão conjunta Receita/PGFN pela Direct Data. Linhas sem
// fonte não aparecem (antes diziam "Em integração (Credify)").
function secaoSituacaoFiscalPJ(doc, y, dados) {
  const cadastral = dados.receita_federal || {};
  const ccd = dados.certidao_conjunta;
  y = secao(doc, 'SITUAÇÃO FISCAL E REGULARIDADE', y);
  y = linha(doc, 'Situação RF', cadastral.situacao || '-', y, 13);
  if (ccd) {
    const txt = ccd.disponivel === false ? `não respondeu${ccd.erro ? ` (${ccd.erro})` : ''}`
      : (ccd.positiva ? `POSITIVA — há débitos${ccd.dividas?.length ? `: ${ccd.dividas.slice(0, 2).join('; ')}` : ''}` : 'Negativa (sem débitos)');
    y = linha(doc, 'Receita Federal / PGFN', txt, y, 13);
    if (ccd.comprovante) {
      doc.fillColor(COR.azul).fontSize(7.5).font('Helvetica').text('Comprovante oficial da certidão', MARGEM + 4, y, { link: ccd.comprovante, underline: true });
      y += 11;
    }
  }
  if (dados.pgfn?.status) y = linha(doc, 'Dívida Ativa PGFN', dados.pgfn.status, y, 13);
  if (dados.fgts?.status) y = linha(doc, 'Regularidade FGTS', dados.fgts.status, y, 13);
  if (dados.debitos_estaduais?.status) y = linha(doc, 'Débitos Estaduais', dados.debitos_estaduais.status, y, 13);
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
  return y; // sem fonte de faturamento: a seção não aparece
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

module.exports = { render, secaoSituacaoFiscalPJ };
