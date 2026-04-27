/**
 * services/pdf/due_diligence_imobiliaria.js
 * Due Diligence Imobiliária (R$ 997).
 *
 * Estrutura exigida (produtos.js):
 *   COMPRADOR | VENDEDOR | IMÓVEL | PARECER FINAL
 *
 * Como o pedido carrega um único `alvo_documento`, cada lado
 * (comprador/vendedor/imóvel) é servido a partir de `dados.comprador`,
 * `dados.vendedor` e `dados.imovel` caso estejam presentes. Se o
 * pedido ainda estiver em modo "alvo único" (legado), renderiza o
 * alvo no papel indicado em `pedido.papel` (default: vendedor) e
 * apresenta o outro lado como "em integração".
 */

const chrome = require('./chrome');
const {
  COR, MARGEM, LARGURA, verificarPagina,
  secao, linha, boxEmIntegracao, formatarBRL, formatarDoc
} = require('./helpers');

// ─── Blocos de análise IA (matrícula/escritura via Claude) ────────
function corSeveridade(sev) {
  const s = (sev || '').toLowerCase();
  if (s === 'alta') return { bg: '#fee2e2', fg: COR.vermelho, label: 'ALTA' };
  if (s === 'media') return { bg: '#fef3c7', fg: COR.laranja, label: 'MÉDIA' };
  return { bg: '#dcfce7', fg: '#065f46', label: 'BAIXA' };
}

function rotuloCategoria(c) {
  const m = {
    proprietarios: 'Proprietários',
    transmissoes: 'Transmissões',
    onus: 'Ônus & Gravames',
    endereco: 'Endereço',
    documento: 'Documentos',
    outro: 'Outros'
  };
  return m[(c || '').toLowerCase()] || 'Outros';
}

function blocoDocumentosAnalisados(doc, y, analise) {
  const docs = Array.isArray(analise?.documentos_processados) ? analise.documentos_processados : [];
  if (!docs.length) return y;
  y = secao(doc, 'DOCUMENTOS ANALISADOS PELA IA', y);
  for (const d of docs) {
    y = verificarPagina(doc, y, 18);
    const irrel = !!d.irrelevante;
    const bg = irrel ? '#fef3c7' : '#f3f4f6';
    const fg = irrel ? '#92400e' : '#111827';
    doc.rect(MARGEM, y, LARGURA, 16).fill(bg).stroke('#e5e7eb');
    const tipoLbl = irrel ? `${(d.tipo || 'outro').toUpperCase()} (não reconhecido)` : (d.tipo || '-').toUpperCase();
    doc.fillColor(fg).fontSize(7.5).font('Helvetica-Bold').text(tipoLbl, MARGEM + 6, y + 4, { width: 160, lineBreak: false });
    const linhaResumo = [
      d.filename || '-',
      d.resumo_curto ? `· ${d.resumo_curto}` : null
    ].filter(Boolean).join(' ');
    doc.fillColor('#374151').fontSize(7).font('Helvetica').text(linhaResumo, MARGEM + 170, y + 5, { width: LARGURA - 180, lineBreak: false });
    y += 18;
  }
  return y + 4;
}

