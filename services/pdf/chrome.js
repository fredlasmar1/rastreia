/**
 * services/pdf/chrome.js
 *
 * Elementos que envelopam qualquer dossiê:
 *  - cabecalho(doc, pedido, produto): logo + título + faixa azul.
 *  - resumoExecutivo(doc, y, score): caixa do topo com score grande
 *    e top-3 alertas críticos.
 *  - blocoAlvo(doc, y, pedido): identificação do alvo.
 *  - blocoAlertasDetalhados, blocoComposicaoScore, blocoHistoricoScores
 *  - blocoFinal(doc, y): LGPD + fontes + ressalva final.
 *
 * Todos devolvem o novo y (cursor vertical) após o bloco.
 */

const path = require('path');
const fs = require('fs');
const {
  COR, MARGEM, LARGURA,
  formatarDoc, corScore, verificarPagina,
  secao, linha, renderAlerta, ordenarAlertas, contarPorSeveridade
} = require('./helpers');

function cabecalho(doc, pedido, produto) {
  doc.rect(0, 0, 595, 80).fill('#ffffff');
  doc.rect(0, 78, 595, 2).fill(COR.azul);

  const logoPng = path.join(__dirname, '../../public/img/logo-recobro.png');
  if (fs.existsSync(logoPng)) {
    try {
      doc.image(logoPng, MARGEM, 12, { width: 150 });
    } catch (e) {
      console.error('[PDF] Erro logo:', e.message);
    }
  }
  doc.fillColor(COR.azul).fontSize(22).font('Helvetica-Bold').text('RASTREIA', 0, 16, { width: 595 - MARGEM, align: 'right' });
  doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text('Sistema de Inteligencia de Dados', 0, 40, { width: 595 - MARGEM, align: 'right' });
  doc.fillColor(COR.cinza).fontSize(6.5).text(
    `Emitido em: ${new Date().toLocaleString('pt-BR')}  |  Protocolo: #${pedido.numero || pedido.id.substring(0, 8).toUpperCase()}`,
    0, 52, { width: 595 - MARGEM, align: 'right' }
  );

  doc.rect(0, 80, 595, 24).fill(COR.azul);
  doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold')
    .text((produto.nome || pedido.tipo).toUpperCase(), 0, 85, { width: 595, align: 'center' });

  return 118;
}

function resumoExecutivo(doc, y, score) {
  const corS = corScore(score.classificacao);
  const alertasOrd = ordenarAlertas(score.alertas || []);
  const contSev = contarPorSeveridade(score.alertas || []);
  const top3Criticos = alertasOrd.filter(a => a.severidade === 'critico').slice(0, 3);

  y = verificarPagina(doc, y, 120);
  doc.save();
  doc.rect(MARGEM, y, LARGURA, 3).fill(COR.azul);
  y += 6;
  doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica-Bold').text('RESUMO EXECUTIVO', MARGEM, y, { characterSpacing: 1.2 });
  y += 10;

  const scoreText = score.score === '-' ? '?' : `${score.score}`;
  doc.fillColor(corS).fontSize(32).font('Helvetica-Bold').text(scoreText, MARGEM, y, { width: 80, align: 'left' });
  doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text('/100', MARGEM + 56, y + 22);
  doc.fillColor(corS).fontSize(12).font('Helvetica-Bold').text(score.classificacao, MARGEM + 90, y + 2, { width: LARGURA - 90 });
  doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(score.recomendacao, MARGEM + 90, y + 20, { width: LARGURA - 90 });
  y += 46;

  const partes = [];
  if (contSev.critico > 0) partes.push(`${contSev.critico} crítico(s)`);
  if (contSev.atencao > 0) partes.push(`${contSev.atencao} atenção`);
  if (contSev.observar > 0) partes.push(`${contSev.observar} observar`);
  if (contSev.positivo > 0) partes.push(`${contSev.positivo} positivo(s)`);
  const resumoTxt = partes.length > 0 ? `Alertas: ${partes.join(' · ')}` : 'Nenhum alerta gerado';
  doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text(resumoTxt, MARGEM, y);
  y += 14;

  if (top3Criticos.length > 0) {
    doc.fillColor(COR.vermelho).fontSize(7.5).font('Helvetica-Bold').text('PRINCIPAIS PONTOS CRÍTICOS', MARGEM, y);
    y += 10;
    top3Criticos.forEach(a => {
      doc.font('Helvetica').fontSize(7.5);
      const hT = doc.heightOfString(a.texto, { width: LARGURA - 12 });
      y = verificarPagina(doc, y, hT + 4);
      doc.fillColor('#111827').text(`• ${a.texto}`, MARGEM + 6, y, { width: LARGURA - 12 });
      y += hT + 2;
    });
  }
  y += 6;
  doc.rect(MARGEM, y, LARGURA, 1).fill(COR.borda);
  doc.restore();
  return y + 12;
}

