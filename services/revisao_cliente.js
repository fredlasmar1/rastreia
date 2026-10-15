/**
 * RASTREIA — Revisão Bancária: RELATÓRIO PARA O CLIENTE (Recobro + Balladão).
 *
 * O diagnóstico estratégico (services/revisao_diagnostico.js) é USO INTERNO.
 * Daqui sai só o que o cliente precisa saber, em linguagem simples:
 * o que encontramos, o que está dentro das regras, quem garante a dívida,
 * o que fazer agora, o que precisamos e os próximos passos.
 * NUNCA entram: estratégia de negociação, "o que o banco vai alegar",
 * força dos argumentos, súmulas/precedentes. Função pura (testável).
 */
const fx = (v, c = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const brl = (v) => 'R$ ' + fx(v);

// Texto ao cliente por achado do diagnóstico (id → título e explicação)
function textoAchado(a, d, tx, teses) {
  const op = d.operacao || {};
  const media = tx && tx.ok ? Number(tx.valor_am) : null;
  switch (a.id) {
    case 'taxa_em_faixa':
      return { titulo: 'O contrato não diz quanto de juros seria cobrado em cada empréstimo',
        texto: `O contrato só traz uma faixa de juros${op.taxa_minima_mensal != null ? ` (de ${fx(op.taxa_minima_mensal)}%${op.taxa_maxima_mensal != null ? ` a ${fx(op.taxa_maxima_mensal)}%` : ''} ao mês)` : ''}, e a taxa de cada empréstimo foi definida pelo banco na hora. Quando o banco não comprova a taxa combinada, a Justiça costuma aplicar a média do mercado${media ? `, que na época era de ${fx(media)}% ao mês` : ''}.` };
    case 'juros_acima_media':
      return { titulo: 'Os juros estão acima do que o mercado cobrava', texto: `${a.porque} A comparação usa a taxa média divulgada pelo Banco Central.` };
    case 'perda_redutor':
      return { titulo: 'Um atraso pode aumentar os seus juros de forma definitiva', texto: 'O contrato prevê que, se uma parcela atrasar ou se o débito automático for cancelado, o desconto na taxa de juros é retirado sem aviso e não volta mais.' };
    case 'debito_rotativo':
      return { titulo: 'As parcelas podem estar sendo pagas com o cheque especial', texto: 'Quando falta saldo na conta, o banco está autorizado a usar o limite do cheque especial para pagar a parcela. O cheque especial tem juros bem mais altos, e esse custo só aparece no extrato.' };
    case 'mora_sobre_juros':
      return { titulo: 'Em caso de atraso, a dívida cresce muito rápido', texto: 'No atraso, o contrato soma juros sobre juros, multa e outros encargos.' };
    case 'honorarios_extra':
      return { titulo: 'Honorários cobrados antes de qualquer processo', texto: `O banco pode acrescentar ${a.titulo.match(/\d+%/)?.[0] || 'um percentual'} de honorários de advogado à dívida sem que exista ação na Justiça.` };
    case 'vencimento_cruzado':
      return { titulo: 'Um problema pontual pode antecipar toda a dívida', texto: 'O contrato permite ao banco cobrar tudo de uma vez em situações como atraso em outra operação, débito fiscal ou problema na conta de um avalista.' };
    case 'aval_limite_aumentado':
      return null;   // estratégia: fica no diagnóstico interno
    default:
      if (a.id && a.id.startsWith('tese_')) {
        const t = (teses || []).find(x => 'tese_' + x.id === a.id);
        return { titulo: a.titulo, texto: t && t.explicacao_cliente ? t.explicacao_cliente : a.porque };
      }
      return null;
  }
}

function montarRelatorioCliente({ registro = {}, pedido = {}, contato = null } = {}) {
  const d = registro.dados_conferidos || {};
  const g = registro.diagnostico;
  if (!g) return null;
  const calc = registro.calculo || {};
  const tx = registro.taxa_media_bacen || {};
  const teses = (registro.teses && registro.teses.teses) || [];
  const op = d.operacao || {};
  const cl = d.clausulas || {};
  const limite = g.estrutura && g.estrutura.limite;

  const encontrados = g.achados.filter(a => a.forca !== 'baixa' || ['debito_rotativo', 'vencimento_cruzado'].includes(a.id))
    .map(a => textoAchado(a, d, tx, teses)).filter(Boolean);

  const dentroDasRegras = [];
  if (op.capitalizacao_expressa === true) dentroDasRegras.push('A cobrança de juros mês a mês está prevista no contrato e é permitida.');
  const razaoBaixa = (g.nao_e_abuso || []).find(x => /média/.test(x.porque) && /×/.test(x.titulo));
  if (razaoBaixa) dentroDasRegras.push('O tamanho da taxa de juros, sozinho, não está muito acima da média do mercado.');

  const garantias = [];
  if (cl.avalistas_quantidade || (d.garantia || {}).tipo === 'aval') garantias.push(`${cl.avalistas_quantidade ? cl.avalistas_quantidade + ' avalista(s) garantem' : 'Os avalistas garantem'} a dívida com os bens pessoais${cl.aval_com_anuencia_conjuge ? ' (com a concordância do cônjuge, os bens do casal também)' : ''}, e o banco pode cobrá-los diretamente.`);
  if (cl.garantia_dividas_futuras && cl.garantia_dividas_futuras.presente) garantias.push(`A garantia vale também para novos empréstimos desse limite${cl.vigencia_dias ? `, por cerca de ${Math.round(cl.vigencia_dias / 365)} anos` : ''}.`);
  if (cl.fundo_garantidor && cl.fundo_garantidor.tipo) garantias.push(`Alguns empréstimos podem ter garantia de um fundo (${cl.fundo_garantidor.tipo}); mesmo assim, a dívida continua sendo cobrada da empresa.`);

  // Números: só o que o cálculo sustenta
  const cp = calc.cenario_principal && calc.cenarios ? calc.cenarios[calc.cenario_principal] : null;
  let numeros;
  if (cp && Number(calc.economia_estimada) > 0) {
    numeros = [`Parcela atual: ${brl(cp.parcela_contratada)} — parcela recalculada: ${brl(cp.parcela_revisada)}.`, `Valor pago a mais até agora: ${brl(cp.total_pago_a_mais)}.`, `Economia estimada: ${brl(calc.economia_estimada)}.`];
  } else {
    numeros = [limite ? 'Os valores só podem ser calculados com os comprovantes de cada empréstimo tirado do limite, porque é neles que está a taxa realmente cobrada.' : 'Os valores serão calculados assim que recebermos os documentos que faltam.'];
  }

  const agora = ['Continue pagando as parcelas em dia enquanto analisamos: o atraso aumenta a dívida e pode antecipar a cobrança.'];
  if ((cl.debito_em_limite_rotativo && cl.debito_em_limite_rotativo.autorizado) || (cl.taxa_reduzida_condicionada && cl.taxa_reduzida_condicionada.presente)) agora.push('Não cancele nenhum débito automático no banco sem falar conosco antes: dependendo de como for feito, a taxa de juros pode subir.');
  agora.push('Não assine renegociação, aditivo ou acordo com o banco sem nos mostrar antes.');

  const resumo = [];
  resumo.push(`Analisamos ${limite ? 'o contrato de limite de crédito' : 'o contrato'} ${d.instituicao?.nome ? `com ${d.instituicao.nome}` : ''}${op.data_contratacao ? `, assinado em ${op.data_contratacao.split('-').reverse().join('/')}` : ''}.`.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' '));
  resumo.push(encontrados.length ? `Encontramos ${encontrados.length} ponto(s) que merecem atenção e podem ser usados a seu favor.` : 'Até aqui não encontramos pontos fortes para questionar.');
  if (limite && !(cp && Number(calc.economia_estimada) > 0)) resumo.push('Para dizer quanto você pode economizar, precisamos dos comprovantes de cada empréstimo.');

  return {
    titulo: 'Análise do seu contrato bancário',
    preliminar: registro.etapa !== 'aprovado',
    cliente: pedido.cliente_nome || d.contratante?.nome || pedido.alvo_nome || '',
    contratante: d.contratante?.nome || pedido.alvo_nome || '',
    banco: d.instituicao?.nome || '',
    contrato: op.numero_contrato || '',
    protocolo: pedido.numero || '',
    resumo, encontrados, dentro_das_regras: dentroDasRegras, garantias, numeros,
    o_que_fazer_agora: agora,
    precisamos: (g.documentos || []).map(x => `${x.doc} — ${x.onde}.`),
    proximos_passos: [
      'Você nos envia os documentos da lista acima.',
      'Recalculamos o contrato e comparamos com a média do mercado divulgada pelo Banco Central.',
      'O advogado do Balladão apresenta o melhor caminho para o seu caso: negociação com o banco ou ação na Justiça.',
      'Você decide, com todas as informações na mão.'
    ],
    contato,
    ressalvas: ['Análise baseada nos documentos enviados até agora; novos documentos podem mudar as conclusões.', 'Não é garantia de resultado: cada caso depende do banco e, se for à Justiça, da decisão do juiz.']
  };
}

module.exports = { montarRelatorioCliente, textoAchado };
