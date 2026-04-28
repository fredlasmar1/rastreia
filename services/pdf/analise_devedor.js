/**
 * services/pdf/analise_devedor.js
 * Análise de Devedor (R$ 250).
 *
 * Foco: cobrar ou não? Seções exigidas:
 *  1. Identificação (dados de localização para citação/cobrança)
 *  2. SITUAÇÃO PATRIMONIAL
 *  3. HISTÓRICO COMO DEVEDOR
 *  4. CAPACIDADE DE PAGAMENTO
 *  5. ESTRATÉGIA DE COBRANÇA RECOMENDADA
 *  6. SCORE DE RECUPERABILIDADE
 */

const chrome = require('./chrome');
const {
  COR, MARGEM, LARGURA, verificarPagina,
  secao, linha, boxEmIntegracao, formatarBRL, parseValorCausa
} = require('./helpers');
const {
  secaoCadastralPF, secaoCadastralPJ,
  secaoProcessos, secaoProtestos, secaoScoreCredito,
  secaoVinculosSocietarios, secaoChecklist, secaoParecerAnalista
} = require('./sections');

// ─── Situação patrimonial (mini) ───────────────────────────────────
function secaoSituacaoPatrimonial(doc, y, dados) {
  const imoveis = dados.imoveis?.itens || [];
  const veiculos = dados.historico_veiculos_proprietario?.veiculos || [];
  const empresas = dados.vinculos?.empresas || [];

  y = secao(doc, 'SITUAÇÃO PATRIMONIAL', y);

  if (!imoveis.length && !veiculos.length && !empresas.length) {
    return boxEmIntegracao(doc, y,
      'LEVANTAMENTO PATRIMONIAL RESUMIDO — Em integração',
      'Para levantamento patrimonial completo (imóveis + todos os veículos + contas), utilizar o produto Investigação Patrimonial (R$ 497).'
    );
  }

  const resumo = [];
  if (imoveis.length) resumo.push(`${imoveis.length} imóvel(is)`);
  if (veiculos.length) resumo.push(`${veiculos.length} veículo(s)`);
  if (empresas.length) resumo.push(`${empresas.length} empresa(s) vinculada(s)`);
  doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text(`Identificado: ${resumo.join(' | ')}`, MARGEM, y); y += 14;

  if (imoveis.length) {
    doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('Imóveis', MARGEM, y); y += 10;
    imoveis.slice(0, 5).forEach(im => {
      y = verificarPagina(doc, y, 10);
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${im.descricao || im.endereco || 'Imóvel'} | ${im.valor_estimado ? formatarBRL(im.valor_estimado) : 'valor N/D'}`, MARGEM + 6, y, { width: LARGURA - 12 });
      y += 10;
    });
    y += 4;
  }

  if (veiculos.length) {
    doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('Veículos', MARGEM, y); y += 10;
    veiculos.slice(0, 5).forEach(v => {
      y = verificarPagina(doc, y, 10);
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${v.placa || '-'} ${v.veiculo || ''}`, MARGEM + 6, y, { width: LARGURA - 12 });
      y += 10;
    });
    y += 4;
  }

  return y + 2;
}

// ─── Histórico como devedor ────────────────────────────────────────
function secaoHistoricoDevedor(doc, y, dados) {
  const processos = dados.processos || {};
  const negativacoes = dados.negativacoes || {};
  const lista = processos.processos || [];
  const execucoes = lista.filter(p => /execu.{0,3}o/i.test(p.classe || ''));
  const ativos = lista.filter(p => p.status === 'Ativo');

  y = secao(doc, 'HISTÓRICO COMO DEVEDOR', y);

  y = linha(doc, 'Execuções ativas', `${execucoes.filter(e => e.status === 'Ativo').length} processo(s)`, y, 13);
  y = linha(doc, 'Processos ativos (total)', `${ativos.length} processo(s)`, y, 13);
  const valorProtestos = Number(negativacoes.total_pendencias || 0);
  y = linha(doc, 'Protestos/negativações', valorProtestos > 0 ? `${formatarBRL(valorProtestos)} em pendências` : 'Sem pendências', y, 13);
  y = linha(doc, 'Cheques sem fundo', (negativacoes.cheques_sem_fundo?.length || 0) > 0 ? `${negativacoes.cheques_sem_fundo.length} registro(s)` : 'Nenhum', y, 13);
  return y + 6;
}