function blocoResumoExecutivoIA(doc, y, analise) {
  if (!analise) return y;
  y = secao(doc, 'RESUMO EXECUTIVO — ANÁLISE DOS DOCUMENTOS (IA)', y);

  const resumo = (analise.resumo_executivo || '').toString().trim();
  if (resumo) {
    const altura = doc.heightOfString(resumo, { width: LARGURA - 16, fontSize: 9 }) + 14;
    y = verificarPagina(doc, y, altura + 4);
    doc.rect(MARGEM, y, LARGURA, altura).fill('#eff6ff').stroke('#bfdbfe');
    doc.fillColor('#1e3a8a').fontSize(9).font('Helvetica').text(resumo, MARGEM + 8, y + 7, { width: LARGURA - 16 });
    y += altura + 8;
  }

  const alertas = Array.isArray(analise.alertas) ? analise.alertas : [];
  if (!alertas.length) return y + 4;

  // Agrupa por categoria
  const grupos = {};
  for (const a of alertas) {
    const cat = (a.categoria || 'outro').toLowerCase();
    if (!grupos[cat]) grupos[cat] = [];
    grupos[cat].push(a);
  }
  const ordem = ['proprietarios', 'transmissoes', 'onus', 'endereco', 'documento', 'outro'];
  const cats = Object.keys(grupos).sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));

  doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text(`ALERTAS IDENTIFICADOS (${alertas.length})`, MARGEM, y);
  y += 14;

  for (const cat of cats) {
    y = verificarPagina(doc, y, 16);
    doc.fillColor('#374151').fontSize(8).font('Helvetica-Bold').text(rotuloCategoria(cat).toUpperCase() + ` (${grupos[cat].length})`, MARGEM, y);
    y += 12;
    for (const a of grupos[cat]) {
      const sev = corSeveridade(a.severidade);
      const tit = (a.titulo || '-').toString();
      const desc = (a.descricao || '').toString();
      const hDesc = desc ? doc.heightOfString(desc, { width: LARGURA - 90, fontSize: 7.5 }) : 0;
      const altura = Math.max(22, hDesc + 14);
      y = verificarPagina(doc, y, altura + 4);
      doc.rect(MARGEM, y, LARGURA, altura).fill(sev.bg).stroke('#e5e7eb');
      doc.rect(MARGEM + 6, y + 5, 60, 12).fill(sev.fg);
      doc.fillColor('#fff').fontSize(7).font('Helvetica-Bold').text(sev.label, MARGEM + 6, y + 8, { width: 60, align: 'center' });
      doc.fillColor(sev.fg).fontSize(8.5).font('Helvetica-Bold').text(tit, MARGEM + 72, y + 5, { width: LARGURA - 80 });
      if (desc) {
        doc.fillColor('#374151').fontSize(7.5).font('Helvetica').text(desc, MARGEM + 72, y + 16, { width: LARGURA - 80 });
      }
      y += altura + 4;
    }
    y += 2;
  }
  return y + 4;
}

function blocoOnusIA(doc, y, analise) {
  const onus = Array.isArray(analise?.onus_e_gravames) ? analise.onus_e_gravames : [];
  if (!onus.length) return y;
  y = secao(doc, 'ÔNUS E GRAVAMES (IA — extraídos dos documentos)', y);
  for (const o of onus) {
    y = verificarPagina(doc, y, 22);
    const ativo = o.ativo === true;
    const bg = ativo ? '#fef2f2' : '#f9fafb';
    const borda = ativo ? '#fecaca' : '#e5e7eb';
    doc.rect(MARGEM, y, LARGURA, 20).fill(bg).stroke(borda);
    const tipo = (o.tipo || 'gravame').toString().toUpperCase();
    const tag = ativo ? '[ATIVO]' : '[BAIXADO]';
    doc.fillColor(ativo ? COR.vermelho : '#6b7280').fontSize(8).font('Helvetica-Bold').text(`${tipo}  ${tag}`, MARGEM + 6, y + 4, { width: 200, lineBreak: false });
    const linha2 = [
      o.credor ? `Credor: ${o.credor}` : null,
      o.valor != null ? `Valor: ${formatarBRL(o.valor)}` : null,
      o.data ? `Data: ${o.data}` : null
    ].filter(Boolean).join('  |  ');
    doc.fillColor('#374151').fontSize(7).font('Helvetica').text(linha2 || '-', MARGEM + 6, y + 12, { width: LARGURA - 12 });
    y += 22;
  }
  return y + 4;
}

