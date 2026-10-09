/**
 * PDF — Checagem do Vendedor ("tem algo que trava ou anula a venda?")
 *   1. Veredito (RISCO / ATENÇÃO / LIVRE / INCOMPLETO) e motivos
 *   2. Execuções contra o vendedor (risco de fraude à execução)
 *   3. Certidões (TST e Receita/PGFN) com o link do comprovante oficial
 *   4. Detalhe: cadastro, dívidas/protestos, processos
 * Regra: services/veredito_vendedor.js.
 */
const chrome = require('./chrome');
const { COR, MARGEM, LARGURA, secao, linha, verificarPagina } = require('./helpers');
const { secaoCadastralPF, secaoProtestos, secaoProcessos } = require('./sections');
const { avaliarVendedor } = require('../veredito_vendedor');

const CORES = {
  RISCO: { fundo: '#fee2e2', texto: '#7f1d1d' },
  ATENCAO: { fundo: '#ffedd5', texto: '#7c2d12' },
  LIVRE: { fundo: '#dcfce7', texto: '#14532d' },
  INCOMPLETO: { fundo: '#e5e7eb', texto: '#1f2937' }
};

function item(doc, y, txt, cor, bold) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
  const h = doc.heightOfString('•  ' + txt, { width: LARGURA - 10 });
  y = verificarPagina(doc, y, h + 4);
  doc.fillColor(cor).text('•  ' + txt, MARGEM + 4, y, { width: LARGURA - 10 });
  return y + h + 3;
}

function render(doc, pedido, dados, score, checklist, produto) {
  const av = avaliarVendedor({ dados, nomeAlvo: pedido.alvo_nome, docAlvo: pedido.alvo_documento });
  const c = CORES[av.nivel];
  let y = chrome.cabecalho(doc, pedido, produto);

  y = verificarPagina(doc, y + 4, 52);
  doc.rect(MARGEM, y, LARGURA, 50).fill(c.fundo);
  doc.fillColor(c.texto).fontSize(9).font('Helvetica-Bold').text('ESTE VENDEDOR PODE TRAVAR A VENDA?', MARGEM + 12, y + 8);
  doc.fontSize(17).text(av.titulo, MARGEM + 12, y + 19, { width: LARGURA - 24 });
  doc.fontSize(9).font('Helvetica').text(av.frase, MARGEM + 12, y + 38, { width: LARGURA - 24 });
  y += 58;

  y = chrome.blocoAlvo(doc, y, pedido);

  y = secao(doc, 'POR QUÊ', y);
  av.riscos.forEach(t => { y = item(doc, y, t, COR.vermelho, true); });
  av.atencao.forEach(t => { y = item(doc, y, t, COR.laranja); });
  av.pontos_positivos.forEach(t => { y = item(doc, y, t, COR.verde); });
  if (av.faltou.length) y = item(doc, y, `Não responderam: ${av.faltou.join(', ')}.`, COR.cinza);
  y += 4;

  if (av.execucoes.length) {
    y = secao(doc, 'EXECUÇÕES CONTRA O VENDEDOR', y);
    av.execucoes.forEach(e => { y = item(doc, y, `${e.numero || '?'} — ${e.classe || ''} — ${e.tribunal || ''}${e.valor_causa ? ` — ${e.valor_causa}` : ''}${e.data_inicio ? ` (desde ${e.data_inicio})` : ''}`, '#1f2937'); });
    y += 4;
  }

  const cndt = dados.cndt || {}; const ccd = dados.certidao_conjunta || {};
  y = secao(doc, 'CERTIDÕES', y);
  y = linha(doc, 'Trabalhista (TST)', cndt.disponivel === false ? `não respondeu${cndt.erro ? ` (${cndt.erro})` : ''}` : (cndt.positiva ? `POSITIVA — ${cndt.total} processo(s)` : 'Negativa'), y, 12);
  y = linha(doc, 'Receita Federal / PGFN', ccd.disponivel === false ? `não respondeu${ccd.erro ? ` (${ccd.erro})` : ''}` : (ccd.positiva ? 'POSITIVA — há débitos' : 'Negativa'), y, 12);
  av.comprovantes.forEach(cp => {
    y = verificarPagina(doc, y, 12);
    doc.fillColor(COR.azul_claro || COR.azul).fontSize(8).font('Helvetica').text(`Comprovante oficial — ${cp.nome}`, MARGEM + 4, y, { link: cp.url, underline: true });
    y += 11;
  });
  y += 4;

  if (dados.receita_federal && !dados.receita_federal.razao_social) y = secaoCadastralPF(doc, y, dados);
  y = secaoProtestos(doc, y, dados);
  y = secaoProcessos(doc, y, dados, pedido);
  y = verificarPagina(doc, y + 2, 20);
  doc.fillColor(COR.cinza).fontSize(7.5).font('Helvetica')
    .text('Para imóvel, confira também a matrícula atualizada (ônus e penhoras registradas) no cartório — a Due Diligence Imobiliária faz a leitura da matrícula.', MARGEM, y + 2, { width: LARGURA });
  y += 22;
  chrome.blocoFinal(doc, y);
}

module.exports = { render };
