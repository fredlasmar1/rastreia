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
const VERSAO_DIAGNOSTICO = 'rb-diag-1.1.0 (2026-10-22)';

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

  // ── Cobrança já na Justiça: o prazo de defesa passa na frente de tudo ─────
  if (d.situacao === 'busca_apreensao') {
    prejuizo.unshift('Busca e apreensão em curso: o bem pode ser retirado e vendido; para reaver, a lei exige pagar a dívida inteira em 5 dias da liminar.');
    semana.unshift({ acao: 'Conferir HOJE a data da liminar e da citação: são 5 dias para pagar a dívida inteira e reaver o bem e 15 dias para a defesa.', porque: 'Perdido o prazo, o bem vai a leilão e a revisão vira só cobrança do saldo. A defesa pode alegar juros abusivos para afastar a mora. Base: DL 911/1969, art. 3º, §§ 1º a 3º.' });
  } else if (d.situacao === 'executado') {
    prejuizo.unshift('Execução em curso: penhora de conta, bens e salário acima do protegido, inclusive dos avalistas.');
    semana.unshift({ acao: 'Conferir HOJE a data em que o mandado de citação foi juntado: são 15 dias para os embargos à execução.', porque: 'Perdido o prazo, a penhora segue sem defesa. Nos embargos por excesso, é preciso declarar o valor devido e juntar o cálculo — o deste caso serve de base. Base: CPC, arts. 915 e 917, § 3º.' });
  } else if (d.situacao === 'atrasado') {
    prejuizo.unshift('Contrato em atraso: negativação, vencimento antecipado de toda a dívida e cobrança judicial.');
  }

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
  if (calc?.teto && (calc.teto.excedido || calc.teto.regulada)) resumo.push(calc.teto.excedido ? `${calc.teto.nome}: ${calc.teto.detalhe}` : calc.teto.detalhe);
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

  // Quanto cada argumento põe no bolso (do cálculo; nunca estimado): juros/teto
  // = cenário A; tarifas e seguros = cenário B (somados, porque saem juntos)
  const eA = calc?.cenarios?.A?.economia_total, eB = calc?.cenarios?.B?.economia_total;
  for (const a of achados) {
    if (['juros_acima_media', 'tese_teto_legal'].includes(a.id) && eA > 0) a.impacto = { valor: eA, nota: calc.cenarios.A.nome };
    if (['tese_avaliacao_registro_terceiros', 'tese_seguro_venda_casada', 'tese_tac_tec'].includes(a.id) && eB > 0) a.impacto = { valor: eB, nota: 'junto com as demais tarifas e seguros', grupo: 'B' };
  }
  const ordem = { alta: 0, media: 1, baixa: 2 };
  achados.sort((a, b) => ordem[a.forca] - ordem[b.forca] || (b.impacto?.valor || 0) - (a.impacto?.valor || 0));
  const out = {
    versao: VERSAO_DIAGNOSTICO, resumo, esta_semana: semana, linha_do_tempo: linha,
    estrutura: { limite, tipo: TIPO_NOME[d.tipo_operacao] || 'Contrato bancário', cdc: c },
    operacoes: ops, achados, nao_e_abuso: naoAbuso, garantias, maior_prejuizo: prejuizo.slice(0, 3),
    caminhos, documentos, mensagem_cliente: mensagem,
    nota: 'Diagnóstico preliminar gerado por regras; não é parecer jurídico. Precedentes marcados como "a conferir" e teses novas passam pelo advogado.'
  };
  out.placar = placar(out, calc);
  return out;
}

/**
 * Placar do caso: a resposta em 10 segundos — vale a pena? quanto está em jogo?
 * o que fazer agora? Função pura sobre o diagnóstico + cálculo (também roda em
 * diagnósticos antigos, sem placar gravado). Nenhum número inventado: sem
 * cálculo, diz o que falta.
 */
