/**
 * RASTREIA — Revisão Bancária: DIAGNÓSTICO ESTRATÉGICO (sem IA).
 *
 * Responde o que o dono pergunta de verdade: há abuso? o que NÃO é abuso?
 * quem corre risco? o que fazer esta semana? Regras do caso GiroCaixa
 * (15/10/2026), validadas com pesquisa de jurisprudência — tabela em
 * ~/.claude/skills/revisao-contrato-bancario/SKILL.md.
 *
 * Entrada: dados conferidos (d), cálculo (calc), taxa BACEN (taxa), teses (ts).
 * A IA só LÊ as cláusulas (dados_extraidos.clausulas); a decisão é daqui.
 * Toda Súmula/Tema citado aqui precisa estar na lista conferida
 * (teste 14 de scripts/test-revisao-bancaria.js).
 */
const VERSAO_DIAGNOSTICO = 'rb-diag-1.0.0 (2026-10-15)';

const GIRO_PJ = ['ccb_capital_giro', 'conta_garantida', 'desconto_recebiveis', 'antecipacao_cartao', 'vendor', 'compror', 'cambio', 'comercio_exterior'];
const TIPO_NOME = {
  financiamento_veiculo: 'Financiamento de veículo', emprestimo_pessoal: 'Empréstimo pessoal', consignado: 'Consignado', renegociacao: 'Renegociação de dívida',
  ccb_capital_giro: 'CCB de capital de giro', conta_garantida: 'Conta garantida', desconto_recebiveis: 'Desconto de recebíveis', antecipacao_cartao: 'Antecipação de cartão',
  cartao_credito: 'Cartão de crédito', cheque_especial: 'Cheque especial', financiamento_bens: 'Financiamento de bens', arrendamento_mercantil: 'Leasing',
  vendor: 'Vendor', compror: 'Compror', cambio: 'ACC', comercio_exterior: 'Financiamento de comércio exterior', financiamento_imobiliario: 'Financiamento imobiliário', outro: 'Contrato bancário'
};

