/**
 * RASTREIA — Minutas da Revisão de Contrato Bancário (para o advogado editar).
 *
 *   revisional   → Ação revisional c/c repetição de indébito e tutela de urgência
 *   notificacao  → Notificação extrajudicial ao banco
 *   acordo       → Proposta de acordo
 *
 * Texto por MODELO FIXO (sem IA): os números saem do cálculo
 * (revisao_bancaria.calculo) e as teses do checklist (revisao_bancaria.teses).
 * O que só o advogado sabe fica entre [COLCHETES]. Sai em HTML que o Word abre
 * como .doc — editável, sem dependência nova.
 */
const brl = (v) => (v == null || !Number.isFinite(Number(v)) ? '[valor]' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '[taxa]' : (Number(v) * 100).toFixed(d).replace('.', ',') + '%');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dataBR = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : '[data]'; };
const mesBR = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})/); return m ? `${m[2]}/${m[1]}` : '[mês]'; };
const hoje = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' });

const TIPOS = {
  financiamento_veiculo: 'financiamento de veículo com alienação fiduciária',
  emprestimo_pessoal: 'empréstimo pessoal',
  consignado: 'empréstimo consignado',
  renegociacao: 'renegociação (composição de dívidas)',
  ccb_capital_giro: 'cédula de crédito bancário (capital de giro)',
  conta_garantida: 'conta garantida',
  desconto_recebiveis: 'desconto de títulos/recebíveis',
  antecipacao_cartao: 'antecipação de recebíveis de cartão',
  cartao_credito: 'cartão de crédito',
  cheque_especial: 'cheque especial',
  financiamento_bens: 'financiamento de bens',
  arrendamento_mercantil: 'arrendamento mercantil (leasing)',
  vendor: 'operação vendor',
  compror: 'operação compror',
  cambio: 'adiantamento sobre contrato de câmbio',
  comercio_exterior: 'financiamento de comércio exterior',
  financiamento_imobiliario: 'financiamento imobiliário',
  outro: 'operação de crédito'
};

// Tudo que as minutas usam, calculado uma vez
function caso(pedido, reg, revisor) {
  const d = reg.dados_conferidos || {};
  const c = reg.calculo || {};
  const tx = reg.taxa_media_bacen || {};
  const cp = c.cenario_principal ? (c.cenarios || {})[c.cenario_principal] : null;
  const teses = ((reg.teses && reg.teses.teses) || []).filter(t => t.resultado === 'aplicavel');
  const op = d.operacao || {};
  return {
    autor: d.contratante?.nome || pedido.alvo_nome || '[NOME DO CONTRATANTE]',
    autorDoc: d.contratante?.cpf_cnpj || pedido.alvo_documento || '[CPF/CNPJ]',
    pj: d.pfpj === 'PJ',
    banco: d.instituicao?.nome || '[BANCO]',
    bancoCnpj: d.instituicao?.cnpj || '[CNPJ DO BANCO]',
    contrato: op.numero_contrato || '[nº do contrato]',
    tipo: TIPOS[d.tipo_operacao] || 'operação de crédito',
    dataContr: dataBR(op.data_contratacao),
    financiado: brl(c.entradas?.valor_financiado ?? op.valor_financiado_total),
    parcela: brl(c.entradas?.parcela ?? op.valor_parcela),
    prazo: c.entradas?.prazo_meses ?? op.prazo_meses ?? '[prazo]',
    pagas: c.entradas?.parcelas_pagas ?? d.parcelas_pagas ?? '[nº]',
    taxaAm: pct(c.taxa?.efetiva_am, 2), taxaAa: pct(c.taxa?.efetiva_aa, 2),
    declAm: c.taxa?.declarada_am != null ? pct(c.taxa.declarada_am, 2) : null,
    bacenAm: c.bacen ? pct(c.bacen.am, 2) : null, bacenAa: c.bacen ? pct(c.bacen.aa, 2) : null,
    razao: c.razao != null ? c.razao.toFixed(2).replace('.', ',') : null,
    cet: c.cet && c.cet.real_am != null ? { real: pct(c.cet.real_am, 2), realAa: pct(c.cet.real_aa, 2), decl: c.cet.declarado_am != null ? pct(c.cet.declarado_am, 2) : null, maior: !!c.cet.real_maior_que_declarado, recebido: brl(c.cet.recebido_liquido) } : null,
    serie: tx.origem === 'manual' ? `informada manualmente (${esc(tx.fonte_manual || 'fonte a indicar')})` : (tx.serie_am ? `série SGS ${tx.serie_am}${tx.nome_serie ? ' – ' + tx.nome_serie : ''}` : '[série do BACEN]'),
    mesRef: mesBR(tx.mes_referencia),
    olinda: tx.olinda?.banco ? `${tx.olinda.banco.posicao}º lugar entre ${tx.olinda.total_instituicoes} instituições (da menor para a maior taxa)` : null,
    cp, teses,
    vi: c.valor_incontroverso || null,
    economia: brl(c.economia_estimada),
    buscaApreensao: d.situacao === 'busca_apreensao',
    atrasado: ['atrasado', 'busca_apreensao', 'executado'].includes(d.situacao),
    adv: revisor?.nome || '[ADVOGADO]', oab: revisor?.oab ? `OAB ${revisor.oab}` : 'OAB [nº/UF]',
    versao: c.versao_calculo || reg.versao_calculo || ''
  };
}