function placar(g = {}, calc = {}) {
  calc = calc || {};
  const achados = g.achados || [];
  const fortes = achados.filter(a => a.forca === 'alta');
  const medios = achados.filter(a => a.forca === 'media');
  const nivel = calc.veredito?.nivel || null;
  const teto = calc.teto || null;
  const n = (k) => `${k} argumento${k > 1 ? 's' : ''} forte${k > 1 ? 's' : ''}`;

  let decisao;
  if (!nivel) decisao = { codigo: 'documentos', rotulo: 'FALTA CALCULAR', porque: `O cálculo desta revisão ainda não rodou: confira os dados e confirme para ver o veredito.${fortes.length ? ` Já há ${n(fortes.length)}.` : ''}` };
  else if (nivel === 'inviavel') decisao = { codigo: 'nao', rotulo: 'NÃO VALE', porque: calc.veredito.motivo };
  else if (teto && teto.excedido) decisao = { codigo: 'entrar', rotulo: 'VALE ENTRAR', porque: `${teto.nome}: o contrato passou do limite da lei.` };
  else if (nivel === 'incompleto') decisao = { codigo: 'documentos', rotulo: 'FALTA DOCUMENTO', porque: fortes.length ? `Há ${n(fortes.length)}, mas o valor em jogo só sai com os documentos.` : 'Sem os documentos ainda não dá para dizer se vale.' };
  else if (nivel === 'forte') decisao = { codigo: 'entrar', rotulo: 'VALE ENTRAR', porque: 'Juros ou cobranças indevidas pesam no bolso: há base para revisão.' };
  else if (nivel === 'moderada' || fortes.length) decisao = { codigo: 'negociar', rotulo: 'VALE NEGOCIAR', porque: 'Há pontos para baixar a dívida na conversa com o banco; ação só se ele não ceder.' };
  else decisao = { codigo: 'nao', rotulo: 'NÃO VALE A AÇÃO', porque: 'O contrato está dentro do que os tribunais costumam aceitar: não vender revisão, no máximo negociação.' };

  const em_jogo = [];
  const eco = Number(calc.economia_estimada) || 0;
  const cp = calc.cenario_principal && calc.cenarios ? calc.cenarios[calc.cenario_principal] : null;
  if (eco > 0) em_jogo.push({ rotulo: 'Economia estimada', valor: eco, nota: cp ? cp.nome : null });
  const vi = calc.valor_incontroverso;
  if (vi && vi.parcela_contratada > vi.parcela_mensal) em_jogo.push({ rotulo: 'Parcela hoje → revisada', valor: vi.parcela_mensal, de: vi.parcela_contratada, nota: `${vi.parcelas_restantes} parcela(s) a vencer` });
  const ic = calc.indebito_corrigido;
  if (ic && ic.nominal > 0) em_jogo.push({ rotulo: 'Já pago a mais (corrigido)', valor: ic.corrigido, nota: 'IPCA, sem juros de mora' });
  if (teto && teto.excesso > 0) em_jogo.push({ rotulo: 'Encargos acima do teto', valor: teto.excesso, nota: 'não podem ser cobrados' });
  if (calc.cenario_otimista && calc.economia_otimista > 0) em_jogo.push({ rotulo: 'Se o juiz limitar os juros à média', valor: calc.economia_otimista, nota: 'NÃO garantido — taxa abaixo de 1,5× a média' });
  const falta = em_jogo.length ? null : (calc.veredito?.pedir_documentos?.[0] || (g.documentos || [])[0]?.doc || 'os documentos do contrato');
  const contexto = [];
  if (!em_jogo.length && calc.limite && calc.limite.razao_piso != null) contexto.push(`Até a taxa mínima do contrato já é ${vezes(calc.limite.razao_piso)} a média do Banco Central.`);

  const sem = (g.esta_semana || [])[0];
  // 1ª frase: termina em ponto seguido de maiúscula ("art. 3º" não encerra a frase)
  const primeiraFrase = (t) => { const m = String(t || '').match(/^.+?[.!?](?=\s+[A-ZÀ-Ú]|$)/); return m ? m[0] : String(t || ''); };
  const proximo = sem ? { acao: sem.acao.replace(/\s*\(confirmar com o advogado antes\)/, ''), porque: primeiraFrase(sem.porque), confirmar_advogado: /confirmar com o advogado/.test(sem.acao) } : null;

  const candidatos = [...fortes, ...medios];
  const comValor = candidatos.filter(a => a.impacto && a.impacto.valor > 0).sort((a, b) => b.impacto.valor - a.impacto.valor);
  const melhor = comValor[0] || candidatos[0] || null;
  const em_30s = [];
  if (melhor) em_30s.push({ tipo: 'argumento', texto: melhor.titulo + (melhor.impacto ? ` — vale cerca de R$ ${fx(melhor.impacto.valor)}` : '') });
  if ((g.maior_prejuizo || [])[0]) em_30s.push({ tipo: 'risco', texto: g.maior_prejuizo[0] });
  const naoPrometer = (g.nao_e_abuso || []).find(x => !/Código de Defesa do Consumidor/.test(x.titulo));
  if (naoPrometer) em_30s.push({ tipo: 'nao_prometer', texto: naoPrometer.titulo });

  return { decisao, em_jogo, falta, contexto, proximo, em_30s, contagem: { fortes: fortes.length, medios: medios.length, fracos: achados.length - fortes.length - medios.length } };
}