function blocoTransmissoesIA(doc, y, analise) {
  const trans = Array.isArray(analise?.transmissoes) ? analise.transmissoes : [];
  if (!trans.length) return y;
  y = secao(doc, 'HISTÓRICO DE TRANSMISSÕES (IA)', y);
  for (const t of trans) {
    y = verificarPagina(doc, y, 18);
    doc.rect(MARGEM, y, LARGURA, 16).fill('#f9fafb').stroke('#e5e7eb');
    const cab = `${t.data || '-'}  |  ${t.tipo || '-'}`;
    doc.fillColor('#111827').fontSize(7.5).font('Helvetica-Bold').text(cab, MARGEM + 6, y + 3, { width: LARGURA - 12, lineBreak: false });
    const linha2 = [
      `${t.de_nome || '-'}${t.de_cpf_cnpj ? ' (' + formatarDoc(t.de_cpf_cnpj) + ')' : ''}`,
      '→',
      `${t.para_nome || '-'}${t.para_cpf_cnpj ? ' (' + formatarDoc(t.para_cpf_cnpj) + ')' : ''}`,
      t.valor != null ? `· ${formatarBRL(t.valor)}` : ''
    ].join(' ');
    doc.fillColor('#374151').fontSize(7).font('Helvetica').text(linha2, MARGEM + 6, y + 11, { width: LARGURA - 12, lineBreak: false });
    y += 18;
  }
  return y + 4;
}

function blocoIdentificacaoIA(doc, y, analise) {
  if (!analise) return y;
  y = secao(doc, 'IDENTIFICAÇÃO DO IMÓVEL (IA)', y);
  const id = analise.identificacao || {};
  if (id.matricula_numero) y = linha(doc, 'Matrícula', String(id.matricula_numero), y, 13);
  if (id.cartorio) y = linha(doc, 'Cartório', String(id.cartorio), y, 13);
  if (id.endereco_completo) y = linha(doc, 'Endereço', String(id.endereco_completo), y, 13);
  if (id.area_total_m2 != null) y = linha(doc, 'Área Total', `${id.area_total_m2} m²`, y, 13);
  if (id.area_construida_m2 != null) y = linha(doc, 'Área Construída', `${id.area_construida_m2} m²`, y, 13);
  if (id.inscricao_municipal) y = linha(doc, 'Inscrição Municipal', String(id.inscricao_municipal), y, 13);
  if (id.natureza) y = linha(doc, 'Natureza', String(id.natureza), y, 13);
  return y + 4;
}

function blocoProprietariosIA(doc, y, analise) {
  if (!analise) return y;
  const props = Array.isArray(analise.proprietarios) ? analise.proprietarios.slice() : [];
  if (!props.length) return y;
  y = secao(doc, 'HISTÓRICO DE PROPRIETÁRIOS (IA)', y);

  // ordena: atual primeiro, depois por data desc (mais recente -> mais antigo)
  props.sort((a, b) => {
    if (a.atual && !b.atual) return -1;
    if (!a.atual && b.atual) return 1;
    return String(b.data_aquisicao || '').localeCompare(String(a.data_aquisicao || ''));
  });

  for (const p of props) {
    y = verificarPagina(doc, y, 30);
    const altura = 28;
    const bg = p.atual ? '#dcfce7' : '#f9fafb';
    const borda = p.atual ? '#86efac' : '#e5e7eb';
    doc.rect(MARGEM, y, LARGURA, altura).fill(bg).stroke(borda);
    const nome = (p.nome || '-').toString();
    const cpfCnpj = formatarDoc(p.cpf_cnpj) || '-';
    const tag = p.atual ? '  [ATUAL]' : '';
    doc.fillColor('#111827').fontSize(8.5).font('Helvetica-Bold').text(nome + tag, MARGEM + 8, y + 5, { width: LARGURA - 16 });
    const linha2 = [
      `CPF/CNPJ: ${cpfCnpj}`,
      p.tipo_aquisicao ? `Aquisição: ${p.tipo_aquisicao}` : null,
      p.data_aquisicao ? `Data: ${p.data_aquisicao}` : null,
      p.valor_transacao != null ? `Valor: ${formatarBRL(p.valor_transacao)}` : null
    ].filter(Boolean).join('  |  ');
    doc.fillColor('#4b5563').fontSize(7.5).font('Helvetica').text(linha2, MARGEM + 8, y + 17, { width: LARGURA - 16 });
    y += altura + 4;
  }
  return y + 4;
}
const {
  secaoProcessos, secaoProtestos, secaoScoreCredito,
  secaoChecklist, secaoParecerAnalista
} = require('./sections');

