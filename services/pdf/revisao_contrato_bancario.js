/**
 * PDF — Laudo de Revisão de Contrato Bancário
 *   1. Capa (contratante, banco, contrato, data, revisor)
 *   2. Veredito + economia estimada do cenário principal
 *   3. Resumo para o cliente (parecer IA revisado pelo advogado)
 *   4. Dados do contrato (marca "conferido manualmente")
 *   5. Taxa contratada × taxa média BACEN (+ posição do banco na Olinda)
 *   6. Cobrado × devido por cenário
 *   7. Pontos encontrados (teses aplicáveis, trecho e fundamento)
 *   8. Parecer jurídico (nome e OAB do revisor)
 *   9. Próximos passos + "Fale com o Balladão Advogados"
 *  10. Ressalvas fixas
 *  11. Anexo técnico (parcela a parcela, fórmulas, versões) — depois do aviso LGPD
 *
 * Regra de ouro: TODO número sai de `revisao.calculo` / `revisao.taxa_media_bacen`
 * (código determinístico). Texto da IA entra só como explicação, já revisado.
 * Os dados chegam em pedido.__revisao (montado por services/revisao_bancaria_laudo.js).
 */
const chrome = require('./chrome');
const { COR, MARGEM, LARGURA, secao, linha, verificarPagina } = require('./helpers');

const VER = {
  forte: { fundo: '#dcfce7', texto: '#14532d', titulo: 'FORTE', frase: 'Há base sólida para revisar o contrato.' },
  moderada: { fundo: '#fef9c3', texto: '#713f12', titulo: 'MODERADA', frase: 'Há pontos questionáveis; vale a análise do advogado.' },
  fraca: { fundo: '#ffedd5', texto: '#7c2d12', titulo: 'FRACA', frase: 'O contrato está próximo do praticado no mercado.' },
  inviavel: { fundo: '#e5e7eb', texto: '#1f2937', titulo: 'INVIÁVEL', frase: 'Não há como sustentar a revisão com os dados disponíveis.' }
};
const RES = { aplicavel: 'APLICÁVEL', verificar: 'VERIFICAR', nao_aplicavel: 'NÃO APLICÁVEL' };

const brl = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : (Number(v) * 100).toFixed(d).replace('.', ',') + '%');
const pctNum = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d).replace('.', ',') + '%');
const dataBR = (s) => {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;          // data pura: sem fuso
  const d = new Date(s);
  return isNaN(d) ? String(s) : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};
const mesBR = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})/); return m ? `${m[2]}/${m[1]}` : '—'; };
const semanaBR = (s) => String(s || '').replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1');
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

const TIPOS = { financiamento_veiculo: 'Financiamento de veículo', emprestimo_pessoal: 'Empréstimo pessoal', consignado: 'Consignado', renegociacao: 'Renegociação / composição de dívidas', ccb_capital_giro: 'CCB / capital de giro', conta_garantida: 'Conta garantida', desconto_recebiveis: 'Desconto de duplicatas / cheques', antecipacao_cartao: 'Antecipação de recebíveis de cartão', cartao_credito: 'Cartão de crédito', cheque_especial: 'Cheque especial', financiamento_bens: 'Financiamento de outros bens', arrendamento_mercantil: 'Arrendamento mercantil (leasing)', vendor: 'Vendor', compror: 'Compror', cambio: 'Adiantamento de câmbio (ACC)', comercio_exterior: 'Financiamento de importação/exportação', financiamento_imobiliario: 'Financiamento imobiliário', outro: 'Outro' };
const SITUACOES = { em_dia: 'Em dia', atrasado: 'Em atraso', busca_apreensao: 'Busca e apreensão', executado: 'Em execução', quitado: 'Quitado' };

function paragrafo(doc, y, txt, { tam = 9, cor = '#1f2937', fonte = 'Helvetica', recuo = 0 } = {}) {
  if (!txt) return y;
  doc.font(fonte).fontSize(tam);
  const w = LARGURA - recuo;
  // quebra por parágrafo para virar página no meio de texto longo
  String(txt).split(/\n+/).forEach(p => {
    const h = doc.heightOfString(p, { width: w });
    y = verificarPagina(doc, y, Math.min(h, 120) + 4);
    doc.font(fonte).fontSize(tam).fillColor(cor).text(p, MARGEM + recuo, y, { width: w });
    y = doc.y + 4;
  });
  return y;
}