// ─── Capacidade de pagamento ───────────────────────────────────────
function secaoCapacidadePagamento(doc, y, dados, pedido) {
  const cadastral = dados.receita_federal || {};
  const scoreCredito = dados.score_credito || {};
  const perfilEco = dados.perfil_economico || {};

  y = secao(doc, 'CAPACIDADE DE PAGAMENTO', y);

  if (pedido.alvo_tipo === 'PF') {
    y = linha(doc, 'Renda Estimada', cadastral.renda_estimada || perfilEco.renda_presumida ? (cadastral.renda_estimada || `R$ ${Number(perfilEco.renda_presumida).toLocaleString('pt-BR')}`) : 'Em integração (Credify)', y, 13);
    y = linha(doc, 'Classe Social', cadastral.classe_social || perfilEco.nivel_socioeconomico || '-', y, 13);
    y = linha(doc, 'Profissão (CBO)', cadastral.profissao || '-', y, 13);
    y = linha(doc, 'Situação RF', cadastral.situacao_rf || '-', y, 13);
  } else {
    y = linha(doc, 'Faturamento Presumido', dados.faturamento_presumido?.valor_formatado || 'Em integração (Credify)', y, 13);
    y = linha(doc, 'Porte', cadastral.porte || '-', y, 13);
    y = linha(doc, 'Regime Tributário', cadastral.simples_nacional || cadastral.regime_tributario || '-', y, 13);
    y = linha(doc, 'Situação RF', cadastral.situacao || '-', y, 13);
  }
  if (scoreCredito.score) {
    y = linha(doc, 'Score QUOD', `${scoreCredito.score}/1000 (${scoreCredito.faixa || '-'})`, y, 13);
  }
  return y + 6;
}

// ─── Estratégia de cobrança ────────────────────────────────────────
function secaoEstrategiaCobranca(doc, y, dados, score) {
  const processos = dados.processos || {};
  const negativacoes = dados.negativacoes || {};
  const scoreCredito = dados.score_credito || {};
  const patrimonio = (dados.imoveis?.itens?.length || 0) + (dados.historico_veiculos_proprietario?.veiculos?.length || 0);
  const execucoes = (processos.processos || []).filter(p => /execu.{0,3}o/i.test(p.classe || '') && p.status === 'Ativo').length;
  const sQuod = Number(scoreCredito.score || 0);
  const pend = Number(negativacoes.total_pendencias || 0);

  y = secao(doc, 'ESTRATÉGIA DE COBRANÇA RECOMENDADA', y);

  let abordagem, corA, prazo, probabilidade, corP, bensSugeridos;
  if (patrimonio > 0 && execucoes === 0) {
    abordagem = 'AMIGÁVEL INICIAL + JUDICIAL SE NÃO RESPONDER';
    corA = COR.verde;
    prazo = '30-90 dias';
    probabilidade = 'ALTA';
    corP = COR.verde;
    bensSugeridos = dados.imoveis?.itens?.length ? 'Imóveis identificados (penhora preferencial)' : 'Veículos identificados (RENAJUD)';
  } else if (execucoes > 0 || pend > 0 || sQuod < 400) {
    abordagem = 'JUDICIAL DIRETA (pular tentativa amigável)';
    corA = COR.laranja;
    prazo = '6-18 meses';
    probabilidade = 'MÉDIA';
    corP = COR.laranja;
    bensSugeridos = 'BacenJud + RENAJUD como primeira medida. Investigação patrimonial complementar recomendada.';
  } else if (sQuod >= 700 && pend === 0) {
    abordagem = 'AMIGÁVEL (devedor tem capacidade e perfil)';
    corA = COR.verde;
    prazo = '15-45 dias';
    probabilidade = 'ALTA';
    corP = COR.verde;
    bensSugeridos = 'Proposta de parcelamento direto. Sem necessidade de medida judicial inicialmente.';
  } else {
    abordagem = 'MISTA — tentativa amigável curta + judicial';
    corA = COR.laranja;
    prazo = '3-12 meses';
    probabilidade = 'MÉDIA';
    corP = COR.laranja;
    bensSugeridos = 'Verificar patrimônio via Investigação Patrimonial antes de ajuizar';
  }

  if (patrimonio === 0 && execucoes > 3 && sQuod < 300) {
    abordagem = 'BAIXA CONTÁBIL ou desconto agressivo';
    corA = COR.vermelho;
    prazo = 'Indeterminado';
    probabilidade = 'IRRECUPERÁVEL';
    corP = COR.vermelho;
    bensSugeridos = 'Devedor sem patrimônio aparente e com múltiplas execuções. Avaliar desconto >50% ou baixa.';
  }

  y = verificarPagina(doc, y, 24);
  doc.rect(MARGEM, y, LARGURA, 22).fill('#f9fafb').stroke(COR.borda);
  doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica-Bold').text('ABORDAGEM', MARGEM + 8, y + 4);
  doc.fillColor(corA).fontSize(9).font('Helvetica-Bold').text(abordagem, MARGEM + 8, y + 12, { width: LARGURA - 16 });
  y += 26;

  y = linha(doc, 'Probabilidade', probabilidade, y, 14);
  y = linha(doc, 'Prazo estimado', prazo, y, 14);
  y = verificarPagina(doc, y, 20);
  doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('BENS SUGERIDOS PARA PENHORA / ESTRATÉGIA', MARGEM, y); y += 12;
  doc.fillColor('#111827').fontSize(8).font('Helvetica').text(bensSugeridos, MARGEM + 6, y, { width: LARGURA - 12 });
  y += doc.heightOfString(bensSugeridos, { width: LARGURA - 12, fontSize: 8 }) + 8;
  return y;
}

