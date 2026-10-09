/**
 * PDF — Dossiê PJ + Sócios (R$ 189): "posso fechar com essa empresa —
 * e quem está por trás dela?"
 * Tudo do Dossiê PJ + certidão Receita/PGFN + grupo econômico + mini-dossiê
 * de até 5 sócios (score, processos, dívidas) logo após o cadastro.
 */
const chrome = require('./chrome');
const {
  secaoCadastralPJ, secaoRegimeTributario, secaoProcessos, secaoListasNegrasDetalhadas,
  secaoProtestos, secaoVinculosSocietarios, secaoChecklist, secaoParecerAnalista
} = require('./sections');
const { secaoSituacaoFiscalPJ } = require('./dossie_pj');
const { secaoAnaliseSocios } = require('./due_diligence');
const { COR, MARGEM, LARGURA, verificarPagina } = require('./helpers');

function render(doc, pedido, dados, score, checklist, produto) {
  let y = chrome.cabecalho(doc, pedido, produto);
  y = chrome.resumoExecutivo(doc, y, score);
  y = chrome.blocoAlvo(doc, y, pedido);
  y = chrome.blocoAlertasDetalhados(doc, y, score);

  y = secaoCadastralPJ(doc, y, dados);
  y = secaoAnaliseSocios(doc, y, dados);
  const total = (dados.receita_federal?.socios || []).length;
  const analisados = (dados.socios_enriquecidos || []).filter(s => s && s.tem_cpf).length;
  if (total > 5) {
    y = verificarPagina(doc, y, 14);
    doc.fillColor(COR.cinza).fontSize(7.5).font('Helvetica')
      .text(`Mini-dossiê dos 5 primeiros sócios (${analisados} com CPF localizado) de ${total}. A Due Diligence Empresarial analisa todos.`, MARGEM, y, { width: LARGURA });
    y += 12;
  }
  y = secaoVinculosSocietarios(doc, y, dados);
  y = secaoRegimeTributario(doc, y, dados);
  y = secaoSituacaoFiscalPJ(doc, y, dados);
  y = secaoProcessos(doc, y, dados, pedido);
  y = secaoListasNegrasDetalhadas(doc, y, dados);
  y = secaoProtestos(doc, y, dados);
  y = secaoChecklist(doc, y, checklist);
  y = secaoParecerAnalista(doc, y, pedido);

  chrome.blocoFinal(doc, y);
}

module.exports = { render };
