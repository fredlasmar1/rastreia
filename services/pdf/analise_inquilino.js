/**
 * PDF — Aprovação de Inquilino
 *
 * Responde a pergunta da imobiliária logo na primeira dobra:
 *   1. Veredito (APROVAR / APROVAR COM GARANTIA / RECUSAR / FALTAM DADOS)
 *   2. A conta: aluguel + encargos × renda (ideal até 30%)
 *   3. Por quê (motivos contra e a favor) e a garantia sugerida
 *   4. Detalhe: cadastro, processos, dívidas, score (seções do Dossiê PF)
 *
 * Regra do veredito: services/veredito_locacao.js (função pura).
 */
const chrome = require('./chrome');
const { COR, MARGEM, LARGURA, secao, linha, verificarPagina } = require('./helpers');
const {
  secaoCadastralPF, secaoProcessos, secaoScoreCredito, secaoProtestos,
  secaoPerfilFinanceiroPF, secaoParecerAnalista
} = require('./sections');
const { avaliarLocacao } = require('../veredito_locacao');

const CORES = {
  APROVAR: { fundo: '#dcfce7', texto: '#14532d' },
  APROVAR_COM_GARANTIA: { fundo: '#ffedd5', texto: '#7c2d12' },
  RECUSAR: { fundo: '#fee2e2', texto: '#7f1d1d' },
  FALTAM_DADOS: { fundo: '#e5e7eb', texto: '#1f2937' }
};
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function blocoVeredito(doc, y, av) {
  const c = CORES[av.veredito] || CORES.FALTAM_DADOS;
  const subt = av.veredito === 'APROVAR_COM_GARANTIA' && av.garantia
    ? `Garantia sugerida: ${av.garantia.tipo}`
    : av.veredito === 'FALTAM_DADOS' ? `Falta: ${av.faltam.join('; ')}` : '';
  const altura = subt ? 58 : 44;
  y = verificarPagina(doc, y + 4, altura + 6);
  doc.rect(MARGEM, y, LARGURA, altura).fill(c.fundo);
  doc.fillColor(c.texto).fontSize(9).font('Helvetica-Bold').text('PODE ALUGAR?', MARGEM + 12, y + 8);
  doc.fontSize(18).text(av.titulo, MARGEM + 12, y + 19, { width: LARGURA - 24 });
  if (subt) doc.fontSize(9).font('Helvetica').text(subt, MARGEM + 12, y + 41, { width: LARGURA - 24 });
  return y + altura + 8;
}

function blocoConta(doc, y, av) {
  const n = av.numeros;
  y = secao(doc, 'A CONTA DO ALUGUEL', y);
  y = linha(doc, 'Aluguel', n.aluguel ? brl(n.aluguel) : 'não informado', y, 12);
  if (n.encargos) y = linha(doc, 'Condomínio + IPTU', brl(n.encargos), y, 12);
  if (n.custo_mensal) y = linha(doc, 'Custo mensal da locação', brl(n.custo_mensal), y, 12);
  y = linha(doc, 'Renda considerada', n.renda ? `${brl(n.renda)} (${n.renda_fonte})` : 'não disponível — peça comprovante', y, 12);
  if (n.comprometimento_pct != null) {
    const cor = n.comprometimento_pct <= 30 ? COR.verde : (n.comprometimento_pct <= 40 ? COR.laranja : COR.vermelho);
    y = verificarPagina(doc, y, 14);
    doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text('Quanto da renda vai no aluguel', MARGEM, y);
    doc.fillColor(cor).font('Helvetica-Bold').text(`${String(n.comprometimento_pct).replace('.', ',')}%  (ideal até 30%)`, MARGEM + 200, y);
    y += 12;
  }
  if (n.renda_necessaria) y = linha(doc, 'Renda necessária (30%)', brl(n.renda_necessaria), y, 12);
  return y + 4;
}

function blocoMotivos(doc, y, av) {
  if (!av.motivos.length && !av.pontos_positivos.length && !av.garantia) return y;
  y = secao(doc, 'POR QUÊ', y);
  const item = (txt, cor, marca) => {
    const h = doc.font('Helvetica').fontSize(9).heightOfString(`${marca}  ${txt}`, { width: LARGURA - 10 });
    y = verificarPagina(doc, y, h + 4);
    doc.fillColor(cor).text(`${marca}  ${txt}`, MARGEM + 4, y, { width: LARGURA - 10 });
    y += h + 3;
  };
  // Helvetica (WinAnsi) não tem ✓/✕: marcador por cor
  av.motivos.forEach(m => item(m, COR.vermelho, '•'));
  av.pontos_positivos.forEach(m => item(m, COR.verde, '•'));
  if (av.garantia) {
    y += 4;
    y = verificarPagina(doc, y, 30);
    doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text(`Garantia: ${av.garantia.tipo}`, MARGEM + 4, y);
    y += 12;
    const h = doc.font('Helvetica').fontSize(8.5).heightOfString(av.garantia.detalhe, { width: LARGURA - 10 });
    doc.fillColor('#1f2937').text(av.garantia.detalhe, MARGEM + 4, y, { width: LARGURA - 10 });
    y += h + 4;
  }
  if (av.despejos.length) {
    y += 2;
    av.despejos.slice(0, 5).forEach(d => item(`Despejo ${d.numero || ''} — ${d.tribunal || ''} — desde ${d.data_inicio || '?'} (${d.status || '-'})`, COR.vermelho, '•'));
  }
  return y + 4;
}

function render(doc, pedido, dados, score, checklist, produto) {
  const av = avaliarLocacao({
    dados,
    aluguel: pedido.locacao_aluguel,
    encargos: pedido.locacao_encargos,
    rendaDeclarada: pedido.renda_declarada,
    nomeAlvo: pedido.alvo_nome,
    docAlvo: pedido.alvo_documento
  });

  let y = chrome.cabecalho(doc, pedido, produto);
  y = blocoVeredito(doc, y, av);
  y = chrome.blocoAlvo(doc, y, pedido);
  y = blocoConta(doc, y, av);
  y = blocoMotivos(doc, y, av);

  // Detalhe para quem quiser conferir
  y = secaoCadastralPF(doc, y, dados);
  y = secaoScoreCredito(doc, y, dados);
  y = secaoProtestos(doc, y, dados);
  y = secaoProcessos(doc, y, dados, pedido);
  y = secaoPerfilFinanceiroPF(doc, y, dados);
  y = secaoParecerAnalista(doc, y, pedido);

  chrome.blocoFinal(doc, y);
}

module.exports = { render };