function item(doc, y, txt, cor = '#1f2937', tam = 9) {
  doc.font('Helvetica').fontSize(tam);
  const h = doc.heightOfString('•  ' + txt, { width: LARGURA - 10 });
  y = verificarPagina(doc, y, h + 4);
  doc.fillColor(cor).text('•  ' + txt, MARGEM + 4, y, { width: LARGURA - 10 });
  return y + h + 3;
}

// Tabela simples com cabeçalho repetido a cada página.
// cols: [{ t: 'Título', w: 80, a: 'right' }]; linhas: array de arrays de texto
function tabela(doc, y, cols, linhas, { tam = 7.5, alturaLinha = 11, destaque = () => false } = {}) {
  const desenharCab = (yy) => {
    doc.rect(MARGEM, yy, LARGURA, alturaLinha + 2).fill('#1e3a8a');
    let x = MARGEM;
    doc.font('Helvetica-Bold').fontSize(tam).fillColor('#ffffff');
    cols.forEach(c => { doc.text(c.t, x + 3, yy + 2.5, { width: c.w - 6, align: c.a || 'left', lineBreak: false }); x += c.w; });
    return yy + alturaLinha + 2;
  };
  y = verificarPagina(doc, y, (alturaLinha + 2) * 2);
  y = desenharCab(y);
  linhas.forEach((ln, i) => {
    doc.font('Helvetica').fontSize(tam);
    const h = Math.max(alturaLinha, ...ln.map((v, j) => doc.heightOfString(String(v ?? ''), { width: cols[j].w - 6 }) + 3));
    if (y + h > doc.page.height - 80) { doc.addPage(); y = desenharCab(MARGEM); }
    if (destaque(ln, i)) doc.rect(MARGEM, y, LARGURA, h).fill('#eef2ff');
    else if (i % 2) doc.rect(MARGEM, y, LARGURA, h).fill('#f9fafb');
    let x = MARGEM;
    doc.font(destaque(ln, i) ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam).fillColor('#1f2937');
    ln.forEach((v, j) => { doc.text(String(v ?? ''), x + 3, y + 1.5, { width: cols[j].w - 6, align: cols[j].a || 'left' }); x += cols[j].w; });
    y += h;
  });
  return y + 6;
}

