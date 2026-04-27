/**
 * services/pdf/consulta_veicular.js
 * Consulta Veicular (R$ 97 base — modular com add-ons Credify).
 *
 * Fluxo próprio: não renderiza score/alertas gerais. Entrega:
 *  - Identificação do veículo
 *  - Proprietário atual
 *  - Histórico de proprietários (Credify /historicoproprietario)
 *  - Patrimônio veicular do proprietário (DirectData HistoricoVeiculos)
 *  - Situação e restrições (RENAJUD/RFB/roubo/furto/leilão/recall)
 *  - FIPE (quando retornado)
 */

const chrome = require('./chrome');
const {
  COR, MARGEM, LARGURA, verificarPagina,
  secao, linha, avisoBox, renderAlerta, truncar
} = require('./helpers');

function render(doc, pedido, dados, score, checklist, produto) {
  let y = chrome.cabecalho(doc, pedido, produto);

  const v = dados.veiculo_placa || {};

  y = secao(doc, 'ALVO DA CONSULTA', y);
  y = linha(doc, 'Placa', pedido.alvo_placa || v.placa || '-', y, 14);
  y = linha(doc, 'Solicitante', pedido.cliente_nome, y, 20);

  if (!v.disponivel) {
    const partes = [];
    if (v.erro) partes.push(v.erro);
    if (v.detalhes && v.detalhes !== v.erro) partes.push(v.detalhes);
    const msgErro = partes.join(' - ') || 'sem retorno da API';
    y = avisoBox(doc, y, `Consulta indisponível: ${msgErro}`);
    const diag = [];
    if (v.status_http) diag.push(`HTTP ${v.status_http}`);
    if (v.codigo_api) diag.push(`Código API: ${v.codigo_api}`);
    if (v.fonte) diag.push(v.fonte);
    if (diag.length) {
      doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(diag.join(' | '), MARGEM, y, { width: LARGURA });
      y += 14;
    }
    return;
  }

  // Identificação
  y = secao(doc, 'IDENTIFICACAO DO VEICULO', y);
  y = linha(doc, 'Marca / Modelo', v.marca_modelo || [v.marca, v.modelo].filter(Boolean).join(' ') || '-', y, 13);
  if (v.ano_modelo || v.ano_fabricacao) y = linha(doc, 'Ano', `${v.ano_fabricacao || '?'}/${v.ano_modelo || '?'}`, y, 13);
  if (v.cor) y = linha(doc, 'Cor', v.cor, y, 13);
  if (v.combustivel) y = linha(doc, 'Combustivel', v.combustivel, y, 13);
  if (v.chassi) y = linha(doc, 'Chassi', v.chassi, y, 13);
  if (v.renavam) y = linha(doc, 'Renavam', v.renavam, y, 13);
  if (v.tipo_veiculo) y = linha(doc, 'Tipo', v.tipo_veiculo, y, 13);
  if (v.categoria) y = linha(doc, 'Categoria', v.categoria, y, 13);
  if (v.especie) y = linha(doc, 'Especie', v.especie, y, 13);
  if (v.potencia) y = linha(doc, 'Potencia', String(v.potencia), y, 13);
  if (v.municipio || v.uf) y = linha(doc, 'Registro', [v.municipio, v.uf].filter(Boolean).join(' / '), y, 13);
  y += 6;

  if (v.proprietario || v.proprietario_documento) {
    y = secao(doc, 'PROPRIETARIO', y);
    if (v.proprietario) y = linha(doc, 'Nome', v.proprietario, y, 13);
    if (v.proprietario_documento) y = linha(doc, 'Documento', v.proprietario_documento, y, 13);
    if (v.ano_exercicio) y = linha(doc, 'Exercicio', String(v.ano_exercicio), y, 13);
    y += 6;
  }

  // Histórico de proprietários (Credify)
  const pp = dados.proprietarios_placa || {};
  if (pp.disponivel && Array.isArray(pp.proprietarios) && pp.proprietarios.length > 0) {
    y = secao(doc, 'HISTORICO DE PROPRIETARIOS', y);
    const lista = pp.proprietarios.slice(0, 10);
    const totalOculto = pp.proprietarios.length > 10 ? pp.proprietarios.length - 10 : 0;
    const ufsDistintas = new Set(lista.map(p => (p.uf_circulacao || '').toUpperCase()).filter(Boolean));
    const anos = lista.map(p => parseInt(p.exercicio, 10)).filter(n => n > 0);
    const janela = anos.length >= 2 ? Math.max(...anos) - Math.min(...anos) + 1 : null;
    const sinais = [];
    if (pp.proprietarios.length >= 3) sinais.push(`${pp.proprietarios.length} proprietários${janela ? ` em ${janela} ano(s)` : ''}`);
    if (ufsDistintas.size >= 2) sinais.push(`circulou em ${ufsDistintas.size} UFs (${Array.from(ufsDistintas).join(', ')})`);
    if (sinais.length > 0) {
      y = verificarPagina(doc, y, 20);
      doc.rect(MARGEM, y, LARGURA, 16).fill('#eff6ff');
      doc.fillColor('#1e40af').fontSize(8).font('Helvetica-Bold').text(`Padrão: ${sinais.join(' | ')}`, MARGEM + 8, y + 4, { width: LARGURA - 16, lineBreak: false });
      y += 20;
    }

    const colX = { exercicio: MARGEM + 6, documento: MARGEM + 58, nome: MARGEM + 180, uf: MARGEM + 420, data: MARGEM + 460 };
    y = verificarPagina(doc, y, 16 + lista.length * 14);
    doc.rect(MARGEM, y, LARGURA, 14).fill(COR.azul);
    doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
    doc.text('EXERC.', colX.exercicio, y + 4, { width: 48, lineBreak: false });
    doc.text('DOCUMENTO', colX.documento, y + 4, { width: 118, lineBreak: false });
    doc.text('NOME', colX.nome, y + 4, { width: 235, lineBreak: false });
    doc.text('UF', colX.uf, y + 4, { width: 36, lineBreak: false });
    doc.text('PAGAMENTO', colX.data, y + 4, { width: 85, lineBreak: false });
    y += 14;

    lista.forEach((p, i) => {
      y = verificarPagina(doc, y, 14);
      doc.rect(MARGEM, y, LARGURA, 13).fill(i % 2 === 0 ? '#ffffff' : '#f9fafb');
      doc.fillColor('#111827').fontSize(7.5).font('Helvetica');
      doc.text(p.exercicio || '-', colX.exercicio, y + 3, { width: 48, lineBreak: false });
      doc.text(p.documento_formatado || p.documento || '-', colX.documento, y + 3, { width: 118, lineBreak: false });
      doc.font('Helvetica-Bold').text(truncar(p.nome || '-', 42), colX.nome, y + 3, { width: 235, lineBreak: false });
      doc.font('Helvetica').text(p.uf_circulacao || '-', colX.uf, y + 3, { width: 36, lineBreak: false });
      doc.text(p.data_pagamento || '-', colX.data, y + 3, { width: 85, lineBreak: false });
      y += 13;
    });
    if (totalOculto > 0) {
      y = verificarPagina(doc, y, 14);
      doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique').text(`+${totalOculto} proprietário(s) anteriores não exibidos`, MARGEM + 6, y + 2);
      y += 12;
    }
    y += 8;
  } else if (pp.fonte && !pp.disponivel && pp.erro
             && !/DIRECTD_TOKEN|CREDIFY|Credify não configurada|Placa inválida|sucesso|success|sem dados|registro.*nao.*encontrado|nao.*consta|Sem hist/i.test(pp.erro)) {
    y = verificarPagina(doc, y, 14);
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique').text(`Histórico de proprietários indisponível: ${pp.erro}`, MARGEM, y);
    y += 14;
  }

  // Patrimônio veicular (DirectData HistoricoVeiculos do dono atual)
  const hv = dados.historico_veiculos_proprietario || {};
  if (hv.disponivel && Array.isArray(hv.veiculos) && hv.veiculos.length > 0) {
    y = secao(doc, 'PATRIMONIO VEICULAR DO PROPRIETARIO', y);
    const listaHV = hv.veiculos.slice(0, 15);
    const ocultoHV = hv.veiculos.length > 15 ? hv.veiculos.length - 15 : 0;

    y = verificarPagina(doc, y, 20);
    doc.rect(MARGEM, y, LARGURA, 16).fill('#eff6ff');
    const nomeDono = hv.proprietario || v.proprietario || 'Proprietario';
    doc.fillColor('#1e40af').fontSize(8).font('Helvetica-Bold').text(`${hv.total} veiculo(s) vinculado(s) a ${truncar(nomeDono, 55)}`, MARGEM + 8, y + 4, { width: LARGURA - 16, lineBreak: false });
    y += 20;

    const colHV = { placa: MARGEM + 6, veiculo: MARGEM + 68, renavam: MARGEM + 320, chassi: MARGEM + 400, data: MARGEM + 490 };
    y = verificarPagina(doc, y, 16 + listaHV.length * 14);
    doc.rect(MARGEM, y, LARGURA, 14).fill(COR.azul);
    doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
    doc.text('PLACA', colHV.placa, y + 4, { width: 58, lineBreak: false });
    doc.text('VEICULO', colHV.veiculo, y + 4, { width: 248, lineBreak: false });
    doc.text('RENAVAM', colHV.renavam, y + 4, { width: 76, lineBreak: false });
    doc.text('CHASSI', colHV.chassi, y + 4, { width: 86, lineBreak: false });
    doc.text('AQUIS.', colHV.data, y + 4, { width: 55, lineBreak: false });
    y += 14;

    listaHV.forEach((veic, i) => {
      y = verificarPagina(doc, y, 14);
      doc.rect(MARGEM, y, LARGURA, 13).fill(i % 2 === 0 ? '#ffffff' : '#f9fafb');
      doc.fillColor('#111827').fontSize(7.5).font('Helvetica');
      const descr = veic.veiculo || [veic.marca, veic.modelo].filter(Boolean).join(' ') || '-';
      doc.font('Helvetica-Bold').text(veic.placa || '-', colHV.placa, y + 3, { width: 58, lineBreak: false });
      doc.font('Helvetica').text(truncar(descr, 46), colHV.veiculo, y + 3, { width: 248, lineBreak: false });
      doc.text(veic.renavam || '-', colHV.renavam, y + 3, { width: 76, lineBreak: false });
      doc.text(truncar(veic.chassi || '-', 16), colHV.chassi, y + 3, { width: 86, lineBreak: false });
      doc.text(veic.data_aquisicao || '-', colHV.data, y + 3, { width: 55, lineBreak: false });
      y += 13;
    });
    if (ocultoHV > 0) {
      y = verificarPagina(doc, y, 14);
      doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique').text(`+${ocultoHV} veiculo(s) adicional(is) nao exibidos`, MARGEM + 6, y + 2);
      y += 12;
    }
    y += 8;
  } else if (hv.fonte && !hv.disponivel && hv.erro
             && !/DIRECTD_TOKEN|CPF\/CNPJ invalido|Nenhum veiculo|sucesso|success|sem dados|registro.*nao.*encontrado|nao.*consta/i.test(hv.erro)) {
    y = verificarPagina(doc, y, 14);
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique').text(`Patrimonio veicular do proprietario indisponivel: ${hv.erro}`, MARGEM, y);
    y += 14;
  }

  // Situação e restrições
  y = secao(doc, 'SITUAÇÃO E RESTRIÇÕES', y);
  y = linha(doc, 'Situação', v.situacao || 'Sem informação', y, 13);

  const ind = v.indicadores || {};
  const restricoesEstruturadas = [];
  if (ind.rouboFurto) restricoesEstruturadas.push({ tipo: 'ROUBO/FURTO', severidade: 'critico', texto: 'Veículo consta em registro de roubo ou furto. NÃO NEGOCIAR. Risco de apreensão e responsabilização criminal (art. 180 CP - receptação).' });
  if (ind.renajud) restricoesEstruturadas.push({ tipo: 'RENAJUD', severidade: 'critico', texto: 'Restrição judicial ativa (RENAJUD). Veículo penhorado ou sob ordem judicial. Transferência bloqueada até liberação pelo juízo.' });
  if (ind.rfb) restricoesEstruturadas.push({ tipo: 'RECEITA FEDERAL', severidade: 'critico', texto: 'Restrição da Receita Federal. Normalmente relacionada a dívida ativa, apreensão aduaneira ou pendência fiscal. Impede transferência.' });
  if (ind.leilao) restricoesEstruturadas.push({ tipo: 'LEILÃO', severidade: 'critico', texto: 'Veículo atualmente ou anteriormente em leilão. Verificar laudo de sinistro e categoria (avariado, recuperado, destinação especial).' });
  if (ind.pendenciaEmissao) restricoesEstruturadas.push({ tipo: 'DOCUMENTO PENDENTE', severidade: 'atencao', texto: 'Pendência de emissão de documento (CRLV). Pode indicar atraso no licenciamento, IPVA não quitado ou transferência não concretizada.' });
  if (ind.comunicadoVenda) restricoesEstruturadas.push({ tipo: 'COMUNICADO DE VENDA', severidade: 'atencao', texto: 'Vendedor anterior comunicou a venda ao DETRAN, mas transferência ainda não foi finalizada. Confirmar proprietário real antes da negociação.' });
  if (ind.renainf) restricoesEstruturadas.push({ tipo: 'INFRAÇÕES', severidade: 'atencao', texto: 'Infrações registradas no RENAINF. Multas podem gerar débito herdado ao novo proprietário — exigir comprovante de quitação.' });
  if (ind.alarme) restricoesEstruturadas.push({ tipo: 'ALARME', severidade: 'atencao', texto: 'Alarme registrado na base veicular. Investigar origem (b.o. não concluído, suspeita de clonagem, etc).' });
  if (ind.recall) restricoesEstruturadas.push({ tipo: 'RECALL', severidade: 'observar', texto: 'Veículo tem recall registrado pela montadora. Não impede negócio, mas convém confirmar se o reparo foi realizado junto à concessionária.' });

  if (Array.isArray(v.restricoes)) {
    const padroesVazios = [/^\s*SEM\s+RESTRI/i, /^\s*NADA\s+CONSTA/i, /^\s*N[AA\u00c3]O\s+CONSTA/i, /^\s*N[AA\u00c3]O\s+H[AA\u00c1]/i, /^\s*NENHUMA\s+RESTRI/i, /^\s*LIVRE/i];
    const mapeamentoIndicadores = [
      { regex: /COMUNIC/i, tipo: 'COMUNICADO DE VENDA' },
      { regex: /INTEN.{0,3}O.*VENDA/i, tipo: 'COMUNICADO DE VENDA' },
      { regex: /ROUBO|FURTO/i, tipo: 'ROUBO/FURTO' },
      { regex: /RENAJUD|JUDICIAL/i, tipo: 'RESTRIÇÃO JUDICIAL (RENAJUD)' },
      { regex: /RECEITA\s*FEDERAL|\bRFB\b/i, tipo: 'RECEITA FEDERAL' },
      { regex: /LEIL.{0,2}O/i, tipo: 'LEILÃO' },
      { regex: /PEND.{0,3}NCIA.*EMISS/i, tipo: 'PENDÊNCIA DE EMISSÃO' },
      { regex: /RECALL/i, tipo: 'RECALL' },
      { regex: /ALARME/i, tipo: 'ALARME REGISTRADO' },
      { regex: /MULTA|INFRA.{0,3}O|RENAINF/i, tipo: 'MULTAS (RENAINF)' }
    ];
    const rotuloLivre = (txt) => {
      if (/ALIENA.{0,3}O\s+FIDUCI/i.test(txt)) return 'ALIENAÇÃO FIDUCIÁRIA';
      if (/GRAVAME/i.test(txt)) return 'GRAVAME';
      if (/ARREND/i.test(txt)) return 'ARRENDAMENTO';
      if (/BLOQUEIO/i.test(txt)) return 'BLOQUEIO';
      if (/APREENS/i.test(txt)) return 'APREENSÃO';
      if (/INTERVENC/i.test(txt)) return 'INTERVENÇÃO';
      if (/RESTRIC/i.test(txt) || /RESTRI[CÇ][AAÃ]O/i.test(txt)) return 'RESTRIÇÃO ADMINISTRATIVA';
      return 'OUTRA RESTRIÇÃO';
    };

    v.restricoes.forEach(r => {
      if (!r) return;
      const txt = String(r).trim();
      if (!txt) return;
      if (padroesVazios.some(re => re.test(txt))) return;
      const indicadorEquiv = mapeamentoIndicadores.find(m => m.regex.test(txt));
      if (indicadorEquiv) {
        const jaTem = restricoesEstruturadas.some(x => x.tipo === indicadorEquiv.tipo);
        if (jaTem) return;
        restricoesEstruturadas.push({
          tipo: indicadorEquiv.tipo,
          severidade: indicadorEquiv.tipo === 'ROUBO/FURTO' ? 'critico' : 'atencao',
          texto: txt
        });
        return;
      }
      const tipoLivre = rotuloLivre(txt);
      const duplicada = restricoesEstruturadas.some(x => x.tipo === tipoLivre && (x.texto || '').toUpperCase() === txt.toUpperCase());
      if (!duplicada) {
        restricoesEstruturadas.push({
          tipo: tipoLivre,
          severidade: ['ALIENAÇÃO FIDUCIÁRIA', 'GRAVAME', 'BLOQUEIO', 'APREENSÃO'].includes(tipoLivre) ? 'atencao' : 'observar',
          texto: txt
        });
      }
    });
  }

  if (restricoesEstruturadas.length > 0) {
    const contSevV = { critico: 0, atencao: 0, observar: 0 };
    restricoesEstruturadas.forEach(r => { if (contSevV[r.severidade] !== undefined) contSevV[r.severidade]++; });
    const resumoSev = [];
    if (contSevV.critico) resumoSev.push(`${contSevV.critico} crítico(s)`);
    if (contSevV.atencao) resumoSev.push(`${contSevV.atencao} atenção`);
    if (contSevV.observar) resumoSev.push(`${contSevV.observar} observação`);
    y += 2;
    y = verificarPagina(doc, y, 24);
    doc.rect(MARGEM, y, LARGURA, 20).fill(contSevV.critico > 0 ? '#fee2e2' : '#fef3c7');
    doc.fillColor(contSevV.critico > 0 ? '#991b1b' : '#92400e').fontSize(9.5).font('Helvetica-Bold').text(`${restricoesEstruturadas.length} restrição(ões) identificada(s)`, MARGEM + 8, y + 5, { lineBreak: false });
    doc.fillColor(contSevV.critico > 0 ? '#991b1b' : '#92400e').fontSize(7.5).font('Helvetica').text(resumoSev.join(' | '), MARGEM + LARGURA - 200, y + 7, { width: 190, align: 'right', lineBreak: false });
    y += 24;

    const ordem = { critico: 0, atencao: 1, observar: 2 };
    const ordenadas = [...restricoesEstruturadas].sort((a, b) => (ordem[a.severidade] ?? 9) - (ordem[b.severidade] ?? 9));
    ordenadas.forEach(r => {
      y = renderAlerta(doc, y, { texto: `${r.tipo}: ${r.texto}`, severidade: r.severidade });
    });
  } else {
    y = verificarPagina(doc, y, 32);
    doc.rect(MARGEM, y, LARGURA, 28).fill('#d1fae5');
    doc.fillColor('#065f46').fontSize(9.5).font('Helvetica-Bold').text('Nenhuma restrição identificada', MARGEM + 8, y + 5, { lineBreak: false });
    doc.fillColor('#065f46').fontSize(7).font('Helvetica').text('RENAJUD, roubo/furto, Receita Federal, leilão, recall e RENAINF negativos', MARGEM + 8, y + 17, { width: LARGURA - 16, lineBreak: false });
    y += 32;
  }
  y += 6;

  if (v.fipe_valor || v.fipe_codigo) {
    y = secao(doc, 'AVALIACAO FIPE', y);
    if (v.fipe_valor) y = linha(doc, 'Valor FIPE', typeof v.fipe_valor === 'number' ? `R$ ${Number(v.fipe_valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : String(v.fipe_valor), y, 13);
    if (v.fipe_codigo) y = linha(doc, 'Codigo FIPE', v.fipe_codigo, y, 13);
    if (v.fipe_mes_referencia) y = linha(doc, 'Mes referencia', v.fipe_mes_referencia, y, 13);
    y += 6;
  }
}

module.exports = { render };
