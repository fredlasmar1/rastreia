/**
 * services/pdf/helpers.js
 *
 * Constantes visuais + funções puras de layout usadas por todos os
 * dossiês. Extraído de services/pdf.js para viabilizar arquivos por
 * produto sem duplicar código.
 *
 * Regras:
 *  - Não importa PDFKit nem I/O. Recebe `doc` como parâmetro.
 *  - Fonte padrão Helvetica (PDFKit não renderiza setas Unicode).
 *  - ASCII-safe: nunca usar ↑ ↓ → em strings renderizadas.
 */

const COR = {
  azul: '#1a3a8a', azul_claro: '#2563eb', verde: '#16a34a',
  vermelho: '#dc2626', laranja: '#ea580c', cinza: '#6b7280',
  fundo: '#f9fafb', borda: '#e5e7eb', branco: '#ffffff'
};

const MARGEM = 50;
const LARGURA = 495;
const RODAPE_H = 30;

function formatarDoc(doc) {
  if (!doc) return '';
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

function corScore(classificacao) {
  const c = (classificacao || '').toUpperCase();
  if (c.includes('BAIXO RISCO')) return COR.verde;
  if (c.includes('BAIXO-MODERADO')) return COR.verde;
  if (c.includes('MODERADO')) return COR.laranja;
  if (c.includes('MÉDIO') || c === 'RISCO MEDIO') return COR.laranja;
  if (c.includes('INDISPON')) return COR.cinza;
  return COR.vermelho;
}

function limiteY(doc) {
  return doc.page.height - MARGEM - RODAPE_H;
}

function verificarPagina(doc, y, espaco) {
  if (y + (espaco || 20) > limiteY(doc)) {
    doc.addPage();
    return MARGEM;
  }
  return y;
}

function secao(doc, titulo, y) {
  y = verificarPagina(doc, y, 30);
  doc.fillColor(COR.azul).fontSize(11).font('Helvetica-Bold').text(titulo, MARGEM, y);
  y += 16;
  doc.moveTo(MARGEM, y).lineTo(MARGEM + LARGURA, y).strokeColor(COR.azul_claro).lineWidth(1.5).stroke();
  return y + 10;
}

// Renderiza linha label: valor. Garante paginação correta e retorna novo y.
function linha(doc, label, valor, y, altura) {
  const h = altura || 13;
  y = verificarPagina(doc, y, h);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR.cinza).text(label + ':', MARGEM, y, { width: 140, lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor('#111827').text(String(valor || '-'), 195, y, { width: 350, lineBreak: false });
  return y + h;
}

function avisoBox(doc, y, msg, cor) {
  y = verificarPagina(doc, y, 28);
  doc.rect(MARGEM, y, LARGURA, 22).fill(cor || '#fef3c7');
  doc.fillColor('#92400e').fontSize(8).font('Helvetica').text(msg, MARGEM + 8, y + 5, { width: LARGURA - 16 });
  return y + 28;
}

// Box verde "tudo certo" com titulo + descricao
function boxPositivo(doc, y, titulo, descricao) {
  y = verificarPagina(doc, y, 34);
  const h = descricao ? 28 : 20;
  doc.rect(MARGEM, y, LARGURA, h).fill('#d1fae5');
  doc.fillColor('#065f46').fontSize(9.5).font('Helvetica-Bold').text(titulo, MARGEM + 8, y + 5, { lineBreak: false });
  if (descricao) {
    doc.fillColor('#065f46').fontSize(7).font('Helvetica').text(descricao, MARGEM + 8, y + 17, { width: LARGURA - 16, lineBreak: false });
  }
  return y + h + 4;
}

// Box neutro cinza com titulo + descricao (p/ "Em integração")
function boxEmIntegracao(doc, y, titulo, descricao) {
  y = verificarPagina(doc, y, 34);
  const h = descricao ? 28 : 20;
  doc.rect(MARGEM, y, LARGURA, h).fill('#f3f4f6');
  doc.rect(MARGEM, y, 3, h).fill(COR.cinza);
  doc.fillColor('#374151').fontSize(9).font('Helvetica-Bold').text(titulo, MARGEM + 10, y + 5, { lineBreak: false });
  if (descricao) {
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(descricao, MARGEM + 10, y + 17, { width: LARGURA - 18, lineBreak: false });
  }
  return y + h + 4;
}

function normalizarAlerta(a) {
  if (typeof a === 'string') return { texto: a, severidade: 'atencao' };
  return { texto: a.texto || String(a), severidade: a.severidade || 'atencao' };
}

const ESTILO_SEV = {
  critico:  { fundo: '#fee2e2', texto: '#991b1b', rotulo: 'CRÍTICO' },
  atencao:  { fundo: '#fef3c7', texto: '#92400e', rotulo: 'ATENÇÃO' },
  observar: { fundo: '#f3f4f6', texto: '#374151', rotulo: 'OBSERVAR' },
  positivo: { fundo: '#dcfce7', texto: '#14532d', rotulo: 'POSITIVO' }
};

function renderAlerta(doc, y, alerta) {
  const { texto, severidade } = normalizarAlerta(alerta);
  const est = ESTILO_SEV[severidade] || ESTILO_SEV.atencao;
  const larguraRot = 52;
  const larguraTxt = LARGURA - larguraRot - 8;
  doc.font('Helvetica').fontSize(7.5);
  const h = Math.max(15, doc.heightOfString(texto, { width: larguraTxt }) + 6);
  y = verificarPagina(doc, y, h + 3);
  doc.rect(MARGEM, y, LARGURA, h).fill(est.fundo);
  doc.rect(MARGEM, y, larguraRot, h).fill(est.texto);
  doc.fillColor('#ffffff').fontSize(6.5).font('Helvetica-Bold').text(est.rotulo, MARGEM, y + (h / 2) - 3, { width: larguraRot, align: 'center' });
  doc.fillColor(est.texto).fontSize(7.5).font('Helvetica').text(texto, MARGEM + larguraRot + 6, y + 3, { width: larguraTxt });
  return y + h + 3;
}

function ordenarAlertas(alertas) {
  const ordem = { critico: 0, atencao: 1, observar: 2, positivo: 3 };
  return [...(alertas || [])].map(normalizarAlerta).sort((a, b) =>
    (ordem[a.severidade] ?? 1) - (ordem[b.severidade] ?? 1)
  );
}

function contarPorSeveridade(alertas) {
  const contagem = { critico: 0, atencao: 0, observar: 0, positivo: 0 };
  (alertas || []).map(normalizarAlerta).forEach(a => {
    if (contagem[a.severidade] !== undefined) contagem[a.severidade]++;
  });
  return contagem;
}

function truncar(texto, max) {
  if (!texto) return '';
  const s = String(texto);
  return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s;
}

function isAlvoNoPolo(poloStr, cpf, nome) {
  if (!poloStr) return false;
  const polo = String(poloStr).toLowerCase();
  const cpfDigits = String(cpf || '').replace(/\D/g, '');
  if (cpfDigits && cpfDigits.length >= 11 && polo.replace(/\D/g, '').includes(cpfDigits)) return true;
  if (nome) {
    const primeiro = String(nome).toLowerCase().trim().split(/\s+/)[0];
    if (primeiro && primeiro.length >= 3 && polo.includes(primeiro)) return true;
  }
  return false;
}

function parseValorCausa(valor) {
  if (valor == null) return 0;
  if (typeof valor === 'number') return valor;
  const s = String(valor).replace(/[^\d,\.]/g, '');
  if (!s) return 0;
  const normalizado = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

function formatarBRL(valor) {
  const n = typeof valor === 'number' ? valor : parseValorCausa(valor);
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function construirResumoJudicial(lista, cpf, nome) {
  if (!lista || !lista.length) return '';
  const ativos = lista.filter(p => String(p.status || '').toLowerCase() === 'ativo');
  const inativos = lista.filter(p => String(p.status || '').toLowerCase() !== 'ativo');
  let autor = 0, reu = 0, valorAtivos = 0;
  const classes = new Set();
  let maisRecente = null;
  ativos.forEach(p => {
    if (isAlvoNoPolo(p.polo_ativo, cpf, nome)) autor++;
    else if (isAlvoNoPolo(p.polo_passivo, cpf, nome)) reu++;
    if (p.classe) classes.add(String(p.classe).trim());
    valorAtivos += parseValorCausa(p.valor_causa);
    const dataRef = p.ultima_movimentacao || p.data_inicio;
    if (dataRef) {
      const d = new Date(dataRef);
      if (!isNaN(d) && (!maisRecente || d > maisRecente)) maisRecente = d;
    }
  });
  const partes = [];
  if (ativos.length) {
    const papel = reu > autor ? 'réu' : autor > reu ? 'autor' : 'parte';
    partes.push(`${papel} em ${ativos.length} processo(s) ativo(s)`);
    if (valorAtivos > 0) partes.push(`somando ${formatarBRL(valorAtivos)} em valores de causa`);
    if (classes.size > 0) partes.push(`nas áreas ${[...classes].slice(0, 3).join(', ')}`);
  }
  if (inativos.length) partes.push(`${inativos.length} processo(s) no histórico (baixados/arquivados)`);
  if (maisRecente) {
    const dias = Math.floor((Date.now() - maisRecente.getTime()) / 86400000);
    if (dias >= 0) partes.push(`movimentação mais recente há ${dias} dia(s)`);
  }
  const sujeito = nome ? String(nome).split(' ')[0] : 'O alvo';
  return partes.length ? `${sujeito} consta como ${partes.join('; ')}.` : '';
}

function rodape(doc) {
  const y = doc.page.height - RODAPE_H;
  doc.rect(0, y, 595, RODAPE_H).fill('#f3f4f6');
  doc.fillColor(COR.cinza).fontSize(6).font('Helvetica')
    .text('Documento informativo gerado pelo sistema Rastreia. Nao substitui consulta juridica. Recobro Recuperacao de Credito | Anapolis - GO', MARGEM, y + 10, { align: 'center', width: LARGURA });
}

module.exports = {
  COR, MARGEM, LARGURA, RODAPE_H, ESTILO_SEV,
  formatarDoc, corScore, limiteY, verificarPagina,
  secao, linha, avisoBox, boxPositivo, boxEmIntegracao,
  normalizarAlerta, renderAlerta, ordenarAlertas, contarPorSeveridade,
  truncar, isAlvoNoPolo, parseValorCausa, formatarBRL,
  construirResumoJudicial, rodape
};