/**
 * Próximo passo da EQUIPE (não do cliente) na análise rápida: uma decisão, os
 * passos com o botão de cada um e a mensagem pronta para o cliente. Função
 * pura; os números saem do cálculo, nunca da IA.
 *   ctx = { veredito, calc, diag, dados, pedido: { id, numero, etapa } | null }
 */
const ETAPA_NOME = {
  aguardando_documentos: 'aguardando documentos', extraindo: 'lendo o contrato', conferencia_operador: 'conferência dos dados',
  calculando: 'cálculo', revisao_juridica: 'com o advogado', aprovado: 'aprovada', concluido: 'laudo entregue'
};
// Achado → frase que o cliente entende (sem juridiquês). Achado sem tradução não vai à mensagem.
const PARA_CLIENTE = {
  juros_acima_media: 'juros bem acima da média que os bancos cobravam',
  tese_teto_legal: 'juros acima do limite que a lei permite',
  taxa_em_faixa: 'o contrato não prova a taxa de cada empréstimo',
  tese_avaliacao_registro_terceiros: 'cobrança de "serviços de terceiros" sem dizer qual serviço foi feito',
  tese_seguro_venda_casada: 'seguro embutido sem você poder recusar',
  tese_tac_tec: 'tarifa de abertura que não pode mais ser cobrada',
  tese_taxa_maior_declarada: 'a taxa real é maior que a escrita no contrato',
  tese_cet_informado: 'o custo total é maior que o informado',
  tese_comissao_permanencia: 'encargos de atraso cobrados em duplicidade',
  tese_honorarios_ccb: 'honorários de cobrança acima de 10%',
  honorarios_extra: 'honorários de cobrança acima de 10%'
};

