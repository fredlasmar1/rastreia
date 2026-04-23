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

  // COMPRADOR / VENDEDOR / IMÓVEL
  y = secaoComprador(doc, y, dados, pedido);
  y = secaoVendedor(doc, y, dados, pedido);
  y = secaoImovel(doc, y, dados, pedido);

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
