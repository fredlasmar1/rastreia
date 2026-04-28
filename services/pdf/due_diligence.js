/**
 * services/pdf/due_diligence.js
 * Due Diligence Empresarial (R$ 997) — laudo completo p/ M&A, aquisição de
 * ponto/sociedade, crédito alto.
 *
 * Seções específicas frente a Dossiê PJ:
 *  - ANÁLISE DOS SÓCIOS (mini-dossiê de cada sócio).
 *  - PASSIVO JUDICIAL CNJ-a-CNJ (já em secaoProcessos rica).
 *  - SITUAÇÃO FISCAL DETALHADA (CND/FGTS/PGFN/Estadual/Municipal).
 *  - PATRIMÔNIO DA EMPRESA (imóveis + veículos + marcas + contratos).
 *  - ANÁLISE DE RISCO SEGMENTADA (trabalhista/fiscal/societário/judicial).
 *  - PARECER TÉCNICO FINAL com cláusulas contratuais recomendadas.
 */

const chrome = require('./chrome');
const {
  secaoCadastralPJ, secaoRegimeTributario,
  secaoProcessos, secaoListasNegrasDetalhadas,
  secaoProtestos, secaoVinculosSocietarios,
  secaoChecklist, secaoParecerAnalista
} = require('./sections');
const {
  COR, MARGEM, LARGURA, verificarPagina,
  secao, linha, boxEmIntegracao, truncar, parseValorCausa, formatarBRL
} = require('./helpers');

// ─── Análise dos sócios (mini-dossiê por sócio) ────────────────────
function secaoAnaliseSocios(doc, y, dados) {
  const cadastral = dados.receita_federal || {};
  const socios = cadastral.socios || [];
  y = secao(doc, 'ANÁLISE DOS SÓCIOS', y);

  if (!socios.length) {
    doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text('Nenhum sócio retornado pela base cadastral.', MARGEM, y);
    return y + 14;
  }

  doc.fillColor(COR.cinza).fontSize(7).font('Helvetica')
    .text(`${socios.length} sócio(s) identificado(s). Análise individual resumida — para dossiê PF completo de cada sócio, solicite produto dedicado.`, MARGEM, y, { width: LARGURA });
  y += 14;

  socios.forEach((s, i) => {
    y = verificarPagina(doc, y, 42);
    doc.rect(MARGEM, y, LARGURA, 38).fill(i % 2 === 0 ? '#f9fafb' : '#ffffff').stroke(COR.borda);
    doc.fillColor(COR.azul).fontSize(8.5).font('Helvetica-Bold').text(s.nome || '-', MARGEM + 8, y + 4, { width: LARGURA - 16 });
    const linha2 = [s.qualificacao, s.cpf ? `CPF ${s.cpf}` : null, s.desde ? `Desde: ${s.desde}` : null].filter(Boolean).join('  |  ');
    doc.fillColor('#111827').fontSize(7).font('Helvetica').text(linha2, MARGEM + 8, y + 16, { width: LARGURA - 16 });

    // Sinal rápido — consulta adicional é paga a parte
    const sinais = [];
    if (s.outras_empresas) sinais.push(`${s.outras_empresas} empresa(s) vinculada(s)`);
    if (s.processos_reu) sinais.push(`${s.processos_reu} processo(s) como réu`);
    if (s.lista_negra) sinais.push('lista negra federal');
    const txtSinal = sinais.length ? sinais.join(' | ') : 'Para dossiê PF detalhado deste sócio, consultar separadamente.';
    doc.fillColor(sinais.length ? COR.vermelho : COR.cinza).fontSize(6.5).font('Helvetica-Oblique')
      .text(txtSinal, MARGEM + 8, y + 27, { width: LARGURA - 16 });
    y += 42;
  });
  return y + 6;
}

// ─── Situação fiscal detalhada (Due Dil) ───────────────────────────
function secaoSituacaoFiscalCompleta(doc, y, dados) {
  const cadastral = dados.receita_federal || {};
  y = secao(doc, 'SITUAÇÃO FISCAL E REGULARIDADE', y);
  y = linha(doc, 'Situação RF', cadastral.situacao || '-', y, 13);
  y = linha(doc, 'CND Federal (PGFN)', dados.pgfn?.status || 'Em integração (Credify)', y, 13);
  y = linha(doc, 'Regularidade FGTS', dados.fgts?.status || 'Em integração (Credify)', y, 13);
  y = linha(doc, 'Débitos Estaduais (SEFAZ-GO)', dados.debitos_estaduais?.status || 'Em integração (Credify)', y, 13);
  y = linha(doc, 'Certidão Municipal', dados.cnd_municipal?.status || 'Em integração', y, 13);
  y = linha(doc, 'Débitos Simples', dados.debitos_simples?.status || 'Em integração', y, 13);
  return y + 4;
}