function acaoDaEquipe({ veredito, calc = {}, diag = null, dados = {}, pedido = null } = {}) {
  calc = calc || {};
  const nivel = calc.veredito?.nivel || veredito || null;
  const banco = dados.instituicao?.nome || 'o banco';
  const urgente = dados.situacao === 'busca_apreensao'
    ? 'Busca e apreensão em curso: o prazo para defesa (5 dias para pagar e reaver o bem, 15 para contestar) corre da liminar. Ligar para o cliente hoje.'
    : dados.situacao === 'executado' ? 'Execução em curso: 15 dias para os embargos a partir da juntada do mandado. Ligar para o cliente hoje.' : null;

  if (pedido && pedido.id) {
    return { codigo: 'revisao', titulo: `Já é a Revisão #${pedido.numero ?? ''}${pedido.etapa ? ` — ${ETAPA_NOME[pedido.etapa] || pedido.etapa}` : ''}`, urgente,
      passos: [{ texto: pedido.etapa === 'conferencia_operador' ? 'Conferir os dados lidos e confirmar: o cálculo e o veredito saem em seguida.' : 'Continuar pela tela da revisão.', botao: 'ver_revisao' }],
      mensagem: null };
  }

  const p = diag ? (diag.placar || placar(diag, calc)) : null;
  const porValor = [...(diag?.achados || [])].sort((x, y) => (y.impacto?.valor || 0) - (x.impacto?.valor || 0));   // o que mais vale primeiro
  const aplic = [...new Set(porValor.filter(a => a.forca !== 'baixa' && PARA_CLIENTE[a.id] && !(a.id === 'honorarios_extra' && a.forca !== 'alta')).map(a => PARA_CLIENTE[a.id]))];
  const eco = Number(calc.economia_estimada) || 0;
  const vi = calc.valor_incontroverso;
  const fx2 = (v) => 'R$ ' + fx(v);

  if (nivel === 'incompleto' || !nivel) {
    return { codigo: 'documentos', titulo: 'Pedir documentos ao cliente', urgente,
      passos: [
        { texto: 'Mandar a mensagem abaixo (já explica o que trazer e o que não fazer no banco).', botao: 'mensagem' },
        { texto: 'Quando os documentos chegarem, juntar aqui: o veredito e o valor saem na hora.', botao: 'documentos' }
      ],
      mensagem: diag?.mensagem_cliente || 'Olá! Analisamos o seu contrato. Para concluir, precisamos do contrato completo e do extrato das parcelas. Pode mandar em PDF ou foto. Obrigado!' };
  }

  if (nivel === 'forte' || nivel === 'moderada') {
    const linhas = [`Olá! Analisamos o seu contrato com ${banco}.`];
    if (aplic.length) linhas.push(`Encontramos: ${aplic.slice(0, 3).join('; ')}.`);
    if (vi && vi.parcela_contratada > vi.parcela_mensal) linhas.push(`Pela nossa conta, a parcela de ${fx2(vi.parcela_contratada)} cairia para cerca de ${fx2(vi.parcela_mensal)}.`);
    if (eco > 0) linhas.push(`A economia estimada é de ${fx2(eco)} (estimativa; o resultado depende da negociação ou da Justiça).`);
    if (dados.situacao === 'busca_apreensao' || dados.situacao === 'executado') linhas.push('Como já há processo do banco contra você, o prazo para se defender é curto: precisamos conversar hoje.');
    linhas.push('O próximo passo é a revisão completa, com laudo e parecer do advogado. Posso te passar o valor e como funciona?');
    return { codigo: nivel === 'forte' ? 'vender' : 'oferecer', titulo: nivel === 'forte' ? 'Vender a revisão' : 'Oferecer a revisão (caso médio)', urgente,
      passos: [
        { texto: nivel === 'forte' ? 'Mandar a proposta abaixo ao cliente.' : 'Mandar a proposta abaixo — é um caso médio: não prometer mais do que o valor estimado.', botao: 'mensagem' },
        { texto: 'Cliente topou: abrir a revisão e cobrar (a tela da revisão gera o link de pagamento).', botao: 'abrir_revisao' }
      ],
      mensagem: linhas.join('\n') };
  }

  // fraca / inviável: não vender ação
  const naoVale = [`Olá! Analisamos o seu contrato com ${banco}.`,
    nivel === 'inviavel' ? (calc.veredito?.motivo || 'Com os dados do contrato, não há como sustentar uma revisão.') : 'Os juros e as cobranças estão dentro do que o mercado pratica, e uma ação de revisão não compensaria o custo.',
    'Se as parcelas estão pesando, dá para tentar uma renegociação direta ou levar a dívida para outro banco com juros menores (portabilidade). Se quiser, te orientamos nisso.'];
  return { codigo: 'nao_vender', titulo: 'Não vender revisão — dar o retorno ao cliente', urgente,
    passos: [{ texto: 'Mandar o retorno abaixo; se o cliente quiser, oferecer ajuda na renegociação.', botao: 'mensagem' }],
    mensagem: naoVale.join('\n') };
}

