/**
 * services/pdf/consulta_restricoes.js
 * Consulta de Restrições — produto leve (R$ 19).
 *
 * Foco: responder "esse CPF/CNPJ tem restrições financeiras?".
 * Fontes: APENAS Direct Data (Cadastro PF/PJ + Score QUOD + Detalhamento
 * Negativo + Protestos). Sem processos, sem patrimônio, sem listas negras.
 *
 * Layout enxuto:
 *  1. Cabeçalho Recobro (chrome.cabecalho)
 *  2. Status grande: SEM RESTRIÇÕES (verde) ou COM RESTRIÇÕES (vermelho)
 *  3. Identificação do consultado
 *  4. Score QUOD com faixa
 *  5. Protestos (lista ou Nada Consta)
 *  6. Negativações / pendências (lista ou Nada Consta)
 *  7. Aviso LGPD + fontes (chrome.blocoFinal)
 */

const chrome = require('./chrome');
const {
  COR, MARGEM, LARGURA, verificarPagina,
  secao, linha, formatarDoc, formatarBRL
} = require('./helpers');

// dd/mm/yyyy a partir de string ISO, "yyyy-mm-dd", "dd/mm/yyyy" ou Date.
function formatarData(v) {
  if (!v) return '';
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v;
  }
  const d = new Date(v);
  if (!isNaN(d)) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }
  return String(v);
}

function cidadeUf(c, uf) {
  const partes = [c, uf].filter(Boolean).map(s => String(s).trim()).filter(Boolean);
  return partes.join('/');
}

function temRestricoes(dados) {
  const negativacoes = dados.negativacoes || {};
  const protestos = dados.protestos || {};
  const scoreCredito = dados.score_credito || {};
  const valorPend = Number(negativacoes.total_pendencias || 0);
  const statusNeg = (negativacoes.status || '').toLowerCase();
  const totalProtestos = Number(protestos.total || (negativacoes.protestos || []).length || 0);
  const sQuod = Number(scoreCredito.score || 0);
  if (valorPend > 0) return true;
  if (statusNeg.includes('pendenc') || statusNeg.includes('pendênc')) return true;
  if (totalProtestos > 0) return true;
  if (sQuod > 0 && sQuod < 300) return true;
  return false;
}

function blocoStatusRestricoes(doc, y, dados) {
  const com = temRestricoes(dados);
  const cor = com ? COR.vermelho : COR.verde;
  const fundo = com ? '#fee2e2' : '#dcfce7';
  const titulo = com ? 'COM RESTRIÇÕES' : 'SEM RESTRIÇÕES';
  const subtitulo = com
    ? 'Foram encontrados protestos, negativações ou score crítico.'
    : 'Nenhum protesto, negativação ou indicador crítico encontrado.';

  y = verificarPagina(doc, y, 70);
  doc.rect(MARGEM, y, LARGURA, 60).fill(fundo).stroke(cor);
  doc.fillColor(cor).fontSize(20).font('Helvetica-Bold')
    .text(titulo, MARGEM + 16, y + 12, { width: LARGURA - 32 });
  doc.fillColor('#111827').fontSize(9).font('Helvetica')
    .text(subtitulo, MARGEM + 16, y + 38, { width: LARGURA - 32 });
  return y + 70;
}

function blocoIdentificacao(doc, y, pedido, dados) {
  const cad = dados.receita_federal || {};
  const nome = pedido.alvo_nome || cad.nome || cad.razao_social || cad.nome_fantasia || '-';
  const isPJ = (pedido.alvo_tipo === 'PJ') || ((pedido.alvo_documento || '').replace(/\D/g, '').length === 14);
  const situacao = cad.situacao_rf || cad.situacao || '-';

  y = secao(doc, 'IDENTIFICAÇÃO DO CONSULTADO', y);
  y = linha(doc, isPJ ? 'Razão Social / Nome' : 'Nome', nome, y, 14);
  y = linha(doc, isPJ ? 'CNPJ' : 'CPF', formatarDoc(pedido.alvo_documento), y, 14);
  y = linha(doc, 'Situação RF', situacao || 'Não informada', y, 14);
  if (cad.aviso) {
    y = linha(doc, 'Observação', cad.aviso, y, 14);
  }
  return y + 4;
}