// ─── Patrimônio da empresa ─────────────────────────────────────────
function secaoPatrimonioEmpresa(doc, y, dados) {
  const imoveis = dados.imoveis_pj?.itens || [];
  const veiculos = dados.veiculos_pj?.itens || [];
  const marcas = dados.inpi?.marcas || [];
  const contratos = dados.contratos_publicos?.itens || [];

  y = secao(doc, 'PATRIMÔNIO DA EMPRESA', y);

  const temAlgo = imoveis.length || veiculos.length || marcas.length || contratos.length;
  if (!temAlgo) {
    return boxEmIntegracao(doc, y,
      'PATRIMÔNIO DA EMPRESA — Em integração',
      'Imóveis, veículos e marcas vinculados ao CNPJ serão disponibilizados via Credify (/veiculodocumentofrota, /rendapresumidacredify) no próximo release. Registro de marcas via INPI em integração.'
    );
  }

  if (imoveis.length) {
    doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('IMÓVEIS', MARGEM, y); y += 12;
    imoveis.slice(0, 10).forEach(im => {
      y = verificarPagina(doc, y, 14);
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${im.descricao || im.matricula || 'Imóvel'} | ${im.valor_estimado ? formatarBRL(im.valor_estimado) : 'valor N/D'} | ${im.cidade || ''}`, MARGEM + 6, y);
      y += 10;
    });
    y += 4;
  }

  if (veiculos.length) {
    doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('VEÍCULOS', MARGEM, y); y += 12;
    veiculos.slice(0, 10).forEach(v => {
      y = verificarPagina(doc, y, 11);
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${v.placa || '-'} ${v.veiculo || [v.marca, v.modelo].filter(Boolean).join(' ')}`, MARGEM + 6, y);
      y += 10;
    });
    y += 4;
  }

  if (marcas.length) {
    doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('MARCAS E PATENTES (INPI)', MARGEM, y); y += 12;
    marcas.slice(0, 5).forEach(m => {
      y = verificarPagina(doc, y, 10);
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${m.nome} | ${m.status || ''}`, MARGEM + 6, y);
      y += 9;
    });
    y += 4;
  }

  if (contratos.length) {
    doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('CONTRATOS PÚBLICOS', MARGEM, y); y += 12;
    contratos.slice(0, 5).forEach(c => {
      y = verificarPagina(doc, y, 10);
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${c.orgao || ''} | ${c.valor ? formatarBRL(c.valor) : ''} | ${c.vigencia || ''}`, MARGEM + 6, y);
      y += 9;
    });
    y += 4;
  }
  return y + 4;
}

// ─── Análise de Risco Segmentada ───────────────────────────────────
function secaoRiscoSegmentado(doc, y, dados) {
  const processos = dados.processos || {};
  const lista = processos.processos || [];
  const trabalhistas = lista.filter(p => /trabalh/i.test(p.classe || '') || /CLT/i.test(p.classe || ''));
  const execucoesFiscais = lista.filter(p => /execu.{0,3}o\s+fiscal/i.test(p.classe || ''));
  const civeis = lista.filter(p => !trabalhistas.includes(p) && !execucoesFiscais.includes(p));
  const listaNegra = (dados.transparencia?.em_lista_negra) || false;
  const socios = (dados.receita_federal?.socios || []).length;

  const nivel = (count, limites) => {
    if (count === 0) return { txt: 'BAIXO', cor: COR.verde };
    if (count <= limites[0]) return { txt: 'MODERADO', cor: COR.laranja };
    if (count <= limites[1]) return { txt: 'ALTO', cor: COR.vermelho };
    return { txt: 'CRÍTICO', cor: COR.vermelho };
  };

  y = secao(doc, 'ANÁLISE DE RISCO SEGMENTADA', y);

  const linhasRisco = [
    { titulo: 'Trabalhista', valor: trabalhistas.length, nivel: nivel(trabalhistas.length, [2, 5]), motivo: `${trabalhistas.length} processo(s) trabalhista(s) identificado(s)` },
    { titulo: 'Fiscal', valor: execucoesFiscais.length, nivel: nivel(execucoesFiscais.length, [1, 3]), motivo: `${execucoesFiscais.length} execução(ões) fiscal(is) identificada(s)` },
    { titulo: 'Judicial Cível', valor: civeis.length, nivel: nivel(civeis.length, [3, 8]), motivo: `${civeis.length} processo(s) cível/outros` },
    { titulo: 'Reputacional', valor: listaNegra ? 1 : 0, nivel: listaNegra ? { txt: 'CRÍTICO', cor: COR.vermelho } : { txt: 'BAIXO', cor: COR.verde }, motivo: listaNegra ? 'Consta em lista negra federal' : 'Não consta em lista negra' },
    { titulo: 'Societário', valor: socios, nivel: socios === 0 ? { txt: 'INDETERMINADO', cor: COR.cinza } : { txt: socios > 5 ? 'ALTO' : 'MODERADO', cor: socios > 5 ? COR.vermelho : COR.laranja }, motivo: `${socios} sócio(s) — verificar dossiê individual` }
  ];

  linhasRisco.forEach(r => {
    y = verificarPagina(doc, y, 22);
    doc.rect(MARGEM, y, LARGURA, 20).fill('#f9fafb').stroke(COR.borda);
    doc.fillColor(COR.azul).fontSize(8.5).font('Helvetica-Bold').text(r.titulo, MARGEM + 8, y + 4, { width: 110, lineBreak: false });
    doc.fillColor(r.nivel.cor).fontSize(9).font('Helvetica-Bold').text(r.nivel.txt, MARGEM + 120, y + 4, { width: 70, lineBreak: false });
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(r.motivo, MARGEM + 195, y + 6, { width: LARGURA - 200, lineBreak: false });
    y += 22;
  });
  return y + 6;
}

