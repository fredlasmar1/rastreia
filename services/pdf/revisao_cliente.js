/**
 * PDF do RELATÓRIO PARA O CLIENTE da Revisão Bancária — marca Recobro + Balladão.
 * Conteúdo vem de services/revisao_cliente.js (nunca do diagnóstico interno direto).
 * Logo do Balladão: public/img/logo-balladao.png (sem o arquivo, entra o nome em texto).
 * Helvetica (WinAnsi): nada de setas Unicode.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const M = 50, W = 495;
const AZUL = '#1a3a8a', TINTA = '#111827', CINZA = '#6b7280';
const IMG = path.join(__dirname, '../../public/img');

function cabecalho(doc, c) {
  doc.rect(0, 0, doc.page.width, 78).fill('#ffffff');
  const rec = path.join(IMG, 'logo-recobro.png');
  if (fs.existsSync(rec)) { try { doc.image(rec, M, 24, { height: 26 }); } catch (_) {} }
  const bal = path.join(IMG, 'logo-balladao.png');
  if (fs.existsSync(bal)) { try { doc.image(bal, M + W - 170, 18, { fit: [170, 40], align: 'right', valign: 'center' }); } catch (_) {} }
  else {
    doc.fillColor(TINTA).font('Times-Bold').fontSize(16).text('BALLADÃO', M + W - 200, 22, { width: 200, align: 'right' });
    doc.font('Times-Roman').fontSize(9).fillColor(CINZA).text('A D V O G A D O S', M + W - 200, 41, { width: 200, align: 'right', characterSpacing: 1 });
  }
  doc.moveTo(M, 66).lineTo(M + W, 66).strokeColor(AZUL).lineWidth(2).stroke();
  return 84;
}

function rodape(doc, c) {
  // abaixo da margem de baixo: zera a margem senão o PDFKit abre página nova
  const y = doc.page.height - 40, mb = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(7.5).fillColor(CINZA)
    .text(`Recobro Recuperação de Crédito  •  Balladão Advogados${c.protocolo ? `  •  Protocolo #${c.protocolo}` : ''}`, M, y, { width: W, align: 'center', lineBreak: false });
  doc.page.margins.bottom = mb;
}

function novaPagina(doc, c) { doc.addPage(); return cabecalho(doc, c); }
function cabe(doc, y, h, c) { return y + h > doc.page.height - 60 ? novaPagina(doc, c) : y; }

function titulo(doc, y, t, c) {
  y = cabe(doc, y + 8, 30, c);
  doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(12).text(t, M, y, { width: W });
  return doc.y + 6;
}
function texto(doc, y, t, c, { tam = 10, cor = TINTA, fonte = 'Helvetica', x = M, w = W } = {}) {
  doc.font(fonte).fontSize(tam);
  y = cabe(doc, y, Math.min(doc.heightOfString(t, { width: w }), 150) + 2, c);
  doc.fillColor(cor).text(t, x, y, { width: w });
  return doc.y + 4;
}
function marcador(doc, y, t, c, cor = AZUL) {
  doc.font('Helvetica').fontSize(10);
  const h = doc.heightOfString(t, { width: W - 16 });
  y = cabe(doc, y, h + 4, c);
  doc.circle(M + 4, y + 6, 2.5).fill(cor);
  doc.fillColor(TINTA).text(t, M + 14, y, { width: W - 16 });
  return doc.y + 4;
}
function cartao(doc, y, t, corpo, c, cor) {
  doc.font('Helvetica-Bold').fontSize(10.5);
  let h = doc.heightOfString(t, { width: W - 24 }) + 4;
  doc.font('Helvetica').fontSize(9.5); h += doc.heightOfString(corpo, { width: W - 24 }) + 14;
  y = cabe(doc, y, h, c);
  doc.roundedRect(M, y, W, h, 6).fill('#f8fafc');
  doc.rect(M, y, 4, h).fill(cor);
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10.5).text(t, M + 14, y + 7, { width: W - 24 });
  doc.font('Helvetica').fontSize(9.5).fillColor('#374151').text(corpo, M + 14, doc.y + 2, { width: W - 24 });
  return y + h + 6;
}

function gerarRelatorioCliente(c) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: c.titulo, Author: 'Recobro + Balladão Advogados' } });
      const partes = [];
      doc.on('data', b => partes.push(b));
      doc.on('end', () => resolve(Buffer.concat(partes)));

      let y = cabecalho(doc, c);
      doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(19).text(c.titulo, M, y + 4, { width: W });
      y = doc.y + 2;
      if (c.preliminar) {
        doc.roundedRect(M, y + 2, 118, 16, 8).fill('#fef3c7');
        doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(8).text('ANÁLISE PRELIMINAR', M, y + 6.5, { width: 118, align: 'center' });
        y += 22;
      }
      const linhas = [['Para', c.cliente], ['Contratante', c.contratante !== c.cliente ? c.contratante : null], ['Banco', c.banco], ['Contrato', c.contrato], ['Data', new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })]].filter(l => l[1]);
      linhas.forEach(([k, v]) => { doc.font('Helvetica').fontSize(9.5).fillColor(CINZA).text(k, M, y + 4, { width: 80 }); doc.fillColor(TINTA).text(String(v), M + 80, y + 4, { width: W - 80 }); y = doc.y; });
      y += 10;

      // Em resumo
      const hR = c.resumo.reduce((s, t) => { doc.font('Helvetica').fontSize(10.5); return s + doc.heightOfString(t, { width: W - 28 }) + 5; }, 22);
      y = cabe(doc, y, hR, c);
      doc.roundedRect(M, y, W, hR, 8).fill('#eef2ff');
      doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(9).text('EM RESUMO', M + 14, y + 9);
      let yy = doc.y + 3;
      c.resumo.forEach(t => { doc.fillColor(TINTA).font('Helvetica').fontSize(10.5).text(t, M + 14, yy, { width: W - 28 }); yy = doc.y + 5; });
      y += hR + 6;

      y = titulo(doc, y, 'O que encontramos', c);
      if (!c.encontrados.length) y = texto(doc, y, 'Com os documentos enviados até aqui, não encontramos pontos fortes para questionar.', c);
      c.encontrados.forEach(a => { y = cartao(doc, y, a.titulo, a.texto, c, '#d97706'); });

      if (c.dentro_das_regras.length) { y = titulo(doc, y, 'O que está dentro das regras', c); c.dentro_das_regras.forEach(t => { y = marcador(doc, y, t, c, '#16a34a'); }); }
      if (c.garantias.length) { y = titulo(doc, y, 'Quem garante a dívida', c); c.garantias.forEach(t => { y = marcador(doc, y, t, c); }); }
      y = titulo(doc, y, 'Valores', c); c.numeros.forEach(t => { y = marcador(doc, y, t, c); });
      y = titulo(doc, y, 'O que fazer agora', c); c.o_que_fazer_agora.forEach(t => { y = marcador(doc, y, t, c, '#dc2626'); });
      if (c.precisamos.length) { y = titulo(doc, y, 'O que precisamos de você', c); c.precisamos.forEach((t, i) => { y = texto(doc, y, `${i + 1}. ${t}`, c); }); }
      y = titulo(doc, y, 'Próximos passos', c); c.proximos_passos.forEach((t, i) => { y = texto(doc, y, `${i + 1}. ${t}`, c); });

      // Contato
      y = cabe(doc, y + 8, 44, c);
      doc.roundedRect(M, y, W, 40, 8).fill(AZUL);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('Fale com a gente', M + 14, y + 8, { width: W - 28 });
      doc.font('Helvetica').fontSize(9.5).text(c.contato ? `WhatsApp ${c.contato} — informe o protocolo #${c.protocolo}.` : `Responda a mensagem em que recebeu este relatório (protocolo #${c.protocolo}).`, M + 14, y + 23, { width: W - 28 });
      y += 50;
      c.ressalvas.forEach(t => { y = texto(doc, y, t, c, { tam: 8, cor: CINZA }); });

      const n = doc.bufferedPageRange().count;
      for (let i = 0; i < n; i++) { doc.switchToPage(i); rodape(doc, c); }
      doc.end();
    } catch (e) { reject(e); }
  });
}

module.exports = { gerarRelatorioCliente };