function blocoScoreQuod(doc, y, dados) {
  const sc = dados.score_credito || {};
  if (!sc.score) {
    y = secao(doc, 'SCORE DE CRÉDITO (QUOD)', y);
    doc.fillColor(COR.cinza).fontSize(8).font('Helvetica')
      .text('Score QUOD não retornou dados para este documento.', MARGEM, y);
    return y + 16;
  }
  y = secao(doc, 'SCORE DE CRÉDITO (QUOD)', y);
  const sQuod = Number(sc.score) || 0;
  const cor = sQuod >= 700 ? COR.verde : sQuod >= 400 ? COR.laranja : COR.vermelho;
  y = verificarPagina(doc, y, 50);
  doc.rect(MARGEM, y, LARGURA, 44).fill('#f8fafc').stroke(COR.borda);
  doc.fillColor(cor).fontSize(24).font('Helvetica-Bold')
    .text(`${sQuod}`, MARGEM + 12, y + 6, { width: 70, lineBreak: false });
  doc.fillColor(COR.cinza).fontSize(8).font('Helvetica')
    .text('/1000', MARGEM + 70, y + 24, { lineBreak: false });
  doc.fillColor(cor).fontSize(11).font('Helvetica-Bold')
    .text(sc.faixa || '-', MARGEM + 110, y + 8, { width: LARGURA - 120 });
  if (sc.motivos?.length > 0) {
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica');
    sc.motivos.slice(0, 2).forEach((m, i) => {
      doc.text(`• ${m}`, MARGEM + 110, y + 22 + (i * 9), { width: LARGURA - 120 });
    });
  }
  return y + 50;
}

function blocoProtestos(doc, y, dados) {
  const negativacoes = dados.negativacoes || {};
  const protestosFonte = dados.protestos || {};
  const protestosNegativacoes = negativacoes.protestos || [];
  // Lista combinada (DetalhamentoNegativo + endpoint Protestos puro)
  const protestosBruto = [
    ...protestosNegativacoes,
    ...(protestosFonte.protestos || [])
  ];

  y = secao(doc, 'PROTESTOS EM CARTÓRIO', y);

  if (!protestosBruto.length) {
    y = verificarPagina(doc, y, 22);
    doc.rect(MARGEM, y, LARGURA, 18).fill('#dcfce7');
    doc.fillColor('#14532d').fontSize(9).font('Helvetica-Bold')
      .text('NADA CONSTA — nenhum protesto encontrado.', MARGEM + 8, y + 4);
    return y + 26;
  }

  protestosBruto.slice(0, 10).forEach(p => {
    const cartorio = p.nome_cartorio || p.cartorio || 'Cartório';
    const valor = Number(p.valor_total_protesto || p.valor || 0);
    const localizacao = cidadeUf(p.cidade, p.uf);
    const devedor = p.devedor || '';
    const dataStr = formatarData(p.data);
    const titulos = (p.titulos || []).slice(0, 3);

    // Calcula altura dinamicamente para evitar encavalamento
    const linhasExtras =
      (localizacao ? 1 : 0) +
      (devedor ? 1 : 0) +
      (dataStr && !titulos.length ? 1 : 0) +
      titulos.length;
    const alturaCard = 14 + (linhasExtras * 9) + 6;

    y = verificarPagina(doc, y, alturaCard + 4);
    doc.rect(MARGEM, y, 3, alturaCard - 6).fill(COR.vermelho);
    doc.fillColor('#111827').fontSize(8).font('Helvetica-Bold')
      .text(cartorio, MARGEM + 10, y, { width: LARGURA - 130 });
    doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica-Bold')
      .text(formatarBRL(valor), MARGEM + LARGURA - 110, y, { width: 110, align: 'right' });
    y += 11;

    if (localizacao) {
      doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica')
        .text(`Local: ${localizacao}`, MARGEM + 10, y, { width: LARGURA - 12 });
      y += 9;
    }
    if (devedor) {
      doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica')
        .text(`Devedor: ${devedor}`, MARGEM + 10, y, { width: LARGURA - 12 });
      y += 9;
    }
    if (dataStr && !titulos.length) {
      doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica')
        .text(`Data: ${dataStr}`, MARGEM + 10, y, { width: LARGURA - 12 });
      y += 9;
    }
    titulos.forEach(t => {
      y = verificarPagina(doc, y, 10);
      const tData = formatarData(t.data);
      const tValor = formatarBRL(Number(t.valor || 0));
      const apresentante = t.apresentante ? ` — ${t.apresentante}` : '';
      const linhaTit = `  · ${t.tipo || 'Título'} — ${tValor}${tData ? ' — ' + tData : ''}${apresentante}`;
      doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica')
        .text(linhaTit, MARGEM + 16, y, { width: LARGURA - 18 });
      y += 9;
    });
    y += 4;
  });
  return y + 4;
}