// ─── Bloco Pessoa (reusado p/ comprador e vendedor) ───────────────
function blocoPessoa(doc, y, titulo, pessoa) {
  y = secao(doc, titulo.toUpperCase(), y);
  if (!pessoa) {
    return boxEmIntegracao(doc, y,
      `${titulo} — Em integração`,
      'Identificação deste lado da transação será coletada após confirmação do comprador/vendedor. Para consulta completa, informar CPF separadamente no pedido.'
    );
  }
  y = linha(doc, 'Nome', pessoa.nome || '-', y, 13);
  y = linha(doc, 'CPF/CNPJ', formatarDoc(pessoa.documento) || '-', y, 13);
  if (pessoa.data_nascimento) y = linha(doc, 'Nascimento', pessoa.data_nascimento, y, 13);
  if (pessoa.situacao_rf) y = linha(doc, 'Situacao RF', pessoa.situacao_rf, y, 13);
  if (pessoa.renda_estimada) y = linha(doc, 'Renda Estimada', pessoa.renda_estimada, y, 13);
  if (pessoa.score_credito) y = linha(doc, 'Score Credito', `${pessoa.score_credito}/1000`, y, 13);
  if (pessoa.processos_total != null) y = linha(doc, 'Processos', `${pessoa.processos_total} total${pessoa.processos_ativos != null ? ` (${pessoa.processos_ativos} ativo(s))` : ''}`, y, 13);
  if (pessoa.protestos_valor) y = linha(doc, 'Protestos (valor)', formatarBRL(pessoa.protestos_valor), y, 13);
  if (pessoa.penhoras_ativas) y = linha(doc, 'Penhoras Ativas', String(pessoa.penhoras_ativas), y, 13);
  if (pessoa.outros_imoveis) y = linha(doc, 'Outros Imoveis', String(pessoa.outros_imoveis), y, 13);
  return y + 6;
}

// ─── Comprador (capacidade de pagamento) ──────────────────────────
function secaoComprador(doc, y, dados, pedido) {
  const comprador = dados.comprador || (pedido.papel === 'comprador' ? _montarLadoFromAlvo(dados, pedido) : null);
  let yOut = blocoPessoa(doc, y, 'COMPRADOR', comprador);

  if (comprador) {
    yOut = verificarPagina(doc, yOut, 22);
    const cap = (() => {
      const score = Number(comprador.score_credito || 0);
      const pend = Number(comprador.protestos_valor || 0);
      if (score >= 700 && pend === 0) return { txt: 'ALTA — bom pagador, sem restrições', cor: COR.verde };
      if (score >= 500 && pend === 0) return { txt: 'MÉDIA — score moderado', cor: COR.laranja };
      if (score >= 500) return { txt: 'MÉDIA COM RESSALVAS — score ok mas com pendências', cor: COR.laranja };
      if (score > 0) return { txt: 'BAIXA — score ruim e/ou pendências', cor: COR.vermelho };
      return { txt: 'Indeterminada — dados insuficientes', cor: COR.cinza };
    })();
    doc.rect(MARGEM, yOut, LARGURA, 18).fill('#f9fafb');
    doc.fillColor(cap.cor).fontSize(8).font('Helvetica-Bold').text(`Capacidade de pagamento: ${cap.txt}`, MARGEM + 8, yOut + 5, { width: LARGURA - 16 });
    yOut += 22;
  }
  return yOut;
}