// ─── Score de Recuperabilidade ─────────────────────────────────────
function secaoScoreRecuperabilidade(doc, y, dados, score) {
  const patrimonio = (dados.imoveis?.itens?.length || 0) + (dados.historico_veiculos_proprietario?.veiculos?.length || 0);
  const sQuod = Number((dados.score_credito || {}).score || 0);
  const pend = Number((dados.negativacoes || {}).total_pendencias || 0);
  const execucoes = ((dados.processos || {}).processos || []).filter(p => /execu.{0,3}o/i.test(p.classe || '') && p.status === 'Ativo').length;

  // Score de recuperabilidade 0-100
  let s = 50;
  if (patrimonio >= 3) s += 25;
  else if (patrimonio >= 1) s += 15;
  else s -= 15;

  if (sQuod >= 700) s += 15;
  else if (sQuod >= 500) s += 5;
  else if (sQuod > 0 && sQuod < 400) s -= 15;

  if (pend > 0) s -= 10;
  if (execucoes > 3) s -= 20;
  else if (execucoes > 0) s -= 10;
  s = Math.max(0, Math.min(100, s));

  let classif, rec, cor;
  if (s >= 70) { classif = 'RECUPERÁVEL'; rec = 'COBRAR'; cor = COR.verde; }
  else if (s >= 40) { classif = 'PARCIALMENTE RECUPERÁVEL'; rec = 'NEGOCIAR DESCONTO (20-40%)'; cor = COR.laranja; }
  else { classif = 'IRRECUPERÁVEL (no cenário atual)'; rec = 'BAIXAR ou desconto agressivo (>50%)'; cor = COR.vermelho; }

  y = secao(doc, 'SCORE DE RECUPERABILIDADE', y);
  y = verificarPagina(doc, y, 60);
  doc.rect(MARGEM, y, LARGURA, 56).fill('#f8fafc').stroke(COR.borda);
  doc.fillColor(cor).fontSize(32).font('Helvetica-Bold').text(`${s}`, MARGEM + 12, y + 6, { width: 70, lineBreak: false });
  doc.fillColor(COR.cinza).fontSize(9).font('Helvetica').text('/100', MARGEM + 68, y + 28, { lineBreak: false });
  doc.fillColor(cor).fontSize(11).font('Helvetica-Bold').text(classif, MARGEM + 100, y + 6, { width: LARGURA - 110 });
  doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(`Recomendação: ${rec}`, MARGEM + 100, y + 26, { width: LARGURA - 110 });
  doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text('Fatores: patrimônio + score crédito + protestos + execuções ativas', MARGEM + 100, y + 42, { width: LARGURA - 110 });
  return y + 60;
}

function render(doc, pedido, dados, score, checklist, produto) {
  let y = chrome.cabecalho(doc, pedido, produto);
  y = chrome.resumoExecutivo(doc, y, score);
  y = chrome.blocoAlvo(doc, y, pedido);
  y = chrome.blocoAlertasDetalhados(doc, y, score);

  // Identificação (dados para contato de cobrança)
  if (pedido.alvo_tipo === 'PF') y = secaoCadastralPF(doc, y, dados);
  else y = secaoCadastralPJ(doc, y, dados);

  // Diagnóstico
  y = secaoSituacaoPatrimonial(doc, y, dados);
  y = secaoHistoricoDevedor(doc, y, dados);
  y = secaoProcessos(doc, y, dados, pedido);
  y = secaoProtestos(doc, y, dados);
  y = secaoCapacidadePagamento(doc, y, dados, pedido);
  y = secaoScoreCredito(doc, y, dados);
  y = secaoVinculosSocietarios(doc, y, dados);

  // Decisão
  y = secaoEstrategiaCobranca(doc, y, dados, score);
  y = secaoScoreRecuperabilidade(doc, y, dados, score);
  y = secaoChecklist(doc, y, checklist);
  y = secaoParecerAnalista(doc, y, pedido);

  chrome.blocoFinal(doc, y);
}

module.exports = { render };