function blocoNegativacoes(doc, y, dados) {
  const neg = dados.negativacoes || {};
  y = secao(doc, 'NEGATIVAÇÕES E PENDÊNCIAS FINANCEIRAS', y);

  const status = neg.status || '';
  const valorPend = Number(neg.total_pendencias || 0);
  const pendencias = Array.isArray(neg.pendencias) ? neg.pendencias : [];
  const acoes = neg.acoes_judiciais || [];
  const cheques = neg.cheques_sem_fundo || [];
  const falencias = neg.falencias || [];

  const semDados = !status || status === 'Nao consultado' || status === 'Não consultado';
  if (semDados) {
    doc.fillColor(COR.cinza).fontSize(8).font('Helvetica')
      .text('Consulta de negativações não realizada ou indisponível.', MARGEM, y);
    return y + 16;
  }

  const naoConsta = valorPend === 0 && pendencias.length === 0 && acoes.length === 0 && cheques.length === 0 && falencias.length === 0;
  if (naoConsta) {
    y = verificarPagina(doc, y, 22);
    doc.rect(MARGEM, y, LARGURA, 18).fill('#dcfce7');
    doc.fillColor('#14532d').fontSize(9).font('Helvetica-Bold')
      .text('NADA CONSTA — nenhuma negativação ativa.', MARGEM + 8, y + 4);
    return y + 26;
  }

  if (valorPend > 0) {
    y = verificarPagina(doc, y, 24);
    doc.rect(MARGEM, y, LARGURA, 20).fill('#fee2e2');
    doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold')
      .text(`Total em pendências: ${formatarBRL(valorPend)}${pendencias.length ? ` — ${pendencias.length} apontamento(s)` : ''}`, MARGEM + 8, y + 5);
    y += 26;
  }

  if (pendencias.length > 0) {
    doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica-Bold')
      .text('DETALHAMENTO POR CREDOR', MARGEM, y);
    y += 11;

    pendencias.slice(0, 20).forEach(p => {
      const credor = p.credor || 'Credor não informado';
      const valor = Number(p.valor || 0);
      const dataInc = formatarData(p.data_inclusao);
      const dataOco = formatarData(p.data_ocorrencia);
      const local = cidadeUf(p.cidade, p.uf);
      const tipo = p.tipo_contrato || '';
      const contrato = p.contrato || '';
      const situacao = p.situacao || '';

      // Linhas auxiliares (só as que tiverem conteúdo)
      const auxLinhas = [];
      if (tipo || contrato) {
        const partes = [tipo, contrato ? `Contrato ${contrato}` : ''].filter(Boolean);
        auxLinhas.push(partes.join(' — '));
      }
      const dataLine = [dataInc ? `Inclusão: ${dataInc}` : '', dataOco && dataOco !== dataInc ? `Ocorrência: ${dataOco}` : '']
        .filter(Boolean).join(' | ');
      if (dataLine) auxLinhas.push(dataLine);
      if (local || situacao) {
        const partes = [local, situacao].filter(Boolean);
        auxLinhas.push(partes.join(' — '));
      }

      doc.font('Helvetica').fontSize(7);
      const alturas = auxLinhas.map(t => doc.heightOfString(t, { width: LARGURA - 18 }));
      const alturaTotal = 13 + alturas.reduce((a, b) => a + b + 1, 0) + 4;
      y = verificarPagina(doc, y, alturaTotal + 4);

      // Barra lateral vermelha
      doc.rect(MARGEM, y, 3, alturaTotal - 4).fill(COR.vermelho);

      // Cabeçalho: credor à esquerda, valor à direita
      doc.fillColor('#111827').fontSize(8).font('Helvetica-Bold')
        .text(credor, MARGEM + 10, y, { width: LARGURA - 130 });
      doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica-Bold')
        .text(formatarBRL(valor), MARGEM + LARGURA - 110, y, { width: 110, align: 'right' });
      y += 11;

      // Linhas auxiliares
      auxLinhas.forEach((t, i) => {
        y = verificarPagina(doc, y, alturas[i] + 2);
        doc.fillColor(COR.cinza).fontSize(7).font('Helvetica')
          .text(t, MARGEM + 10, y, { width: LARGURA - 18 });
        y += alturas[i] + 1;
      });
      y += 4;
    });

    if (pendencias.length > 20) {
      y = verificarPagina(doc, y, 12);
      doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique')
        .text(`... mais ${pendencias.length - 20} apontamento(s) não exibido(s).`, MARGEM, y);
      y += 10;
    }
    y += 4;
  } else if (valorPend > 0) {
    // Total > 0 mas a base Boa Vista não retornou ocorrências individuais
    y = verificarPagina(doc, y, 32);
    doc.rect(MARGEM, y, LARGURA, 28).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(8).font('Helvetica')
      .text('A base Direct Data confirmou pendências (total acima), mas não retornou os apontamentos individuais para este documento. Para detalhamento credor a credor pode ser necessária consulta complementar SCPC/Serasa direta.', MARGEM + 8, y + 4, { width: LARGURA - 16 });
    y += 34;
  }

  if (acoes.length > 0) {
    doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica-Bold').text('AÇÕES JUDICIAIS REGISTRADAS', MARGEM, y); y += 11;
    acoes.slice(0, 6).forEach(a => {
      const txt = `• ${a.tipo || 'Ação'} — ${formatarBRL(Number(a.valor || 0))}${a.data ? ' — ' + formatarData(a.data) : ''}`;
      doc.font('Helvetica').fontSize(7);
      const h = doc.heightOfString(txt, { width: LARGURA - 12 });
      y = verificarPagina(doc, y, h + 2);
      doc.fillColor('#111827').text(txt, MARGEM + 6, y, { width: LARGURA - 12 });
      y += h + 1;
    });
    y += 4;
  }

  if (cheques.length > 0) {
    doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica-Bold').text('CHEQUES SEM FUNDO', MARGEM, y); y += 11;
    cheques.slice(0, 5).forEach(c => {
      const txt = `• Banco ${c.banco || '-'} | Ag. ${c.agencia || '-'}${c.data ? ' | ' + formatarData(c.data) : ''}`;
      doc.font('Helvetica').fontSize(7);
      const h = doc.heightOfString(txt, { width: LARGURA - 12 });
      y = verificarPagina(doc, y, h + 2);
      doc.fillColor('#111827').text(txt, MARGEM + 6, y, { width: LARGURA - 12 });
      y += h + 1;
    });
    y += 4;
  }

  if (falencias.length > 0) {
    doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica-Bold').text('FALÊNCIAS / RECUPERAÇÕES', MARGEM, y); y += 11;
    falencias.slice(0, 3).forEach(f => {
      const txt = `• ${f.tipo || 'Falência'}${f.data ? ' — ' + formatarData(f.data) : ''}`;
      doc.font('Helvetica').fontSize(7);
      const h = doc.heightOfString(txt, { width: LARGURA - 12 });
      y = verificarPagina(doc, y, h + 2);
      doc.fillColor('#111827').text(txt, MARGEM + 6, y, { width: LARGURA - 12 });
      y += h + 1;
    });
    y += 4;
  }

  doc.fillColor(COR.cinza).fontSize(6).font('Helvetica')
    .text(`Fonte: ${neg.fonte || 'Direct Data'}`, MARGEM, y);
  return y + 12;
}

