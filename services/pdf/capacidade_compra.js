/**
 * PDF — Capacidade de Compra ("esse cliente consegue comprar/financiar?")
 *   1. Veredito (COMPORTA / COMPORTA COM AJUSTE / TRAVA NO BANCO / FALTAM DADOS)
 *   2. A conta: parcela × renda, quanto financia, entrada e renda necessárias
 *   3. O que trava (dívidas com credores, protestos, score) e o que ajustar
 *   4. Dados do cliente
 * Regra: services/veredito_compra.js.
 */
const chrome = require('./chrome');
const { COR, MARGEM, LARGURA, secao, linha, verificarPagina } = require('./helpers');
const { secaoCadastralPF, secaoScoreCredito } = require('./sections');
const { avaliarCompra } = require('../veredito_compra');

const CORES = {
  COMPORTA: { fundo: '#dcfce7', texto: '#14532d' },
  COMPORTA_COM_AJUSTE: { fundo: '#ffedd5', texto: '#7c2d12' },
  TRAVA_NO_BANCO: { fundo: '#fee2e2', texto: '#7f1d1d' },
  FALTAM_DADOS: { fundo: '#e5e7eb', texto: '#1f2937' }
};
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function item(doc, y, txt, cor) {
  doc.font('Helvetica').fontSize(9);
  const h = doc.heightOfString('•  ' + txt, { width: LARGURA - 10 });
  y = verificarPagina(doc, y, h + 4);
  doc.fillColor(cor).text('•  ' + txt, MARGEM + 4, y, { width: LARGURA - 10 });
  return y + h + 3;
}

function render(doc, pedido, dados, score, checklist, produto) {
  const tipoBem = pedido.compra_tipo_bem === 'veiculo' ? 'veiculo' : 'imovel';
  const av = avaliarCompra({
    dados, tipoBem, valorBem: pedido.compra_valor, entrada: pedido.compra_entrada,
    prazoMeses: pedido.compra_prazo, rendaDeclarada: pedido.renda_declarada
  });
  const n = av.numeros;
  const c = CORES[av.veredito];

  let y = chrome.cabecalho(doc, pedido, produto);
  const altura = av.resumo ? 60 : 46;
  y = verificarPagina(doc, y + 4, altura + 6);
  doc.rect(MARGEM, y, LARGURA, altura).fill(c.fundo);
  doc.fillColor(c.texto).fontSize(9).font('Helvetica-Bold').text(`CONSEGUE COMPRAR ${tipoBem === 'veiculo' ? 'O VEÍCULO' : 'O IMÓVEL'}?`, MARGEM + 12, y + 8);
  doc.fontSize(17).text(av.titulo, MARGEM + 12, y + 19, { width: LARGURA - 24 });
  if (av.resumo) doc.fontSize(9).font('Helvetica').text(av.resumo, MARGEM + 12, y + 41, { width: LARGURA - 24 });
  y += altura + 8;

  y = chrome.blocoAlvo(doc, y, pedido);

  y = secao(doc, 'A CONTA', y);
  y = linha(doc, tipoBem === 'veiculo' ? 'Valor do veículo' : 'Valor do imóvel', n.valor_bem ? brl(n.valor_bem) : 'não informado', y, 12);
  y = linha(doc, 'Entrada', brl(n.entrada), y, 12);
  y = linha(doc, 'Valor a financiar', brl(n.financiado), y, 12);
  y = linha(doc, 'Condição usada', `${n.sistema}, ${n.prazo_meses} meses, ${n.taxa}`, y, 12);
  y = linha(doc, n.sistema === 'SAC' ? '1ª parcela (a maior)' : 'Parcela', brl(n.parcela), y, 12);
  y = linha(doc, 'Renda considerada', n.renda ? `${brl(n.renda)} (${n.renda_fonte})` : 'não disponível — peça comprovante', y, 12);
  if (n.comprometimento_pct != null) {
    const cor = n.comprometimento_pct <= 30 ? COR.verde : COR.vermelho;
    y = verificarPagina(doc, y, 14);
    doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text('Quanto da renda vai na parcela', MARGEM, y);
    doc.fillColor(cor).font('Helvetica-Bold').text(`${String(n.comprometimento_pct).replace('.', ',')}%  (banco aceita até 30%)`, MARGEM + 200, y);
    y += 12;
  }
  if (n.renda) {
    y = linha(doc, 'Parcela máxima (30%)', brl(n.parcela_maxima), y, 12);
    y = linha(doc, 'Consegue financiar até', brl(n.max_financiavel), y, 12);
  }
  y += 4;

  if (av.travas.length || av.ajustes.length || av.pontos_positivos.length) {
    y = secao(doc, av.travas.length ? 'O QUE TRAVA' : 'POR QUÊ', y);
    av.travas.forEach(t => { y = item(doc, y, t, COR.vermelho); });
    av.ajustes.forEach(t => { y = item(doc, y, t, COR.laranja); });
    av.pontos_positivos.forEach(t => { y = item(doc, y, t, COR.verde); });
    if (av.credores.length) {
      y += 3;
      doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('Dívidas a resolver antes do banco:', MARGEM + 4, y); y += 12;
      av.credores.forEach(cr => { y = item(doc, y, `${cr.credor || 'Credor não informado'} — ${brl(cr.valor)}${cr.data ? ` (desde ${cr.data})` : ''}`, '#1f2937'); });
    }
    y += 4;
  }

  y = secaoCadastralPF(doc, y, dados);
  y = secaoScoreCredito(doc, y, dados);
  y = verificarPagina(doc, y + 2, 20);
  doc.fillColor(COR.cinza).fontSize(7.5).font('Helvetica')
    .text('Simulação de referência com taxas médias de mercado. A aprovação final é do banco/financeira, que pode pedir comprovação de renda e aplicar outras regras.', MARGEM, y + 2, { width: LARGURA });
  y += 22;
  chrome.blocoFinal(doc, y);
}

module.exports = { render };