// ─── Vendedor (penhoras e execuções) ──────────────────────────────
function secaoVendedor(doc, y, dados, pedido) {
  const vendedor = dados.vendedor || (pedido.papel === 'vendedor' || !pedido.papel ? _montarLadoFromAlvo(dados, pedido) : null);
  let yOut = blocoPessoa(doc, y, 'VENDEDOR', vendedor);

  if (vendedor) {
    const alerta = [];
    if (vendedor.penhoras_ativas > 0) alerta.push(`${vendedor.penhoras_ativas} penhora(s) ativa(s)`);
    if (vendedor.processos_ativos > 5) alerta.push(`${vendedor.processos_ativos} processo(s) ativo(s)`);
    if (vendedor.protestos_valor > 0) alerta.push(`${formatarBRL(vendedor.protestos_valor)} em protestos`);
    if (alerta.length) {
      yOut = verificarPagina(doc, yOut, 22);
      doc.rect(MARGEM, yOut, LARGURA, 20).fill('#fee2e2');
      doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica-Bold').text(`ALERTA: ${alerta.join(' | ')}`, MARGEM + 8, yOut + 5, { width: LARGURA - 16 });
      doc.fillColor('#991b1b').fontSize(7).font('Helvetica').text('Risco de fraude à execução se a venda for concretizada com penhoras ativas.', MARGEM + 8, yOut + 13, { width: LARGURA - 16 });
      yOut += 24;
    }
  }
  return yOut;
}