function blocoParecer(doc, y, dados) {
  const com = temRestricoes(dados);
  y = secao(doc, 'PARECER FINAL', y);
  const cor = com ? COR.vermelho : COR.verde;
  const recomend = com
    ? 'Recomenda-se cautela: o documento apresenta restrições ativas. Avaliar exigência de garantias ou recusa da operação até regularização.'
    : 'Não foram encontradas restrições financeiras nas bases consultadas. Operação pode prosseguir com cautelas contratuais padrão.';
  y = verificarPagina(doc, y, 40);
  doc.fillColor('#111827').fontSize(9).font('Helvetica').text(recomend, MARGEM, y, { width: LARGURA });
  const h = doc.heightOfString(recomend, { width: LARGURA, fontSize: 9 });
  y += h + 6;
  doc.fillColor(cor).fontSize(10).font('Helvetica-Bold')
    .text(com ? 'Status: COM RESTRIÇÕES' : 'Status: SEM RESTRIÇÕES', MARGEM, y);
  return y + 16;
}

function render(doc, pedido, dados, score, checklist, produto) {
  let y = chrome.cabecalho(doc, pedido, produto);
  y = blocoStatusRestricoes(doc, y, dados);
  y = blocoIdentificacao(doc, y, pedido, dados);
  y = blocoScoreQuod(doc, y, dados);
  y = blocoProtestos(doc, y, dados);
  y = blocoNegativacoes(doc, y, dados);
  y = blocoParecer(doc, y, dados);

  // Fontes específicas: Direct Data apenas. blocoFinal já lista DD genérico.
  chrome.blocoFinal(doc, y, [
    'Direct Data — Detalhamento Negativo, Boa Vista Acerta/Define Limite e Protestos Nacional'
  ]);
}

module.exports = { render };