/**
 * Abusividades do banco + quanto dá para recuperar — o que o dono quer ver
 * primeiro. Cada linha: o que o banco fez, cláusula, força e o valor (do
 * cálculo) ou por que ainda não tem valor. Contrato de limite sem comprovante
 * ganha os parâmetros do simulador (o valor depende do saque).
 */
const SEM_VALOR = {
  taxa_em_faixa: 'Depende do valor e da taxa de cada saque — use o simulador',
  perda_redutor: 'Aparece no extrato, se a taxa subiu depois de um atraso',
  mora_sobre_juros: 'Só sobre as parcelas pagas em atraso',
  debito_rotativo: 'Juros de cheque especial cobrados no extrato',
  aval_limite_aumentado: 'Protege o patrimônio dos avalistas',
  tese_taxa_maior_declarada: 'Entra no recálculo da parcela',
  tese_cet_informado: 'Falta o valor que caiu na conta',
  tese_encargos_mora: 'Defesa: afasta a mora na busca e apreensão',
  tese_comissao_permanencia: 'Abate os encargos de atraso cobrados juntos',
  tese_superendividamento: 'Repactuação de todas as dívidas'
};
const SO_RISCO = new Set(['vencimento_cruzado']);
function abusividades(g = {}, calc = {}, dados = {}) {
  calc = calc || {};
  const linhas = (g.achados || []).filter(a => !SO_RISCO.has(a.id) && !(a.id === 'honorarios_extra' && a.forca !== 'alta')).map(a => ({
    id: a.id, forca: a.forca, titulo: a.titulo, porque: a.porque, clausula: a.clausula || null,
    valor: a.impacto?.valor > 0 ? a.impacto.valor : null, valor_grupo: a.impacto?.grupo || null,
    valor_nota: a.impacto?.valor > 0 ? (a.impacto.nota || null) : (SEM_VALOR[a.id] || null)
  }));
  const cp = calc.cenario_principal && calc.cenarios ? calc.cenarios[calc.cenario_principal] : null;
  const vi = calc.valor_incontroverso, ic = calc.indebito_corrigido;
  const recuperar = {
    total: Number(calc.economia_estimada) > 0 ? Number(calc.economia_estimada) : null,
    ja_pago_a_mais: ic && ic.nominal > 0 ? ic.corrigido : (cp && cp.total_pago_a_mais > 0 ? cp.total_pago_a_mais : null),
    parcela_hoje: vi ? vi.parcela_contratada : null, parcela_revisada: vi ? vi.parcela_mensal : null,
    otimista: calc.cenario_otimista && calc.economia_otimista > 0 ? calc.economia_otimista : null,
    falta: null, simulador: null
  };
  const op = dados.operacao || {};
  if (op.estrutura === 'limite_de_credito' && !recuperar.total) {
    const media = calc.limite?.media_bacen_am ?? null;
    if (media) recuperar.simulador = { media_am: media, taxa_minima_am: op.taxa_minima_mensal ?? null, taxa_maxima_am: op.taxa_maxima_mensal ?? null, limite: op.limite_credito ?? null };
    recuperar.falta = 'o comprovante de cada saque (valor, taxa e prazo)';
  } else if (!recuperar.total) {
    recuperar.falta = (g.placar && g.placar.falta) || null;
  }
  return { linhas, nao_e_abuso: (g.nao_e_abuso || []).map(x => x.titulo), recuperar };
}

module.exports = { montarDiagnostico, placar, acaoDaEquipe, abusividades, cdc, VERSAO_DIAGNOSTICO };