function render(doc, pedido, dados, score, checklist, produto) {
  const rv = pedido.__revisao || {};
  const reg = rv.registro || {};
  const d = reg.dados_conferidos || {};
  const calc = reg.calculo || {};
  const tx = reg.taxa_media_bacen || {};
  const teses = (reg.teses && reg.teses.teses) || [];
  const revisor = rv.revisor || {};
  const editados = new Set(d.campos_editados || []);
  let pia = {};
  try { pia = typeof reg.parecer_ia === 'string' ? JSON.parse(reg.parecer_ia) : (reg.parecer_ia || {}); } catch (_) { pia = {}; }
  doc.__proximoDegrau = null;   // o laudo encaminha ao advogado, não a outro dossiê

  // ── 1. Capa ──
  let y = chrome.cabecalho(doc, pedido, { nome: 'Laudo de Revisão de Contrato Bancário' });
  y = verificarPagina(doc, y, 90);
  doc.fillColor(COR.azul).font('Helvetica-Bold').fontSize(16).text('Laudo de Revisão de Contrato Bancário', MARGEM, y + 2, { width: LARGURA });
  y = doc.y + 6;
  y = linha(doc, 'Contratante', `${get(d, 'contratante.nome') || pedido.alvo_nome || '—'}${get(d, 'contratante.cpf_cnpj') ? ' — ' + get(d, 'contratante.cpf_cnpj') : ''}`, y, 12);
  y = linha(doc, 'Banco credor', `${get(d, 'instituicao.nome') || '—'}${get(d, 'instituicao.cnpj') ? ' — CNPJ ' + get(d, 'instituicao.cnpj') : ''}`, y, 12);
  y = linha(doc, 'Contrato nº', get(d, 'operacao.numero_contrato') || 'não identificado', y, 12);
  y = linha(doc, 'Data do laudo', dataBR(reg.revisado_em || new Date().toISOString()), y, 12);
  y = linha(doc, 'Revisor', `${revisor.nome || '—'}${revisor.oab ? ' — OAB ' + revisor.oab : ''} (Balladão Advogados)`, y, 12);
  y += 6;

  // ── 2. Veredito ──
  const nivel = (calc.veredito && calc.veredito.nivel) || reg.veredito || 'inviavel';
  const v = VER[nivel] || VER.inviavel;
  const cp = calc.cenario_principal && calc.cenarios ? calc.cenarios[calc.cenario_principal] : null;
  const alturaV = 64;
  y = verificarPagina(doc, y, alturaV + 8);
  doc.rect(MARGEM, y, LARGURA, alturaV).fill(v.fundo);
  doc.fillColor(v.texto).font('Helvetica-Bold').fontSize(9).text('VIABILIDADE DA REVISÃO', MARGEM + 12, y + 8);
  doc.fontSize(20).text(v.titulo, MARGEM + 12, y + 19, { width: 200 });
  doc.font('Helvetica').fontSize(8.5).text(v.frase, MARGEM + 12, y + 44, { width: 240 });
  doc.font('Helvetica-Bold').fontSize(9).text('ECONOMIA ESTIMADA', MARGEM + 270, y + 8, { width: LARGURA - 282, align: 'right' });
  doc.fontSize(18).text(brl(calc.economia_estimada), MARGEM + 270, y + 19, { width: LARGURA - 282, align: 'right' });
  doc.font('Helvetica').fontSize(8).text(cp ? `Cenário ${calc.cenario_principal}: ${cp.nome}` : 'Sem cenário de revisão calculável', MARGEM + 270, y + 44, { width: LARGURA - 282, align: 'right' });
  y += alturaV + 6;
  if (calc.veredito) {
    const vv = calc.veredito;
    const motivo = vv.razao != null || vv.economia_pct != null
      ? `Taxa contratada ÷ média BACEN: ${vv.razao != null ? vv.razao.toFixed(2).replace('.', ',') + ' vez(es)' : 'sem média BACEN'}; economia estimada: ${vv.economia_pct != null ? vv.economia_pct.toFixed(1).replace('.', ',') + '% do valor financiado' : '—'}.`
      : vv.motivo;
    if (motivo) y = paragrafo(doc, y, motivo, { tam: 8, cor: COR.cinza });
  }

  // ── 3. Resumo para o cliente ──
  if (pia.resumo_cliente) {
    y = secao(doc, 'RESUMO PARA O CLIENTE', y + 4);
    y = paragrafo(doc, y, pia.resumo_cliente);
  }

  // ── 4. Dados do contrato ──
  y = secao(doc, 'DADOS DO CONTRATO', y + 4);
  const L = (rot, caminho, fmt = (x) => x) => {
    const val = get(d, caminho);
    if (val == null || val === '') return;
    y = linha(doc, rot + (editados.has(caminho) ? ' *' : ''), String(fmt(val)), y, 12);
  };
  y = linha(doc, 'Tipo de operação', `${TIPOS[d.tipo_operacao] || d.tipo_operacao || '—'} (${d.pfpj || 'PF'})`, y, 12);
  L('Situação', 'situacao', (s) => SITUACOES[s] || s);
  L('Data da contratação', 'operacao.data_contratacao', dataBR);
  L('1º vencimento', 'operacao.data_primeiro_vencimento', dataBR);
  L('Valor liberado', 'operacao.valor_liberado', brl);
  L('Valor financiado total', 'operacao.valor_financiado_total', brl);
  L('Prazo', 'operacao.prazo_meses', (n) => `${n} meses`);
  L('Parcela', 'operacao.valor_parcela', brl);
  L('Parcelas pagas', 'parcelas_pagas');
  L('Sistema de amortização', 'operacao.sistema_amortizacao', (s) => ({ price: 'Price', sac: 'SAC', nao_informado: 'Não informado (cálculo em Price)' }[s] || s));
  L('Taxa mensal declarada', 'operacao.taxa_juros_mensal_declarada', (x) => pctNum(x, 4));
  L('Taxa anual declarada', 'operacao.taxa_juros_anual_declarada', (x) => pctNum(x));
  L('CET mensal', 'operacao.cet_mensal', (x) => pctNum(x, 4));
  L('CET anual', 'operacao.cet_anual', (x) => pctNum(x));
  L('IOF', 'iof.valor', brl);
  L('Garantia', 'garantia.tipo', (s) => ({ alienacao_fiduciaria: 'Alienação fiduciária', consignacao: 'Consignação em folha', aval: 'Aval', nenhuma: 'Nenhuma', outro: 'Outra' }[s] || s));
  L('Bem', 'garantia.bem_descricao');
  const itensCobrados = [...(d.tarifas || []).map(t => ({ ...t, tipoItem: 'Tarifa', fin: t.financiada })), ...(d.seguros || []).map(s => ({ ...s, tipoItem: 'Seguro', fin: s.financiado }))];
  if (itensCobrados.length) {
    y += 2;
    y = tabela(doc, y, [{ t: 'Tarifas e seguros cobrados', w: 300 }, { t: 'Forma', w: 95 }, { t: 'Valor', w: 100, a: 'right' }],
      itensCobrados.map(t => [`${t.tipoItem}: ${t.nome || t.tipo || '—'}`, t.fin ? 'financiado' : 'pago à vista', brl(t.valor)]));
  }
  if (editados.size) {
    doc.fillColor(COR.cinza).font('Helvetica').fontSize(7.5).text('* Conferido manualmente pelo operador a partir do documento.', MARGEM, y, { width: LARGURA });
    y = doc.y + 4;
  }

  // ── 5. Taxa contratada × BACEN ──
  y = secao(doc, 'TAXA CONTRATADA × TAXA MÉDIA DO BANCO CENTRAL', y + 4);
  const t = calc.taxa || {};
  y = linha(doc, 'Taxa efetiva contratada', `${pct(t.efetiva_am, 4)} a.m.  |  ${pct(t.efetiva_aa)} a.a.`, y, 12);
  if (t.implicita_am != null) y = linha(doc, 'Taxa real (calculada da parcela)', `${pct(t.implicita_am, 4)} a.m.`, y, 12);
  if (t.declarada_am != null) y = linha(doc, 'Taxa declarada no contrato', `${pct(t.declarada_am, 4)} a.m.`, y, 12);
  if (t.taxa_efetiva_maior_que_declarada) y = linha(doc, 'Diferença real × declarada', `${String((t.diferenca_pp_am ?? 0).toFixed(4)).replace('.', ',')} p.p. a.m. acima`, y, 12);
  if (calc.cet && calc.cet.real_am != null) {
    y = linha(doc, 'CET real (custo total)', `${pct(calc.cet.real_am, 4)} a.m.  |  ${pct(calc.cet.real_aa)} a.a. — sobre ${brl(calc.cet.recebido_liquido)} efetivamente recebidos`, y, 12);
    if (calc.cet.declarado_am != null) y = linha(doc, 'CET informado no contrato', `${pct(calc.cet.declarado_am, 4)} a.m.${calc.cet.real_maior_que_declarado ? `  —  real ${calc.cet.diferenca_pp_am.toFixed(4).replace('.', ',')} p.p. acima` : '  —  confere'}`, y, 12);
  }
  if (calc.bacen) {
    y = linha(doc, 'Taxa média BACEN', `${pct(calc.bacen.am, 4)} a.m.  |  ${pct(calc.bacen.aa)} a.a.`, y, 12);
    y = linha(doc, 'Razão contratada ÷ média', calc.razao != null ? calc.razao.toFixed(2).replace('.', ',') + ' vez(es)' : '—', y, 12);
  }
  if (tx.origem === 'manual') {
    y = linha(doc, 'Origem da taxa média', `MANUAL — informada pelo operador${tx.informado_por ? ' (' + tx.informado_por + ')' : ''}; mês ${mesBR(tx.mes_referencia)}; fonte: ${tx.fonte_manual || 'não informada'}`, y, 12);
  } else if (tx.origem) {
    y = linha(doc, 'Série BACEN (SGS)', `${tx.serie_am}${tx.nome_serie ? ' — ' + tx.nome_serie : ''}`, y, 12);
    y = linha(doc, 'Mês de referência', `${mesBR(tx.mes_referencia)}${tx.recuou_meses ? ` (contratação em ${mesBR(tx.mes_contratacao)}; sem dado no mês, usado o anterior disponível)` : ''}`, y, 12);
    y = linha(doc, 'Data da consulta', dataBR(tx.data_consulta), y, 12);
  }
  const ol = tx.olinda;
  if (ol && ol.banco) {
    y = paragrafo(doc, y + 2, `Na semana de ${semanaBR(ol.semana)}, o ${ol.banco.nome} cobrava ${pctNum(ol.banco.taxa_am)} a.m. nesta modalidade e era o ${ol.banco.posicao}º de ${ol.total_instituicoes} instituições (ordem da menor para a maior taxa). Menor taxa: ${pctNum(ol.menor_am)} a.m.; maior: ${pctNum(ol.maior_am)} a.m. (BACEN, Olinda — taxas por instituição).`, { tam: 8.5 });
  } else if (ol) {
    y = paragrafo(doc, y + 2, `Na semana de ${semanaBR(ol.semana)}, ${ol.total_instituicoes} instituições informaram taxas entre ${pctNum(ol.menor_am)} e ${pctNum(ol.maior_am)} a.m. nesta modalidade (BACEN, Olinda).`, { tam: 8.5 });
  }

  // ── 6. Cobrado × devido ──
  const cen = Object.entries(calc.cenarios || {});
  if (cen.length) {
    y = secao(doc, 'COBRADO × DEVIDO', y + 4);
    const wRot = 155, wCol = Math.floor((LARGURA - wRot) / cen.length);
    const cols = [{ t: '', w: wRot }, ...cen.map(([k, c]) => ({ t: `Cenário ${k}`, w: wCol, a: 'right' }))];
    const linhasCen = [
      ['Taxa aplicada (a.m.)', (c) => pct(c.taxa_am, 4)],
      ['Parcela contratada', (c) => brl(c.parcela_contratada)], ['Parcela revisada', (c) => brl(c.parcela_revisada)],
      ['Total pago a mais', (c) => brl(c.total_pago_a_mais)], ['Saldo devedor contratual', (c) => brl(c.saldo_devedor_contratual)],
      ['Saldo devedor revisado', (c) => brl(c.saldo_devedor_revisado)], ['Economia nas parcelas futuras', (c) => brl(c.economia_futura)],
      ['Economia total', (c) => brl(c.economia_total)], ['Restituição simples', (c) => brl(c.repeticao_simples)],
      ['Restituição em dobro (referência)', (c) => brl(c.repeticao_dobro)]
    ];
    y = tabela(doc, y, cols, linhasCen.map(([rot, f]) => [rot, ...cen.map(([, c]) => f(c))]), { destaque: (ln) => ln[0] === 'Economia total' });
    cen.forEach(([k, c]) => {
      let txt = `Cenário ${k}: ${c.nome}.`;
      if (c.itens_excluidos && c.itens_excluidos.length) txt += ` Itens retirados: ${c.itens_excluidos.map(i => `${i.nome} (${brl(i.valor)}${i.financiado ? ', financiado' : ', pago à vista'})`).join('; ')}${c.iof_excluido ? `; IOF proporcional ${brl(c.iof_excluido)}` : ''}.`;
      y = paragrafo(doc, y, txt, { tam: 7.5, cor: COR.cinza });
    });
    y = paragrafo(doc, y, 'A restituição em dobro (CDC, art. 42, parágrafo único) é referência: depende de decisão judicial sobre a cobrança indevida.', { tam: 7.5, cor: COR.cinza });
  }
  // Pago a mais corrigido pelo IPCA (estimativa, sem juros de mora)
  const ic = calc.indebito_corrigido;
  if (ic && ic.nominal > 0) {
    y = verificarPagina(doc, y + 4, 40);
    y = linha(doc, `Pago a mais corrigido (IPCA até ${mesBR(ic.ate_mes)})`, `${brl(ic.corrigido)}  —  nominal ${brl(ic.nominal)} + correção ${brl(ic.correcao)}; em dobro (referência) ${brl(ic.repeticao_dobro_corrigida)}`, y, 12);
    y = paragrafo(doc, y, 'Correção monetária pelo IPCA desde cada pagamento (Súmula 43 do STJ; CC, art. 389, parágrafo único, na redação da Lei 14.905/2024). Juros de mora não incluídos: na repetição do indébito correm da citação (CC, art. 405). Para pagamentos anteriores a 30/08/2024, conferir o índice adotado pelo tribunal (há tabelas com INPC).', { tam: 7.5, cor: COR.cinza });
  }
  // Valor incontroverso — o que se reconhece e segue pagando (CPC art. 330, §§ 2º e 3º)
  const vi = calc.valor_incontroverso;
  if (vi) {
    y = verificarPagina(doc, y + 4, 62);
    doc.rect(MARGEM, y, LARGURA, 56).fill('#eff6ff');
    doc.rect(MARGEM, y, 4, 56).fill(COR.azul);
    doc.fillColor(COR.azul).font('Helvetica-Bold').fontSize(8.5).text('VALOR INCONTROVERSO (CPC, art. 330, §§ 2º e 3º)', MARGEM + 12, y + 7, { width: LARGURA - 24 });
    doc.fillColor('#111827').fontSize(15).text(`${brl(vi.parcela_mensal)} por mês`, MARGEM + 12, y + 24, { width: 190 });
    doc.font('Helvetica').fontSize(8).fillColor('#374151').text(`Parcela que o contratante reconhece e continua pagando durante a ação (cenário ${vi.cenario}), no lugar de ${brl(vi.parcela_contratada)}. Saldo devedor revisado: ${brl(vi.saldo_devedor_revisado)}; ${vi.parcelas_restantes} parcela(s) restante(s).`, MARGEM + 210, y + 21, { width: LARGURA - 222 });
    y += 62;
  }
  (calc.alertas || []).forEach(a => { y = item(doc, y, String(a).replace(/(\d)\.(\d)/g, '$1,$2'), COR.laranja, 8.5); });

  // ── 7. Pontos encontrados ──
  const aplic = teses.filter(x => x.resultado === 'aplicavel');
  const verif = teses.filter(x => x.resultado === 'verificar');
  y = secao(doc, 'PONTOS ENCONTRADOS', y + 4);
  if (!aplic.length) y = paragrafo(doc, y, 'Nenhuma tese foi considerada aplicável com os dados do contrato.', { tam: 9 });
  aplic.forEach(x => {
    y = verificarPagina(doc, y, 40);
    doc.fillColor(COR.verde).font('Helvetica-Bold').fontSize(9.5).text(`${x.nome}`, MARGEM, y, { width: LARGURA }); y = doc.y + 2;
    y = paragrafo(doc, y, x.explicacao_cliente ? `${x.explicacao_cliente} ${x.detalhe}` : x.detalhe, { tam: 8.5, recuo: 8 });
    if (x.trecho_contrato) y = paragrafo(doc, y, `Trecho do contrato: “${x.trecho_contrato}”`, { tam: 8, cor: '#374151', fonte: 'Helvetica-Oblique', recuo: 8 });
    y = paragrafo(doc, y, `Fundamento: ${x.fundamento}`, { tam: 7.5, cor: COR.cinza, recuo: 8 });
    y += 2;
  });
  if (verif.length) {
    y = verificarPagina(doc, y, 24);
    doc.fillColor(COR.laranja).font('Helvetica-Bold').fontSize(9).text('A verificar com documentos adicionais', MARGEM, y); y = doc.y + 3;
    verif.forEach(x => { y = item(doc, y, `${x.nome}: ${x.detalhe}`, '#374151', 8.5); });
  }
  if (reg.teses && reg.teses.fundamento_geral) y = paragrafo(doc, y + 2, reg.teses.fundamento_geral, { tam: 7.5, cor: COR.cinza });

  // ── 8. Parecer jurídico ──
  y = secao(doc, 'PARECER JURÍDICO — BALLADÃO ADVOGADOS', y + 4);
  y = paragrafo(doc, y, reg.parecer_juridico || '—');
  y = verificarPagina(doc, y + 6, 34);
  doc.moveTo(MARGEM, y + 14).lineTo(MARGEM + 220, y + 14).strokeColor('#9ca3af').lineWidth(0.5).stroke();
  doc.fillColor('#1f2937').font('Helvetica-Bold').fontSize(9).text(revisor.nome || '—', MARGEM, y + 17);
  doc.font('Helvetica').fontSize(8).fillColor(COR.cinza).text(`${revisor.oab ? 'OAB ' + revisor.oab + ' — ' : ''}Balladão Advogados — revisado em ${dataBR(reg.revisado_em)}`, MARGEM, y + 28);
  y += 44;

  // ── 9. Próximos passos ──
  y = secao(doc, 'PRÓXIMOS PASSOS', y + 4);
  const passos = Array.isArray(pia.proximos_passos) && pia.proximos_passos.length ? pia.proximos_passos : (() => {
    const p = [];
    if (['forte', 'moderada'].includes(nivel)) p.push(`Ação revisional do contrato, com pedido de recálculo e restituição do que foi pago a mais${vi ? `, seguindo o pagamento do valor incontroverso (${brl(vi.parcela_mensal)} por mês)` : ''}.`);
    if (d.situacao === 'busca_apreensao') p.push('Defesa na ação de busca e apreensão, com os pontos deste laudo.');
    if (['forte', 'moderada'].includes(nivel)) p.push('Notificação extrajudicial ao banco ou proposta de acordo com base no saldo revisado.');
    if (!p.length) p.push('Guardar este laudo; se o contrato for renegociado ou houver cobrança judicial, reavaliar com o advogado.');
    return p;
  })();
  passos.forEach(p => { y = item(doc, y, p); });
  const wpp = rv.balladaoWhatsapp ? String(rv.balladaoWhatsapp) : '';
  y = verificarPagina(doc, y + 4, 40);
  doc.rect(MARGEM, y, LARGURA, 36).fill('#eef2ff');
  doc.rect(MARGEM, y, 4, 36).fill(COR.azul);
  doc.fillColor(COR.azul).font('Helvetica-Bold').fontSize(11).text('Fale com o Balladão Advogados', MARGEM + 12, y + 7, { width: LARGURA - 24 });
  doc.font('Helvetica').fontSize(9).fillColor('#1f2937').text(wpp ? `WhatsApp ${wpp} — leve este laudo (protocolo #${pedido.numero || ''}).` : `Responda a mensagem deste laudo ou procure a Recobro (protocolo #${pedido.numero || ''}).`, MARGEM + 12, y + 21, { width: LARGURA - 24 });
  y += 42;

  // ── 10. Ressalvas ──
  y = secao(doc, 'RESSALVAS', y + 4);
  const ressalvas = [
    'Laudo técnico-financeiro baseado exclusivamente nos documentos enviados pelo contratante.',
    'As estimativas não garantem resultado judicial: a decisão depende do juízo e das provas do processo.',
    'A taxa média do Banco Central é referência de mercado, não teto legal de juros.',
    'Não interrompa os pagamentos sem orientação jurídica: o atraso pode gerar mora, negativação e busca e apreensão.',
    ...(Array.isArray(pia.ressalvas) ? pia.ressalvas : [])
  ];
  ressalvas.forEach(r => { y = item(doc, y, r, '#374151', 8.5); });

  chrome.blocoFinal(doc, y + 6, null, {
    fontes: [
      'Contrato e documentos enviados pelo contratante (leitura assistida por IA e conferida por operador)',
      'Banco Central do Brasil — SGS, taxas médias de juros por modalidade',
      'Banco Central do Brasil — Olinda, taxas de juros por instituição financeira',
      'Cálculo determinístico Rastreia (Price/SAC) e checklist de teses revisado pelo Balladão Advogados'
    ]
  });

  // ── 11. Anexo técnico ──
  doc.addPage();
  y = 50;
  y = secao(doc, 'ANEXO TÉCNICO', y);
  const e = calc.entradas || {};
  y = paragrafo(doc, y, [
    `Entradas do cálculo: valor financiado ${brl(e.valor_financiado)}, parcela ${brl(e.parcela)}, ${e.prazo_meses || '—'} meses, sistema ${String(e.sistema || '').toUpperCase()}, ${e.parcelas_pagas || 0} parcela(s) paga(s).`,
    'Taxa real: na Tabela Price, é a taxa i que iguala o valor financiado ao valor presente das parcelas, PV = PMT × [1 - (1+i)^(-n)] ÷ i, resolvida por Newton-Raphson (equivale à função TAXA do Excel). No SAC, i = (1ª parcela - PV÷n) ÷ PV.',
    'Taxa anual equivalente: (1 + i)^12 - 1. Capitalização: taxa anual declarada maior que 12 vezes a mensal indica pactuação expressa (Súmula 541 STJ).',
    'Pago a mais corrigido: soma de cada diferença paga × Π(1 + IPCA do mês) do mês seguinte ao pagamento até o último IPCA divulgado; parcela tida como paga no vencimento (1º vencimento + n − 1 meses).',
    'Cenário A recalcula com a taxa média do BACEN; B retira tarifas e seguros questionáveis do principal (com o IOF proporcional) e devolve os pagos à vista; C combina A e B. "Pago a mais" soma as diferenças das parcelas já pagas; "economia futura", as das parcelas restantes.',
    `Versão do cálculo: ${calc.versao_calculo || reg.versao_calculo || '—'}. Versão das teses: ${(reg.teses && reg.teses.versao) || '—'}.`
  ].join('\n'), { tam: 8 });

  const contr = calc.tabela_contratada || [];
  const rev = cp && cp.tabela ? cp.tabela : null;
  if (contr.length) {
    y = verificarPagina(doc, y + 4, 40);
    doc.fillColor(COR.azul).font('Helvetica-Bold').fontSize(9).text(rev ? `Parcela a parcela: contratado × revisado (cenário ${calc.cenario_principal})` : 'Parcela a parcela: contratado', MARGEM, y); y = doc.y + 4;
    const cols = rev
      ? [{ t: 'Nº', w: 30, a: 'right' }, { t: 'Parcela contr.', w: 78, a: 'right' }, { t: 'Juros contr.', w: 74, a: 'right' }, { t: 'Saldo contr.', w: 82, a: 'right' }, { t: 'Parcela rev.', w: 78, a: 'right' }, { t: 'Saldo rev.', w: 82, a: 'right' }, { t: 'Diferença', w: 71, a: 'right' }]
      : [{ t: 'Nº', w: 40, a: 'right' }, { t: 'Parcela', w: 110, a: 'right' }, { t: 'Juros', w: 110, a: 'right' }, { t: 'Amortização', w: 115, a: 'right' }, { t: 'Saldo', w: 120, a: 'right' }];
    const k = e.parcelas_pagas || 0;
    const linhasT = contr.map((l, i) => rev
      ? [l.parcela_n, brl(l.parcela), brl(l.juros), brl(l.saldo), brl(rev[i] && rev[i].parcela), brl(rev[i] && rev[i].saldo), brl(rev[i] ? l.parcela - rev[i].parcela : null)]
      : [l.parcela_n, brl(l.parcela), brl(l.juros), brl(l.amortizacao), brl(l.saldo)]);
    y = tabela(doc, y, cols, linhasT, { tam: 7, alturaLinha: 10, destaque: (ln) => Number(ln[0]) === k && k > 0 });
    if (k > 0) y = paragrafo(doc, y, `Linha em destaque: última parcela paga (${k}ª).`, { tam: 7.5, cor: COR.cinza });
  }

}

module.exports = { render };