function blocoAlvo(doc, y, pedido) {
  y = secao(doc, 'ALVO DA CONSULTA', y);
  y = linha(doc, 'Nome', pedido.alvo_nome, y, 14);
  y = linha(doc, 'CPF / CNPJ', formatarDoc(pedido.alvo_documento), y, 14);
  y = linha(doc, 'Tipo', pedido.alvo_tipo === 'PF' ? 'Pessoa Fisica' : 'Pessoa Juridica', y, 14);
  y = linha(doc, 'Solicitante', pedido.cliente_nome, y, 20);
  return y;
}

function blocoAlertasDetalhados(doc, y, score) {
  const alertasOrd = ordenarAlertas(score.alertas || []);
  if (alertasOrd.length === 0) return y;
  y = secao(doc, 'ALERTAS E SINAIS', y);
  alertasOrd.forEach(a => { y = renderAlerta(doc, y, a); });
  return y + 4;
}

function blocoComposicaoScore(doc, y, score) {
  if (!score.contribuicoes || score.contribuicoes.length === 0) return y;
  const corS = corScore(score.classificacao);

  y = verificarPagina(doc, y, 40);
  y = secao(doc, 'COMO O SCORE FOI COMPOSTO', y);
  doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text('Ponto de partida: 100 pontos. Cada dimensão ajusta o score conforme os dados encontrados.', MARGEM, y, { width: LARGURA });
  y += 12;
  doc.fillColor('#111827').fontSize(7.5).font('Helvetica-Bold');
  doc.text('Dimensão', MARGEM, y);
  doc.text('Ajuste', MARGEM + 200, y, { width: 50, align: 'right' });
  doc.text('Motivo', MARGEM + 260, y, { width: LARGURA - 260 });
  y += 11;
  doc.rect(MARGEM, y - 2, LARGURA, 0.5).fill(COR.borda);
  score.contribuicoes.forEach(c => {
    y = verificarPagina(doc, y, 14);
    const cor = c.delta < 0 ? COR.vermelho : COR.verde;
    const sinal = c.delta > 0 ? '+' : '';
    doc.fillColor('#111827').fontSize(7.5).font('Helvetica').text(c.dimensao, MARGEM, y, { width: 195 });
    doc.fillColor(cor).fontSize(7.5).font('Helvetica-Bold').text(`${sinal}${c.delta}`, MARGEM + 200, y, { width: 50, align: 'right' });
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(c.motivo, MARGEM + 260, y, { width: LARGURA - 260 });
    y += 12;
  });
  y = verificarPagina(doc, y, 14);
  doc.rect(MARGEM, y, LARGURA, 0.5).fill(COR.borda); y += 3;
  doc.fillColor('#111827').fontSize(8).font('Helvetica-Bold').text('Score final', MARGEM, y, { width: 195 });
  doc.fillColor(corS).fontSize(8).font('Helvetica-Bold').text(`${score.score}/100`, MARGEM + 200, y, { width: 50, align: 'right' });
  doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(score.classificacao, MARGEM + 260, y, { width: LARGURA - 260 });
  y += 14;
  doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica-Oblique').text('Decisão automatizada - art. 20 da LGPD garante direito a revisão. Entre em contato para auditoria do cálculo.', MARGEM, y, { width: LARGURA });
  return y + 14;
}