const CSS = `body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5;margin:2.5cm 2.5cm 2.5cm 3cm}
h1{font-size:13pt;text-align:center;text-transform:uppercase;margin:18pt 0}h2{font-size:12pt;text-transform:uppercase;margin:16pt 0 6pt}
p{text-align:justify;margin:0 0 8pt;text-indent:2cm}p.ni{text-indent:0}.aviso{border:1px solid #c00;color:#c00;padding:6pt;font-family:Arial;font-size:9pt;text-indent:0}
table{border-collapse:collapse;margin:6pt 0 10pt}td,th{border:1px solid #444;padding:3pt 6pt;font-size:10.5pt}td.n{text-align:right}
.ass{margin-top:36pt;text-align:center;text-indent:0}`;
const doc = (titulo, corpo) => `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS}</style></head><body>
<p class="aviso">MINUTA gerada pelo Rastreia a partir do laudo — revisar, completar os campos entre [colchetes] e adequar ao caso antes de protocolar ou enviar.</p>
${corpo}</body></html>`;

function tabelaCalculo(k) {
  if (!k.cp) return '';
  const l = (r, v) => `<tr><td>${r}</td><td class="n">${v}</td></tr>`;
  return `<table>${l('Parcela contratada', brl(k.cp.parcela_contratada))}${l('Parcela revisada', brl(k.cp.parcela_revisada))}${l('Total pago a maior (parcelas pagas)', brl(k.cp.total_pago_a_mais))}${l('Saldo devedor contratual', brl(k.cp.saldo_devedor_contratual))}${l('Saldo devedor revisado', brl(k.cp.saldo_devedor_revisado))}${l('Economia nas parcelas vincendas', brl(k.cp.economia_futura))}${l('Repetição simples', brl(k.cp.repeticao_simples))}${l('Repetição em dobro', brl(k.cp.repeticao_dobro))}</table>`;
}