const fx = (v, c = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const brl = (v) => 'R$ ' + fx(v);
const vezes = (r) => `${fx(r)}×`;
const sim = (o, k = 'presente') => !!(o && o[k] === true);
const ref = (o) => (o && o.clausula ? o.clausula : null);

// CDC: PF consumidor sim; PJ com capital de giro, em regra não
function cdc(d) {
  if ((d.pfpj || 'PF') === 'PF') return { aplica: true, motivo: 'Pessoa física: o CDC se aplica aos bancos (Súmula 297 STJ).' };
  if (GIRO_PJ.includes(d.tipo_operacao)) return { aplica: false, motivo: 'Empresa com capital de giro: o STJ afasta o CDC (ser ME não basta; precisa provar vulnerabilidade). A base é o Código Civil e as súmulas bancárias, e tudo precisa ser pedido expressamente, porque o juiz não reconhece abuso de ofício (Súmula 381 STJ).' };
  return { aplica: null, motivo: 'Empresa: o CDC só se aplica se a empresa provar vulnerabilidade diante do banco.' };
}

// Razão taxa ÷ média BACEN de cada saque (contrato de limite)
function operacoes(d, mediaAM) {
  return (d.operacoes_do_limite || []).map(o => ({
    ...o,
    razao: o.taxa_mensal != null && mediaAM ? Number(o.taxa_mensal) / mediaAM : null
  }));
}

function forcaDaRazao(r) { return r >= 2 ? 'alta' : r >= 1.5 ? 'media' : null; }

function montarDiagnostico(d = {}, calc = {}, taxa = null, ts = null) {
  const op = d.operacao || {};
  const cl = d.clausulas || {};
  const mediaAM = taxa && taxa.ok ? Number(taxa.valor_am) : null;
  const limite = op.estrutura === 'limite_de_credito';
  const ops = operacoes(d, mediaAM);
  const opsComTaxa = ops.filter(o => o.razao != null);
  const taxaProvada = limite ? opsComTaxa.length > 0 : (calc?.taxa?.efetiva_am != null);
  const c = cdc(d);
  const achados = [], naoAbuso = [], semana = [], garantias = [], prejuizo = [], caminhos = [], documentos = [];

  // ── Juros ────────────────────────────────────────────────────────────────
  let razao = calc?.razao ?? null;
  if (limite && opsComTaxa.length) razao = Math.max(...opsComTaxa.map(o => o.razao));
  if (limite && !taxaProvada) {
    achados.push({
      id: 'taxa_em_faixa', forca: 'alta', titulo: 'A taxa de cada saque não está provada no contrato',
      clausula: op.clausula_capitalizacao_trecho ? 'Cláusula dos encargos' : null,
      trecho: op.clausula_capitalizacao_trecho || null,
      porque: `O contrato só traz uma faixa${op.taxa_minima_mensal != null ? ` (${fx(op.taxa_minima_mensal)}%${op.taxa_maxima_mensal != null ? ` a ${fx(op.taxa_maxima_mensal)}%` : ''} ao mês)` : ''}; a taxa real de cada saque fica a critério do banco. Sem o comprovante de cada saque, vale a média do Banco Central${mediaAM ? ` (${fx(mediaAM)}% a.m.)` : ''}.`,
      base: 'Súmula 530 STJ (nasceu do REsp 1.112.879/PR, sobre cheque especial sem taxa); CC art. 122 (condição ao arbítrio de uma parte).',
      defesa_banco: 'A taxa é informada e aceita no internet banking a cada saque; a faixa é cláusula padrão de adesão.',
      depende_cdc: false
    });
  }
  if (razao != null) {
    const f = forcaDaRazao(razao);
    if (f) achados.push({
      id: 'juros_acima_media', forca: f, titulo: `Juros ${vezes(razao)} a média do mercado`,
      porque: `A taxa ${limite ? 'do saque mais caro' : 'efetiva do contrato'} é ${vezes(razao)} a média do Banco Central para a mesma operação no mês da contratação.`,
      base: 'REsp 1.061.530/RS (repetitivo): revisão quando a abusividade fica demonstrada; a média do BACEN é referência, e o STJ costuma exigir 1,5× ou mais.',
      defesa_banco: 'A média é só referência; risco do cliente e prazo justificam a taxa.', depende_cdc: false
    });
    else naoAbuso.push({ titulo: `Taxa ${vezes(razao)} a média do mercado`, porque: 'Acima da média, mas abaixo de 1,5×: dificilmente um juiz declara abusiva. Não vender esse ponto como ganho.' });
  } else if (limite && op.taxa_minima_mensal != null && mediaAM) {
    const rp = op.taxa_minima_mensal / mediaAM;
    if (rp < 1.5) naoAbuso.push({ titulo: `Se os saques saíram perto do piso (${fx(op.taxa_minima_mensal)}% a.m.)`, porque: `O piso é ${vezes(rp)} a média: a taxa em si dificilmente será declarada abusiva. O argumento forte é a falta de prova da taxa (Súmula 530), não o tamanho dela.` });
  }
  if (op.capitalizacao_expressa === true) naoAbuso.push({ titulo: 'Juros capitalizados mês a mês', porque: 'Estão escritos no contrato, o que é permitido (Súmulas 539 e 541 STJ).' });
  if (c.aplica === false) naoAbuso.push({ titulo: 'Código de Defesa do Consumidor', porque: c.motivo });

  // ── Cláusulas da estratégia ──────────────────────────────────────────────
  const red = cl.taxa_reduzida_condicionada;
  if (sim(red) && red.aviso_previo !== true) {
    achados.push({
      id: 'perda_redutor', forca: 'media', titulo: 'Atrasou ou cancelou o débito automático: a taxa sobe para sempre',
      clausula: ref(red), trecho: red.trecho || null,
      porque: 'O desconto na taxa é retirado sem aviso e não volta: é uma punição pelo atraso embutida nos juros, somada à multa e aos juros de mora.',
      base: 'Alavanca de negociação. O Banco Central passou a exigir aviso de 30 dias antes de retirar desconto desse tipo numa modalidade nova (parâmetro, a conferir). Em juízo, só se o extrato mostrar que a taxa subiu.',
      defesa_banco: 'O redutor é um benefício condicionado, aceito no contrato.', depende_cdc: false
    });
    prejuizo.push('A taxa sobe para a "taxa balcão" no primeiro atraso ou se o débito automático for cancelado, e não volta.');
  }
  const rot = cl.debito_em_limite_rotativo;
  if (sim(rot, 'autorizado')) {
    semana.push({ acao: 'Revogar por escrito SÓ o débito das parcelas no limite rotativo / cheque especial, mantendo o débito automático da parcela (confirmar com o advogado antes).', porque: `Sem saldo, a parcela é paga com cheque especial, que é bem mais caro.${sim(red) ? ' Manter o débito automático evita perder o desconto na taxa.' : ''} Base: Res. CMN 4.790/2020, art. 6º${rot.revogavel ? ', e o próprio contrato diz que a autorização é revogável' : ''}. O STJ está dividido sobre revogar autorização de débito (Tema 1085), por isso fazer com protocolo.` });
    prejuizo.push('Parcela sem saldo vira dívida de cheque especial automaticamente (o custo só aparece no extrato da conta).');
    achados.push({ id: 'debito_rotativo', forca: 'baixa', titulo: 'Parcela debitada no cheque especial', clausula: ref(rot), trecho: rot.trecho || null, porque: 'Troca a dívida do contrato por outra mais cara sem o cliente decidir.', base: 'Mais útil como medida imediata (revogar) do que como pedido de abuso.', defesa_banco: 'Autorização dada pelo cliente no contrato.', depende_cdc: false });
  }
  const mora = cl.juros_mora_sobre_juros;
  if (sim(mora)) achados.push({ id: 'mora_sobre_juros', forca: 'media', titulo: 'No atraso, juros de mora incidem sobre juros', clausula: ref(mora), trecho: mora.trecho || null, porque: 'A dívida em atraso cresce com juros sobre juros além da multa.', base: 'Discutir na revisional ou usar na negociação do saldo em atraso.', defesa_banco: 'Encargos pactuados e previstos na Lei 10.931/2004.', depende_cdc: false });
  if (cl.honorarios_extrajudiciais_percentual > 10) achados.push({ id: 'honorarios_extra', forca: 'alta', titulo: `Honorários de ${fx(cl.honorarios_extrajudiciais_percentual, 0)}% cobrados sem ação — acima do limite de 10%`, porque: 'O banco soma honorários de advogado à dívida antes de qualquer processo, acima do que a lei da CCB permite.', base: 'Lei 10.931/2004, art. 28, § 1º, IV: na CCB, honorários extrajudiciais até 10% do total devido. Abater o excesso na negociação ou nos embargos.', defesa_banco: 'Se o título não for CCB, o limite legal não se aplica.', depende_cdc: false });
  else if (cl.honorarios_extrajudiciais_percentual > 0) achados.push({ id: 'honorarios_extra', forca: 'baixa', titulo: `Honorários de ${fx(cl.honorarios_extrajudiciais_percentual, 0)}% cobrados sem ação`, porque: 'O banco soma honorários de advogado à dívida antes de qualquer processo.', base: 'Dentro do limite de 10% da CCB (Lei 10.931/2004, art. 28, § 1º, IV): contestar só na negociação do saldo.', defesa_banco: 'Previsão contratual.', depende_cdc: false });

  // Teses automáticas aplicáveis (tarifas, seguros, comissão de permanência…)
  for (const t of (ts?.teses || [])) {
    if (t.resultado !== 'aplicavel' || ['juros_abusivos', 'capitalizacao'].includes(t.id)) continue;
    achados.push({ id: 'tese_' + t.id, forca: c.aplica === false ? 'media' : 'alta', titulo: t.nome, trecho: t.trecho_contrato || null, porque: t.detalhe, base: t.fundamento, defesa_banco: null, depende_cdc: null });
  }

  // ── Garantias e exposição ────────────────────────────────────────────────
  const g = d.garantia || {};
  const anos = cl.vigencia_dias ? Math.round(cl.vigencia_dias / 365) : null;
  if (g.tipo === 'aval' || cl.avalistas_quantidade) {
    garantias.push(`${cl.avalistas_quantidade ? cl.avalistas_quantidade + ' avalista(s)' : 'Avalistas'} respondem com o patrimônio pessoal${cl.aval_com_anuencia_conjuge ? '; com a assinatura do cônjuge, os bens do casal também ficam expostos' : ''}.`);
    garantias.push('O banco pode executar os avalistas direto, sem cobrar a empresa antes: a CCB é título executivo, inclusive em crédito rotativo (Lei 10.931/2004, art. 28; REsp 1.291.575/PR).');
    if ((d.pfpj || 'PF') === 'PJ') garantias.push('Recuperação judicial da empresa NÃO protege os avalistas (Súmula 581 STJ).');
  }
  if (sim(cl.garantia_dividas_futuras)) garantias.push(`O aval cobre saques futuros${anos ? ` durante toda a vigência (cerca de ${anos} anos)` : ''}, inclusive os que os avalistas não acompanharem.`);
  if (cl.renuncia_beneficio_ordem) garantias.push('Há renúncia ao benefício de ordem: o garantidor não pode exigir que cobrem a empresa primeiro.');
  if (sim(cl.limite_aumentado_pelo_banco) && sim(cl.garantia_dividas_futuras)) achados.push({ id: 'aval_limite_aumentado', forca: 'media', titulo: 'Aval sobre limite que o banco pode aumentar', clausula: ref(cl.limite_aumentado_pelo_banco), trecho: cl.limite_aumentado_pelo_banco.trecho || null, porque: 'Se o limite foi aumentado sem nova assinatura dos avalistas, dá para pedir que o aval fique limitado ao valor escrito na cédula.', base: 'Tese a construir (não há precedente específico); afastar o aval por inteiro é improvável.', defesa_banco: 'Aval autônomo e cláusula expressa de dívidas futuras.', depende_cdc: false });
  if (sim(cl.compensacao_ampla)) garantias.push('O banco pode reter dinheiro de qualquer conta ou aplicação do devedor nele para abater a dívida.');
  const va = cl.vencimento_antecipado;
  if (sim(va) && (va.cruzado_outras_operacoes || va.por_fato_de_avalista || va.por_debito_fiscal)) {
    const gat = [va.cruzado_outras_operacoes && 'atraso em outra operação', va.por_fato_de_avalista && 'problema na conta de um avalista', va.por_debito_fiscal && 'débito fiscal ou trabalhista'].filter(Boolean).join(', ');
    prejuizo.push(`Um problema pontual (${gat}) permite cobrar a dívida inteira de uma vez${va.sem_notificacao ? ', sem notificação' : ''}.`);
    achados.push({ id: 'vencimento_cruzado', forca: 'baixa', titulo: 'Vencimento antecipado por gatilhos amplos', clausula: ref(va), trecho: va.trecho || null, porque: `Gatilhos: ${gat}.`, base: 'Os tribunais tendem a validar essa cláusula em CCB: tratar como RISCO a gerenciar, não como pedido.', defesa_banco: 'Cláusula expressa, comum em CCB.', depende_cdc: false });
  }
  if (razao != null && razao >= 1.2) prejuizo.push(`Juros ${vezes(razao)} a média do mercado.`);

  // ── Linha do tempo de risco ──────────────────────────────────────────────
  const linha = (cl.prazos_de_risco || []).filter(p => p && p.evento).sort((a, b) => (a.dias ?? 999) - (b.dias ?? 999))
    .map(p => ({ evento: p.evento, dias: p.dias ?? null, clausula: p.clausula || null }));
  if (sim(va)) linha.push({ evento: 'Vencimento antecipado de toda a dívida e execução direta (empresa e avalistas)', dias: null, clausula: ref(va) });

  // ── Alavancas e caminhos ─────────────────────────────────────────────────
  const fg = cl.fundo_garantidor;
  const alavancas = [];
  alavancas.push(`Valor de quitação de cada operação pelas regras do Banco Central (Res. CMN 3.516/2007): é direito, não desconto negociado — usar como piso da proposta${sim(cl.liquidacao_antecipada) && ref(cl.liquidacao_antecipada) ? ` (${ref(cl.liquidacao_antecipada)})` : ''}.`);
  if (fg && fg.tipo) alavancas.push(`Fundo garantidor ${fg.tipo}${fg.percentual ? ` (${fx(fg.percentual, 0)}%)` : ''}: se algum saque usou e foi honrado, o banco já recebeu a maior parte${fg.honra_atualiza_pela_selic ? ' e a dívida passa a corrigir pela Selic, não pela taxa do contrato' : ''} — confirmar o uso por operação.`);
  if (limite && !taxaProvada) alavancas.push('Falta de prova da taxa de cada saque (Súmula 530): sem os comprovantes, a dívida recalculada pela média do BACEN fica menor.');
  if (sim(red)) alavancas.push('Retirada do desconto na taxa sem aviso.');
  semana.push({ acao: 'Pedir ao banco, por escrito e com protocolo, operação por operação: comprovante de contratação com taxa e CET, saldo devedor e valor de quitação antecipada.', porque: 'Destrava o cálculo e é requisito para pedir os documentos na Justiça se o banco não entregar (Tema 648 STJ).' });
  if (sim(cl.canal_renegociacao)) semana.push({ acao: `Registrar pedido de renegociação no canal do contrato${cl.canal_renegociacao.contato ? ` (${cl.canal_renegociacao.contato})` : ''}, por escrito.`, porque: `Previsto no próprio contrato${ref(cl.canal_renegociacao) ? ` (${ref(cl.canal_renegociacao)})` : ''}; cria prova de boa-fé.` });

  caminhos.push({ nome: 'Negociação com o banco', quando: 'Primeiro passo, em qualquer cenário.', como: alavancas, custo_risco: 'Custo baixo. Não suspende cobrança: manter as parcelas em dia ou negociar antes do vencimento antecipado.' });
  caminhos.push({ nome: 'Pedido de documentos e, se negado, exibição na Justiça', quando: 'Se o banco não entregar os comprovantes em prazo razoável.', como: ['Pedido administrativo específico, com prova de entrega; sem isso a ação é extinta (Tema 648 STJ).'], custo_risco: 'Custo baixo; protege o caso antes de discutir mérito.' });
  const temBase = achados.some(a => a.forca === 'alta') || (razao != null && razao >= 1.5);
  caminhos.push({
    nome: 'Ação revisional', quando: temBase ? 'Há base: avaliar com o advogado depois dos documentos.' : 'Só se os documentos mostrarem taxa de 1,5× a média ou mais, ou se o banco não provar a taxa.',
    como: [cl.foro === 'justica_federal' ? 'Justiça Federal: se a empresa for ME/EPP e a causa até 60 salários mínimos, Juizado Especial Federal (Lei 10.259/2001, arts. 3º e 6º, I).' : 'Foro do contrato.', 'Para evitar negativação durante a ação, depositar a parte incontroversa (REsp 1.061.530/RS).'],
    custo_risco: 'Custas e honorários; risco de pagar os honorários do banco se perder. A ação, sozinha, não impede execução nem negativação.'
  });

  // ── Documentos ───────────────────────────────────────────────────────────
  if (limite) documentos.push({ doc: 'Comprovante / demonstrativo de cada saque (valor, taxa, CET, prazo, parcela, se usou fundo garantidor)', onde: 'Internet banking do banco ou agência', destrava: 'A taxa real de cada operação e a comparação com o mercado' });
  else documentos.push({ doc: 'Contrato completo e planilha de evolução da dívida', onde: 'Agência ou internet banking', destrava: 'O recálculo exato' });
  documentos.push({ doc: `Extrato da conta desde ${op.data_contratacao ? op.data_contratacao.slice(5, 7) + '/' + op.data_contratacao.slice(0, 4) : 'a contratação'}`, onde: 'Internet banking', destrava: 'Juros de cheque especial, IOF extra e se a taxa subiu' });
  documentos.push({ doc: 'Saldo devedor atual e situação de cada operação (em dia, atraso, cobrança)', onde: 'Banco', destrava: 'A proposta de acordo e a linha do tempo de risco' });
  if ((d.pfpj || 'PF') === 'PJ') documentos.push({ doc: 'Faturamento dos últimos 12 meses e enquadramento (ME/EPP)', onde: 'Contador', destrava: 'Juizado Especial Federal e regras de quitação antecipada' });

  // ── Resumo honesto ───────────────────────────────────────────────────────
  const banco = d.instituicao?.nome || 'o banco';
  const resumo = [];
  resumo.push(`${limite ? 'Contrato de LIMITE de crédito' : (TIPO_NOME[d.tipo_operacao] || 'Contrato bancário')} com ${banco}, ${(d.pfpj || 'PF') === 'PJ' ? 'empresa' : 'pessoa física'}${op.limite_credito ? `, limite de ${brl(op.limite_credito)}` : op.valor_financiado_total ? `, ${brl(op.valor_financiado_total)}` : ''}.`);
  if (limite && !taxaProvada) resumo.push('O contrato não prova a taxa de cada saque: sem os comprovantes, vale a média do Banco Central (Súmula 530). Esse é o principal argumento hoje.');
  else if (razao != null) resumo.push(razao >= 1.5 ? `Juros ${vezes(razao)} a média: há base para revisão.` : `Juros ${vezes(razao)} a média: o tamanho da taxa, sozinho, não sustenta a revisão.`);
  if (prejuizo.length) resumo.push(`Maior risco: ${prejuizo[0].charAt(0).toLowerCase() + prejuizo[0].slice(1)}`);
  const minusc = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  resumo.push(`Caminho: ${semana.length ? minusc(semana[0].acao.replace(/ \(confirmar com o advogado antes\)/, '').replace(/\.$/, '')) : 'pedir os documentos'}; depois, negociar com base no valor de quitação${temBase ? ' e, se o banco não ceder, avaliar a revisional' : ''}.`);
  if (c.aplica === false) resumo.push('Sem Código do Consumidor: a base é o Código Civil e as súmulas do STJ.');

  // Mensagem ao cliente (linguagem simples)
  const mensagem = [
    'Olá! Analisamos o seu contrato.',
    limite && !taxaProvada ? 'O contrato não mostra a taxa de juros de cada empréstimo que vocês tiraram, e isso pode ser usado a seu favor.' : (razao != null && razao >= 1.5 ? 'Os juros estão bem acima do que o mercado cobrava, e há base para pedir revisão.' : 'Encontramos pontos para usar numa negociação com o banco.'),
    sim(rot, 'autorizado') ? 'Importante: não cancele nenhum débito automático no banco sem falar com a gente antes — dependendo de como for feito, a taxa de juros pode subir.' : '',
    'Para concluir, precisamos de:',
    ...documentos.map((x, i) => `${i + 1}. ${x.doc} (${x.onde.toLowerCase()})`),
    'Pode mandar em PDF ou foto. Obrigado!'
  ].filter(Boolean).join('\n');

  const ordem = { alta: 0, media: 1, baixa: 2 };
  achados.sort((a, b) => ordem[a.forca] - ordem[b.forca]);
  return {
    versao: VERSAO_DIAGNOSTICO, resumo, esta_semana: semana, linha_do_tempo: linha,
    estrutura: { limite, tipo: TIPO_NOME[d.tipo_operacao] || 'Contrato bancário', cdc: c },
    operacoes: ops, achados, nao_e_abuso: naoAbuso, garantias, maior_prejuizo: prejuizo.slice(0, 3),
    caminhos, documentos, mensagem_cliente: mensagem,
    nota: 'Diagnóstico preliminar gerado por regras; não é parecer jurídico. Precedentes marcados como "a conferir" e teses novas passam pelo advogado.'
  };
}

module.exports = { montarDiagnostico, cdc, VERSAO_DIAGNOSTICO };