function blocoHistoricoScores(doc, y, dados, pedido, score) {
  const historicoScores = dados.historico_scores || {};
  const historicoLista = Array.isArray(historicoScores.pedidos) ? historicoScores.pedidos : [];
  if (historicoLista.length === 0) return y;

  y = verificarPagina(doc, y, 50);
  y = secao(doc, 'HISTÓRICO DE SCORES DESTE ALVO', y);
  doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(`Consultas anteriores do mesmo ${pedido.alvo_tipo === 'PJ' ? 'CNPJ' : 'CPF'} nesta base. Tendência calculada contra o score atual.`, MARGEM, y, { width: LARGURA });
  y += 12;
  doc.fillColor('#111827').fontSize(7.5).font('Helvetica-Bold');
  doc.text('Data', MARGEM, y, { width: 80 });
  doc.text('Pedido', MARGEM + 85, y, { width: 60 });
  doc.text('Score', MARGEM + 150, y, { width: 50, align: 'right' });
  doc.text('Classificação', MARGEM + 210, y, { width: 120 });
  doc.text('Tendência', MARGEM + 335, y, { width: 90 });
  y += 11;
  doc.rect(MARGEM, y - 2, LARGURA, 0.5).fill(COR.borda);
  const scoreAtual = typeof score.score === 'number' ? score.score : null;
  historicoLista.slice(0, 5).forEach(h => {
    y = verificarPagina(doc, y, 14);
    const dt = h.criado_em ? new Date(h.criado_em) : null;
    const dataTxt = dt && !isNaN(dt) ? dt.toLocaleDateString('pt-BR') : '-';
    const scoreTxt = h.score_calculado != null ? String(h.score_calculado) : '-';
    const classifTxt = h.score_classificacao || '-';
    let tendencia = '—';
    let corT = COR.cinza;
    if (scoreAtual != null && h.score_calculado != null) {
      const delta = scoreAtual - h.score_calculado;
      if (delta > 2) { tendencia = `MELHOROU +${delta}`; corT = COR.verde; }
      else if (delta < -2) { tendencia = `PIOROU ${delta}`; corT = COR.vermelho; }
      else { tendencia = `ESTÁVEL (${delta >= 0 ? '+' : ''}${delta})`; corT = COR.cinza; }
    }
    doc.fillColor('#111827').fontSize(7.5).font('Helvetica').text(dataTxt, MARGEM, y, { width: 80 });
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(h.numero ? `#${h.numero}` : '-', MARGEM + 85, y, { width: 60 });
    doc.fillColor('#111827').fontSize(7.5).font('Helvetica-Bold').text(scoreTxt, MARGEM + 150, y, { width: 50, align: 'right' });
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(classifTxt, MARGEM + 210, y, { width: 120 });
    doc.fillColor(corT).fontSize(7).font('Helvetica-Bold').text(tendencia, MARGEM + 335, y, { width: 90 });
    y += 12;
  });
  if (historicoLista.length > 5) {
    y = verificarPagina(doc, y, 12);
    doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica-Oblique').text(`(+${historicoLista.length - 5} consulta(s) anterior(es) não exibida(s))`, MARGEM, y, { width: LARGURA });
    y += 10;
  }
  return y + 6;
}