function revisional(k) {
  const tesesTxt = k.teses.map((t, i) => `<h2>II.${i + 3} – ${esc(t.nome)}</h2>
<p>${esc(t.detalhe)}${t.trecho_contrato ? ` Consta do contrato: “${esc(t.trecho_contrato)}”.` : ''}</p>
<p>${esc(t.fundamento)}</p>`).join('');
  return doc('Ação revisional', `
<p class="ni"><b>EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DE DIREITO DA [__] VARA CÍVEL DA COMARCA DE [ANÁPOLIS/GO]</b></p>
<p class="ni" style="margin-top:24pt"><b>${esc(k.autor)}</b>, ${k.pj ? 'pessoa jurídica de direito privado, inscrita no CNPJ' : '[nacionalidade], [estado civil], [profissão], inscrito(a) no CPF'} sob o nº ${esc(k.autorDoc)}, [endereço completo e e-mail], por seu advogado que esta subscreve (procuração anexa), vem propor</p>
<h1>Ação revisional de contrato bancário c/c repetição de indébito, com pedido de tutela de urgência</h1>
<p class="ni">em face de <b>${esc(k.banco)}</b>, inscrito no CNPJ sob o nº ${esc(k.bancoCnpj)}, [endereço da sede/agência], pelos fatos e fundamentos a seguir.</p>

<h2>I – Dos fatos</h2>
<p>Em ${k.dataContr}, a parte autora celebrou com o réu contrato de ${k.tipo} nº ${esc(k.contrato)}, no valor financiado de ${k.financiado}, a ser pago em ${k.prazo} parcelas de ${k.parcela}, das quais ${k.pagas} já foram pagas${k.atrasado ? ' [descrever a situação de atraso]' : ''}.</p>
<p>A partir dos próprios valores do contrato (valor financiado, parcela e prazo), a taxa de juros efetivamente praticada é de ${k.taxaAm} ao mês (${k.taxaAa} ao ano)${k.declAm ? `, enquanto o instrumento declara ${k.declAm} ao mês` : ''}. No mês da contratação, a taxa média de mercado divulgada pelo Banco Central do Brasil para a mesma modalidade era de ${k.bacenAm || '[taxa média]'} ao mês (${k.bacenAa || '[taxa anual]'} ao ano – ${k.serie}, referência ${k.mesRef})${k.razao ? `, ou seja, o contrato cobra ${k.razao} vez(es) a média` : ''}${k.olinda ? `; o réu ocupava o ${k.olinda}` : ''}.</p>
${k.cet ? `<p>Considerando o valor efetivamente recebido pela parte autora (${k.cet.recebido}) e as parcelas pactuadas, o Custo Efetivo Total real da operação é de ${k.cet.real} ao mês (${k.cet.realAa} ao ano)${k.cet.decl ? (k.cet.maior ? `, superior ao CET de ${k.cet.decl} ao mês informado no contrato, em afronta à Res. CMN 3.517/2007 e ao art. 52 do CDC` : `, compatível com o CET informado (${k.cet.decl} ao mês)`) : ', sem que o contrato informe o CET, como exige a Res. CMN 3.517/2007'}.</p>` : ''}
<p>O laudo técnico-financeiro anexo (doc. [__]) recalculou a operação e apurou:</p>
${tabelaCalculo(k)}

<h2>II – Do direito</h2>
<h2>II.1 – Da aplicação do Código de Defesa do Consumidor</h2>
<p>Nos termos da Súmula 297 do STJ, o Código de Defesa do Consumidor é aplicável às instituições financeiras, cabendo a revisão de cláusulas que estabeleçam prestações desproporcionais ou excessivamente onerosas (CDC, art. 6º, V) e a inversão do ônus da prova (art. 6º, VIII).</p>
<h2>II.2 – Da possibilidade de revisão</h2>
<p>A revisão judicial de contratos bancários é admitida quando demonstrada abusividade em relação à média de mercado ou a cobrança de encargos e tarifas indevidos (STJ, REsp 1.061.530/RS, repetitivo), o que se comprova pelo laudo anexo.</p>
${tesesTxt || '<p>[Descrever as teses aplicáveis ao caso.]</p>'}
<h2>II.${k.teses.length + 3} – Da repetição do indébito</h2>
<p>Os valores pagos a maior, que somam ${k.cp ? brl(k.cp.total_pago_a_mais) : '[valor]'} até o momento, devem ser restituídos, de forma simples ou em dobro (CDC, art. 42, parágrafo único, e STJ, EAREsp 676.608/RS [conferir a modulação: cobranças a partir de 30/03/2021]), com correção monetária e juros, admitida a compensação com o saldo devedor.</p>

<h2>III – Da tutela de urgência e do valor incontroverso</h2>
<p>Em cumprimento ao art. 330, §§ 2º e 3º, do CPC, a parte autora discrimina as obrigações que pretende controverter e quantifica o valor incontroverso: ${k.vi ? `<b>${brl(k.vi.parcela_mensal)} por mês</b>, em lugar de ${brl(k.vi.parcela_contratada)}, para as ${k.vi.parcelas_restantes} parcela(s) restante(s), com saldo devedor revisado de ${brl(k.vi.saldo_devedor_revisado)}` : '[valor incontroverso]'}, que continuará a pagar no tempo e modo contratados.</p>
<p>Presentes a probabilidade do direito (laudo anexo) e o perigo de dano${k.buscaApreensao ? ' (risco de perda do bem em ação de busca e apreensão)' : ' (negativação e cobrança de valores indevidos)'}, requer a concessão de tutela de urgência (CPC, art. 300) para autorizar o pagamento/depósito do valor incontroverso, ${k.pj ? '' : 'impedir ou excluir a inscrição do nome da parte autora em cadastros de inadimplentes '}${k.buscaApreensao ? 'e manter a parte autora na posse do bem' : 'enquanto durar a discussão'}, nos termos da jurisprudência do STJ [conferir requisitos do REsp 1.061.530/RS].</p>

<h2>IV – Dos pedidos</h2>
<p class="ni">Diante do exposto, requer:</p>
<p class="ni">a) a concessão da tutela de urgência nos termos do item III;</p>
<p class="ni">b) a citação do réu para, querendo, contestar;</p>
<p class="ni">c) a inversão do ônus da prova (CDC, art. 6º, VIII) e a exibição do contrato e da planilha de evolução da dívida;</p>
<p class="ni">d) a procedência do pedido para revisar o contrato, ${k.bacenAm ? `limitando os juros remuneratórios à taxa média de mercado (${k.bacenAm} a.m.)` : 'limitando os juros à taxa média de mercado'}${k.teses.some(t => /seguro|tarifa|terceiros|tac/i.test(t.nome)) ? ' e afastando as tarifas e seguros indevidos' : ''}, recalculando-se as prestações;</p>
<p class="ni">e) a condenação do réu à restituição dos valores pagos a maior, em dobro ou, subsidiariamente, de forma simples, com correção e juros;</p>
<p class="ni">f) a condenação do réu nas custas e honorários advocatícios;</p>
<p class="ni">g) a produção de todas as provas admitidas, especialmente a pericial contábil.</p>
<p>Dá-se à causa o valor de ${k.cp ? brl(k.cp.economia_total) : '[valor]'} (parte controvertida do contrato – CPC, art. 292, II) [conferir].</p>
<p class="ni">Nestes termos, pede deferimento.</p>
<p class="ni">[Anápolis/GO], ${hoje()}.</p>
<p class="ass">_______________________________<br>${esc(k.adv)}<br>${esc(k.oab)}</p>
<p class="ni" style="font-size:9pt;color:#555;margin-top:18pt">Cálculo: ${esc(k.versao)}.</p>`);
}