// ─── Parecer técnico final com recomendação + cláusulas ────────────
function secaoParecerTecnico(doc, y, dados, score) {
  y = secao(doc, 'PARECER TÉCNICO FINAL', y);

  const s = typeof score.score === 'number' ? score.score : 0;
  let recomendacao, corR, clausulas;
  if (s >= 70) {
    recomendacao = 'PROSSEGUIR — empresa apresenta perfil de baixo risco nas dimensões analisadas.';
    corR = COR.verde;
    clausulas = [
      'Declaração padrão de inexistência de passivos não declarados',
      'Obrigação de manter certidões negativas até o closing',
      'Representações e garantias sobre regularidade fiscal vigente'
    ];
  } else if (s >= 45) {
    recomendacao = 'PROSSEGUIR COM RESSALVAS — riscos identificados exigem mitigação contratual.';
    corR = COR.laranja;
    clausulas = [
      'Escrow (retenção) para cobrir passivos trabalhistas/fiscais identificados',
      'Cláusula de indenização específica para processos em curso',
      'Obrigação de entrega de certidões atualizadas + due diligence complementar',
      'Ajuste de preço baseado em laudo atuarial dos passivos',
      'Não-competição e retenção dos sócios atuais por prazo mínimo'
    ];
  } else {
    recomendacao = 'NÃO PROSSEGUIR — risco elevado inviabiliza a operação nos termos propostos.';
    corR = COR.vermelho;
    clausulas = [
      'Operação não recomendada. Reavaliar após quitação dos passivos críticos.',
      'Se for prosseguir: exigir saneamento integral antes do closing (condição precedente)',
      'Estrutura de earn-out integral com liberação condicionada a saneamento'
    ];
  }

  y = verificarPagina(doc, y, 24);
  doc.rect(MARGEM, y, LARGURA, 22).fill(corR === COR.vermelho ? '#fee2e2' : corR === COR.laranja ? '#fef3c7' : '#dcfce7');
  doc.fillColor(corR).fontSize(9.5).font('Helvetica-Bold').text(recomendacao, MARGEM + 8, y + 5, { width: LARGURA - 16 });
  y += 28;

  doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('CLÁUSULAS CONTRATUAIS RECOMENDADAS', MARGEM, y); y += 12;
  clausulas.forEach((c, i) => {
    y = verificarPagina(doc, y, 14);
    doc.fillColor('#111827').fontSize(7.5).font('Helvetica').text(`${i + 1}. ${c}`, MARGEM + 6, y, { width: LARGURA - 12 });
    y += doc.heightOfString(c, { width: LARGURA - 12, fontSize: 7.5 }) + 3;
  });
  return y + 6;
}

function render(doc, pedido, dados, score, checklist, produto) {
  let y = chrome.cabecalho(doc, pedido, produto);
  y = chrome.resumoExecutivo(doc, y, score);
  y = chrome.blocoAlvo(doc, y, pedido);
  y = chrome.blocoAlertasDetalhados(doc, y, score);
  y = chrome.blocoComposicaoScore(doc, y, score);

  // ── Bloco 1: Identificação e estrutura societária ───────────────
  y = secaoCadastralPJ(doc, y, dados);
  y = secaoRegimeTributario(doc, y, dados);
  y = secaoAnaliseSocios(doc, y, dados);

  // ── Bloco 2: Situação fiscal e regulatória ──────────────────────
  y = secaoSituacaoFiscalCompleta(doc, y, dados);
  y = secaoListasNegrasDetalhadas(doc, y, dados);

  // ── Bloco 3: Passivo judicial ───────────────────────────────────
  y = secaoProcessos(doc, y, dados, pedido);
  y = secaoProtestos(doc, y, dados);

  // ── Bloco 4: Patrimônio ─────────────────────────────────────────
  y = secaoPatrimonioEmpresa(doc, y, dados);
  y = secaoVinculosSocietarios(doc, y, dados);

  // ── Bloco 5: Conclusão ──────────────────────────────────────────
  y = secaoRiscoSegmentado(doc, y, dados);
  y = secaoChecklist(doc, y, checklist);
  y = secaoParecerTecnico(doc, y, dados, score);
  y = secaoParecerAnalista(doc, y, pedido);

  chrome.blocoFinal(doc, y);
}

module.exports = { render };