// ─── Imóvel (matrícula + ônus) ─────────────────────────────────────
function secaoImovel(doc, y, dados, pedido) {
  const imovel = dados.imovel || {};
  y = secao(doc, 'IMÓVEL', y);

  if (!imovel.endereco && !imovel.matricula) {
    return boxEmIntegracao(doc, y,
      'DADOS DO IMÓVEL — Em integração',
      'Matrícula digital e pesquisa de ônus/gravames via ONR (Operador Nacional do Registro) em integração. Para consulta imediata, solicitar certidão de matrícula atualizada ao cartório de registro do imóvel.'
    );
  }

  if (imovel.endereco) y = linha(doc, 'Endereco', imovel.endereco, y, 13);
  if (imovel.matricula) y = linha(doc, 'Matricula', imovel.matricula, y, 13);
  if (imovel.cartorio) y = linha(doc, 'Cartorio', imovel.cartorio, y, 13);
  if (imovel.area_total) y = linha(doc, 'Area Total', `${imovel.area_total} m²`, y, 13);
  if (imovel.valor_venal) y = linha(doc, 'Valor Venal', formatarBRL(imovel.valor_venal), y, 13);
  if (imovel.valor_mercado) y = linha(doc, 'Valor de Mercado', formatarBRL(imovel.valor_mercado), y, 13);

  const onus = imovel.onus || [];
  y += 2;
  if (!onus.length) {
    y = verificarPagina(doc, y, 22);
    doc.rect(MARGEM, y, LARGURA, 20).fill('#dcfce7');
    doc.fillColor('#065f46').fontSize(8).font('Helvetica-Bold').text('MATRÍCULA LIVRE DE ÔNUS', MARGEM + 8, y + 5);
    doc.fillColor('#065f46').fontSize(7).font('Helvetica').text('Sem hipoteca, alienação fiduciária, penhora ou arresto registrado na data da consulta.', MARGEM + 8, y + 13, { width: LARGURA - 16 });
    y += 24;
  } else {
    doc.fillColor(COR.vermelho).fontSize(8.5).font('Helvetica-Bold').text(`ÔNUS E GRAVAMES REGISTRADOS (${onus.length})`, MARGEM, y); y += 12;
    onus.forEach(o => {
      y = verificarPagina(doc, y, 18);
      doc.rect(MARGEM, y, LARGURA, 16).fill('#fef2f2').stroke('#fecaca');
      doc.fillColor(COR.vermelho).fontSize(7.5).font('Helvetica-Bold').text(o.tipo || 'Gravame', MARGEM + 6, y + 3, { width: 140, lineBreak: false });
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(o.descricao || '-', MARGEM + 150, y + 3, { width: LARGURA - 160, lineBreak: false });
      if (o.credor) doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica').text(`Credor: ${o.credor}`, MARGEM + 6, y + 11, { width: LARGURA - 12 });
      y += 18;
    });
  }

  const trans = imovel.transferencias || [];
  if (trans.length) {
    y += 4;
    doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('HISTÓRICO DE TRANSFERÊNCIAS', MARGEM, y); y += 12;
    trans.slice(0, 10).forEach(t => {
      y = verificarPagina(doc, y, 11);
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${t.data || ''} | ${t.de || '-'} -> ${t.para || '-'} | ${t.valor ? formatarBRL(t.valor) : ''}`, MARGEM + 6, y, { width: LARGURA - 12 });
      y += 10;
    });
  }
  return y + 6;
}

// ─── Parecer final (recomendação + cláusulas + docs) ───────────────
function secaoParecerImobiliario(doc, y, dados, score) {
  y = secao(doc, 'PARECER FINAL', y);

  const imovel = dados.imovel || {};
  const vendedor = dados.vendedor || {};
  const comprador = dados.comprador || {};
  const onus = (imovel.onus || []).length;
  const execVendedor = Number(vendedor.processos_ativos || 0);
  const capComprador = Number(comprador.score_credito || 0);

  let rec, cor, clausulas, docs;
  const riscoAlto = onus > 0 || execVendedor > 3 || capComprador < 400;
  const riscoMedio = !riscoAlto && (execVendedor > 0 || capComprador < 600 || !imovel.matricula);

  if (riscoAlto) {
    rec = 'NÃO PROSSEGUIR — há ônus registrado, execução ativa contra vendedor ou comprador sem crédito. Risco de fraude à execução ou inadimplência.';
    cor = COR.vermelho;
    clausulas = [
      'Operação não recomendada. Saneamento integral dos ônus antes de retomar as tratativas.',
      'Se houver interesse do comprador em prosseguir: escritura só após quitação + baixa dos gravames.'
    ];
    docs = [
      'Certidão de matrícula atualizada (até 30 dias)',
      'Certidão de ônus reais com averbação de saneamento',
      'Certidões de distribuição cíveis e trabalhistas do vendedor'
    ];
  } else if (riscoMedio) {
    rec = 'PROSSEGUIR COM RESSALVAS — avaliar mitigadores contratuais antes da assinatura.';
    cor = COR.laranja;
    clausulas = [
      'Retenção de parte do preço em conta escrow até averbação da transferência',
      'Garantia real complementar ou aval se comprador tiver score médio-baixo',
      'Cláusula resolutiva expressa em caso de surgimento de ônus antes do registro',
      'Obrigação do vendedor de exibir quitação de débitos (IPTU, condomínio, PGFN)'
    ];
    docs = [
      'Certidão de matrícula atualizada + certidão vintenária',
      'Certidões negativas cíveis, trabalhistas e fiscais (federal, estadual, municipal) do vendedor',
      'Comprovante de quitação de IPTU e condomínio',
      'Comprovação de capacidade de pagamento do comprador'
    ];
  } else {
    rec = 'PROSSEGUIR — matrícula limpa, vendedor sem restrições e comprador com capacidade.';
    cor = COR.verde;
    clausulas = [
      'Cláusula padrão de evicção',
      'Obrigação de manter imóvel livre de ônus até o registro',
      'Prazo de escrituração em 30 dias'
    ];
    docs = [
      'Certidão de matrícula atualizada (até 30 dias)',
      'Certidões negativas cíveis, trabalhistas e fiscais do vendedor',
      'Comprovante de quitação de IPTU e condomínio'
    ];
  }

  y = verificarPagina(doc, y, 24);
  doc.rect(MARGEM, y, LARGURA, 22).fill(cor === COR.vermelho ? '#fee2e2' : cor === COR.laranja ? '#fef3c7' : '#dcfce7');
  doc.fillColor(cor).fontSize(9).font('Helvetica-Bold').text(rec, MARGEM + 8, y + 5, { width: LARGURA - 16 });
  y += 28;

  doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('CLÁUSULAS CONTRATUAIS SUGERIDAS', MARGEM, y); y += 12;
  clausulas.forEach((c, i) => {
    y = verificarPagina(doc, y, 14);
    doc.fillColor('#111827').fontSize(7.5).font('Helvetica').text(`${i + 1}. ${c}`, MARGEM + 6, y, { width: LARGURA - 12 });
    y += doc.heightOfString(c, { width: LARGURA - 12, fontSize: 7.5 }) + 3;
  });
  y += 6;

  doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('DOCUMENTOS A EXIGIR ANTES DA ASSINATURA', MARGEM, y); y += 12;
  docs.forEach((d, i) => {
    y = verificarPagina(doc, y, 12);
    doc.fillColor('#111827').fontSize(7.5).font('Helvetica').text(`${i + 1}. ${d}`, MARGEM + 6, y, { width: LARGURA - 12 });
    y += 11;
  });
  return y + 6;
}

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// V3: enumera todos os alvos consultados (1 a N), com origem (manual ou IA)
// e resumo do que foi encontrado em cada um.
function secaoAlvosConsultados(doc, y, dados, pedido) {
  const alvos = Array.isArray(pedido.alvos_consultados) ? pedido.alvos_consultados : [];
  if (!alvos.length) return y;

  y = secao(doc, `ALVOS CONSULTADOS (${alvos.length})`, y);
  alvos.forEach((alvo, idx) => {
    const sufixo = idx === 0 ? '' : `_${idx + 1}`;
    const cad = dados[`receita_federal${sufixo}`] || {};
    const sc = dados[`score_credito${sufixo}`] || {};
    const neg = dados[`negativacoes${sufixo}`] || {};
    const proc = dados[`processos${sufixo}`] || {};
    const vinc = dados[`vinculos${sufixo}`] || {};

    y = verificarPagina(doc, y, 70);
    const origemLbl = alvo.origem === 'extraido_ia' ? 'EXTRAÍDO PELA IA' : 'INFORMADO MANUALMENTE';
    const corOrigem = alvo.origem === 'extraido_ia' ? '#1e3a8a' : '#374151';
    const bgOrigem = alvo.origem === 'extraido_ia' ? '#dbeafe' : '#f3f4f6';

    doc.rect(MARGEM, y, LARGURA, 22).fill('#f9fafb').stroke('#e5e7eb');
    doc.fillColor('#111827').fontSize(9.5).font('Helvetica-Bold')
      .text(`Alvo ${idx + 1}${alvo.principal ? ' (principal)' : ''}: ${alvo.nome || cad.nome || cad.razao_social || '-'}`, MARGEM + 8, y + 4, { width: LARGURA - 200 });
    doc.fillColor(COR.cinza).fontSize(7.5).font('Helvetica')
      .text(`CPF/CNPJ: ${formatarDoc(alvo.documento) || alvo.documento}`, MARGEM + 8, y + 13, { width: 220 });
    doc.rect(LARGURA - 110 + MARGEM, y + 4, 110, 14).fill(bgOrigem);
    doc.fillColor(corOrigem).fontSize(7).font('Helvetica-Bold')
      .text(origemLbl, LARGURA - 105 + MARGEM, y + 8, { width: 105, align: 'center' });
    y += 26;

    const bullets = [];
    if (cad.situacao) bullets.push(`Situação RF: ${cad.situacao}`);
    if (cad.situacao_rf) bullets.push(`Situação RF: ${cad.situacao_rf}`);
    if (sc.score) bullets.push(`Score Crédito: ${sc.score}/1000`);
    if (typeof proc.total === 'number') bullets.push(`Processos: ${proc.total}`);
    if (neg.status) bullets.push(`Negativações: ${neg.status}`);
    if (typeof vinc.total === 'number' && vinc.total > 0) bullets.push(`Vínculos societários: ${vinc.total}`);
    if (!bullets.length) bullets.push('Sem dados retornados pelas APIs externas para este alvo.');

    bullets.forEach(b => {
      y = verificarPagina(doc, y, 11);
      doc.fillColor('#374151').fontSize(7.5).font('Helvetica').text(`• ${b}`, MARGEM + 12, y, { width: LARGURA - 24 });
      y += 10;
    });
    y += 6;
  });
  return y + 4;
}

// Monta um objeto "lado" a partir do alvo do pedido (modo legado, alvo único)
function _montarLadoFromAlvo(dados, pedido) {
  const cad = dados.receita_federal || {};
  const sc = dados.score_credito || {};
  const neg = dados.negativacoes || {};
  const proc = dados.processos || {};
  return {
    nome: pedido.alvo_nome || cad.nome || '-',
    documento: pedido.alvo_documento,
    data_nascimento: cad.data_nascimento,
    situacao_rf: cad.situacao_rf,
    renda_estimada: cad.renda_estimada,
    score_credito: sc.score,
    processos_total: proc.total,
    processos_ativos: (proc.processos || []).filter(p => p.status === 'Ativo').length,
    protestos_valor: neg.total_pendencias,
    penhoras_ativas: 0,
    outros_imoveis: null
  };
}

function render(doc, pedido, dados, score, checklist, produto) {
  let y = chrome.cabecalho(doc, pedido, produto);
  y = chrome.resumoExecutivo(doc, y, score);

  // Identificação da transação
  y = chrome.blocoAlvo(doc, y, pedido);
  y = chrome.blocoAlertasDetalhados(doc, y, score);

  // Análise IA — Resumo Executivo + Alertas (só se análise concluída)
  // Os documentos do imóvel (matrícula/escritura) são lidos pelo Claude
  // e os dados extraídos viram esses dois blocos abaixo.
  const analiseIA = (pedido.analise_ia_status === 'concluida') ? pedido.analise_ia : null;
  const analise = (typeof analiseIA === 'string') ? safeParseJSON(analiseIA) : analiseIA;
  if (analise) {
    y = blocoDocumentosAnalisados(doc, y, analise);
    y = blocoResumoExecutivoIA(doc, y, analise);
  }

  // V3: Lista de todos os alvos consultados (até 5), com resumo por alvo.
  // Substitui a antiga divisão fixa comprador/vendedor quando há múltiplos alvos
  // extraídos da IA.
  y = secaoAlvosConsultados(doc, y, dados, pedido);

  // COMPRADOR / VENDEDOR / IMÓVEL — mantidos por compatibilidade com o
  // formato antigo (alvo único + alvo2). Quando há alvos_consultados, esses
  // blocos costumam ficar vazios (em integração).
  y = secaoComprador(doc, y, dados, pedido);
  y = secaoVendedor(doc, y, dados, pedido);
  y = secaoImovel(doc, y, dados, pedido);

  // Identificação + Proprietários + Ônus + Transmissões extraídos pela IA
  if (analise) {
    y = blocoIdentificacaoIA(doc, y, analise);
    y = blocoProprietariosIA(doc, y, analise);
    y = blocoOnusIA(doc, y, analise);
    y = blocoTransmissoesIA(doc, y, analise);
  }

  // Quando o alvo é uma pessoa, traz o bloco completo de processos/protestos do alvo
  y = secaoProcessos(doc, y, dados, pedido);
  y = secaoProtestos(doc, y, dados);
  y = secaoScoreCredito(doc, y, dados);

  // Parecer + checklist + observações
  y = secaoParecerImobiliario(doc, y, dados, score);
  y = secaoChecklist(doc, y, checklist);
  y = secaoParecerAnalista(doc, y, pedido);

  chrome.blocoFinal(doc, y, ['ONR - Operador Nacional do Registro (em integração)']);
}

module.exports = { render };