function notificacao(k) {
  return doc('Notificação extrajudicial', `
<h1>Notificação extrajudicial</h1>
<p class="ni"><b>Notificante:</b> ${esc(k.autor)}, ${k.pj ? 'CNPJ' : 'CPF'} ${esc(k.autorDoc)}, por seu advogado ${esc(k.adv)} (${esc(k.oab)}).</p>
<p class="ni"><b>Notificado:</b> ${esc(k.banco)}, CNPJ ${esc(k.bancoCnpj)}, [endereço / SAC / Ouvidoria].</p>
<p class="ni"><b>Referência:</b> contrato de ${k.tipo} nº ${esc(k.contrato)}, de ${k.dataContr}.</p>
<p>Pela presente, o notificante comunica que o contrato acima foi objeto de revisão técnico-financeira, que constatou: taxa efetiva de ${k.taxaAm} ao mês${k.declAm ? ` (o contrato declara ${k.declAm})` : ''}, ${k.bacenAm ? `contra a taxa média de mercado de ${k.bacenAm} ao mês divulgada pelo Banco Central para a modalidade em ${k.mesRef}` : 'acima da média de mercado'}${k.teses.length ? `, além de: ${k.teses.map(t => t.nome.toLowerCase()).join('; ')}` : ''}.</p>
<p>Apurou-se pagamento a maior de ${k.cp ? brl(k.cp.total_pago_a_mais) : '[valor]'} nas parcelas já quitadas e diferença de ${k.cp ? brl(k.cp.economia_futura) : '[valor]'} nas parcelas a vencer, conforme laudo que pode ser apresentado mediante solicitação.</p>
<p>Fica o notificado instado a, no prazo de 10 (dez) dias: (i) apresentar a planilha de evolução da dívida e a memória de cálculo do contrato; (ii) manifestar-se sobre o recálculo das parcelas pela taxa média de mercado${k.teses.some(t => /seguro|tarifa|terceiros/i.test(t.nome)) ? ' e a exclusão das tarifas e seguros indevidos' : ''}; e (iii) restituir ou compensar os valores pagos a maior.</p>
<p>Não havendo resposta, o notificante adotará as medidas judiciais cabíveis, inclusive ação revisional com repetição de indébito (CDC, art. 42, parágrafo único).</p>
<p class="ni">[Anápolis/GO], ${hoje()}.</p>
<p class="ass">_______________________________<br>${esc(k.adv)}<br>${esc(k.oab)}</p>`);
}