// ═══════════════════════════════════════════════════════════════
// BLOCO FINAL: LGPD + FONTES + RESSALVA
// Mantido compacto e junto (calcula altura total antes de quebrar).
// fontesExtras permite acrescentar fontes específicas do produto
// (ex: Credify em análise veicular, ONR em due diligence imobiliária).
// ═══════════════════════════════════════════════════════════════
function blocoFinal(doc, y, fontesExtras) {
  const fontes = [
    'Receita Federal do Brasil (CPF/CNPJ)',
    'Direct Data - Cadastro, Score QUOD, Protestos e Negativacoes',
    'Escavador - Processos Judiciais estruturados',
    'Datajud CNJ - Processos nos tribunais (TJGO, TRF1, STJ, TST)',
    'Portal da Transparencia (CGU) - Listas CEIS/CNEP',
    'CNPJa / CNPJ.ws - Dados empresariais'
  ];
  if (Array.isArray(fontesExtras)) fontesExtras.forEach(f => { if (f) fontes.push(f); });

  const fontesJoin = fontes.join('  |  ');
  const textoLgpd = 'Este documento contem dados pessoais protegidos pela Lei Geral de Protecao de Dados. E PROIBIDO compartilhar, reproduzir ou repassar este relatorio a terceiros sem autorizacao. O uso indevido sujeita o responsavel as sancoes previstas nos artigos 42 a 45 da LGPD, incluindo multa de ate 2% do faturamento. Uso exclusivo para a finalidade declarada no momento da contratacao.';
  const textoRessalva = 'Caso alguma informacao esteja incorreta ou desatualizada, solicitamos que o titular entre em contato diretamente com a base de dados de origem para solicitar a correcao. A Recobro Recuperacao de Credito nao se responsabiliza por inexatidoes ou desatualizacoes nas bases consultadas.';

  doc.font('Helvetica').fontSize(6);
  const hLgpdTexto = doc.heightOfString(textoLgpd, { width: LARGURA - 16 });
  doc.fontSize(5.5);
  const hFontes = doc.heightOfString(fontesJoin, { width: LARGURA });
  doc.font('Helvetica-Bold');
  const hRessalva = doc.heightOfString(textoRessalva, { width: LARGURA });

  const hLgpdBox = Math.max(36, hLgpdTexto + 22);
  const alturaBlocoFinal = 6 + hLgpdBox + 6 + 10 + 10 + hFontes + 6 + hRessalva + 10 + 12;

  y = verificarPagina(doc, y, alturaBlocoFinal);

  y += 6;
  doc.rect(MARGEM, y, LARGURA, hLgpdBox).fill('#fef3c7').stroke('#f59e0b');
  doc.fillColor('#92400e').fontSize(7).font('Helvetica-Bold').text('AVISO LEGAL — LGPD (Lei 13.709/2018)', MARGEM + 8, y + 4);
  doc.fillColor('#92400e').fontSize(6).font('Helvetica').text(textoLgpd, MARGEM + 8, y + 14, { width: LARGURA - 16 });
  y += hLgpdBox + 6;

  doc.fillColor(COR.azul).fontSize(7).font('Helvetica-Bold').text('FONTES DE DADOS CONSULTADAS', MARGEM, y); y += 10;
  doc.fillColor(COR.cinza).fontSize(6).font('Helvetica').text('As informacoes deste relatorio foram extraidas das seguintes bases de dados publicas e privadas:', MARGEM, y, { width: LARGURA });
  y += 10;
  doc.fillColor(COR.cinza).fontSize(5.5).font('Helvetica').text(fontesJoin, MARGEM, y, { width: LARGURA });
  y += hFontes + 6;

  doc.fillColor('#92400e').fontSize(5.5).font('Helvetica-Bold').text(textoRessalva, MARGEM, y, { width: LARGURA });
  y += hRessalva + 6;

  doc.fillColor(COR.cinza).fontSize(5.5).font('Helvetica')
    .text('Documento gerado pelo sistema Rastreia. Nao substitui consulta juridica especializada. Recobro Recuperacao de Credito | Anapolis - GO', MARGEM, y, { align: 'center', width: LARGURA });

  return y;
}

module.exports = {
  cabecalho, resumoExecutivo, blocoAlvo,
  blocoAlertasDetalhados, blocoComposicaoScore, blocoHistoricoScores,
  blocoFinal
};