function acordo(k) {
  return doc('Proposta de acordo', `
<h1>Proposta de acordo</h1>
<p class="ni"><b>Ao</b> ${esc(k.banco)} – [setor de renegociação / jurídico].</p>
<p class="ni"><b>Ref.:</b> contrato nº ${esc(k.contrato)} – ${esc(k.autor)} (${esc(k.autorDoc)}).</p>
<p>Com base no laudo técnico-financeiro do contrato, que apurou taxa efetiva de ${k.taxaAm} ao mês${k.bacenAm ? ` frente à média de mercado de ${k.bacenAm} ao mês` : ''}, o(a) cliente propõe, para encerrar a questão sem processo judicial:</p>
<p class="ni">1) recálculo das ${k.vi ? k.vi.parcelas_restantes : '[nº]'} parcelas restantes para ${k.vi ? brl(k.vi.parcela_mensal) : '[valor]'} cada, em lugar de ${k.vi ? brl(k.vi.parcela_contratada) : '[valor]'};</p>
<p class="ni">2) abatimento de ${k.cp ? brl(k.cp.total_pago_a_mais) : '[valor]'} pagos a maior, compensado no saldo devedor (saldo revisado: ${k.cp ? brl(k.cp.saldo_devedor_revisado) : '[valor]'});</p>
<p class="ni">3) ${k.buscaApreensao ? 'extinção da ação de busca e apreensão e manutenção do bem com o(a) cliente' : 'baixa de eventuais restrições em cadastros de inadimplentes'};</p>
<p class="ni">4) [alternativa: quitação à vista por R$ ______, com desconto].</p>
<p>A proposta é válida por 15 (quinze) dias. A economia total estimada no laudo é de ${k.economia}; o acordo evita o custo e o tempo de uma ação revisional.</p>
<p class="ni">[Anápolis/GO], ${hoje()}.</p>
<p class="ass">_______________________________<br>${esc(k.adv)}<br>${esc(k.oab)}</p>`);
}

const MINUTAS = { revisional: ['Acao_revisional', revisional], notificacao: ['Notificacao_extrajudicial', notificacao], acordo: ['Proposta_de_acordo', acordo] };

function gerarMinuta(tipo, pedido, reg, revisor) {
  const m = MINUTAS[tipo];
  if (!m) return null;
  const k = caso(pedido, reg, revisor);
  const nomeArq = `${m[0]}_${String(k.autor).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}_${pedido.numero || ''}.doc`;
  return { nome: nomeArq, html: m[1](k) };
}

module.exports = { gerarMinuta, caso, TIPOS_MINUTA: Object.keys(MINUTAS) };
