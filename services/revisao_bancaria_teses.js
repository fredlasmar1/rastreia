/**
 * RASTREIA — Checklist de teses da Revisão de Contrato Bancário.
 *
 * Arquivo de REGRAS, versionado e revisável pelo Balladão Advogados.
 * ⚠️ O advogado revisor deve validar os fundamentos antes do go-live.
 *
 * Cada tese: { id, nome, fundamento, regra(d, calc) → { resultado, detalhe,
 *   trecho_contrato, itens } }, com resultado 'aplicavel' | 'nao_aplicavel' |
 *   'verificar', e explicacao_cliente (linguagem simples).
 * `d` = dados_conferidos; `calc` = saída do motor (pode ser null na 1ª passada,
 * usada só para descobrir os itens questionáveis do cenário B).
 */
// Citações conferidas em 13/10/2026 contra o catálogo oficial de súmulas do STJ e
// os precedentes qualificados do Portal de Dados Abertos do STJ (espelhados em
// github.com/emidio-trancoso/advocacia-aberta, MIT): Súmulas 297, 382, 472, 539,
// 541, 565, 566 e Temas 27, 28, 246/247, 618, 619, 620, 958 e 972.
const VERSAO_TESES = 'rb-teses-1.4.0 (2026-10-22)';
const tetos = require('./revisao_tetos');

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(2).replace('.', ',')}%`);
const reTAC = /\b(tac|abertura de cr[eé]dito|tec|emiss[aã]o de (carn[eê]|boleto|ficha)|tarifa de emiss)/i;
const reCadastro = /cadastro/i;
const reAvaliacao = /avalia[cç][aã]o|vistoria|registro( do)? contrato|grava(me|ção)|detran/i;
const reTerceiros = /servi[cç]os? de terceiros|terceiro|correspondente|comiss[aã]o do lojista|despachante/i;

function itensDaLista(lista, filtro) {
  return (lista || []).map((it, i) => ({ it, i })).filter(({ it }) => filtro(it));
}

const TESES = [
  {
    id: 'juros_abusivos',
    nome: 'Juros remuneratórios abusivos',
    fundamento: 'STJ, Tema 27 (REsp 1.061.530/RS, repetitivo): revisão dos juros remuneratórios admitida quando a abusividade fica cabalmente demonstrada — parâmetro usual: taxa substancialmente acima da média de mercado do BACEN para a operação e o mês; Súmula 382 STJ: juros acima de 12% a.a., por si só, não indicam abusividade.',
    explicacao_cliente: 'Comparamos a taxa do seu contrato com a taxa média que os bancos cobravam no mesmo mês para o mesmo tipo de operação.',
    regra(d, calc) {
      if (calc?.teto?.regulada) return { resultado: 'verificar', detalhe: 'Linha com taxa fixada por lei ou pelo CMN: a média de mercado não serve de parâmetro. Veja a tese do teto legal.' };
      if (!calc || calc.razao == null) {
        // Diz o que faltou de verdade: a taxa do CONTRATO ou a média do BACEN
        if (calc && calc.taxa?.efetiva_am == null) {
          const lim = calc.limite;
          if (lim) return { resultado: lim.razao_piso >= 1.5 ? 'aplicavel' : 'verificar', detalhe: `Contrato de limite sem a taxa de cada saque. O piso da faixa (${pct(lim.taxa_minima_am / 100)} a.m.) é ${lim.razao_piso.toFixed(2).replace('.', ',')}× a média BACEN (${pct(lim.media_bacen_am / 100)} a.m.): confirmar com o demonstrativo de cada operação.` };
          return { resultado: 'verificar', detalhe: 'A taxa do contrato não foi encontrada (falta taxa, parcela ou prazo): não dá para comparar com a média do BACEN ainda.' };
        }
        return { resultado: 'verificar', detalhe: 'Sem taxa média do BACEN para comparar.' };
      }
      const r = calc.razao;
      const detalhe = `Taxa efetiva ${pct(calc.taxa.efetiva_am)} a.m. × média BACEN ${pct(calc.bacen.am)} a.m. (${r.toFixed(2).replace('.', ',')}× a média).`;
      const trecho = d.operacao?.taxa_juros_mensal_declarada != null ? `Taxa declarada: ${d.operacao.taxa_juros_mensal_declarada}% a.m.` : null;
      if (r >= 1.5) return { resultado: 'aplicavel', detalhe, trecho_contrato: trecho };
      if (r >= 1.2) return { resultado: 'verificar', detalhe: detalhe + ' Acima da média, mas abaixo de 1,5×: depende do caso.', trecho_contrato: trecho };
      return { resultado: 'nao_aplicavel', detalhe };
    }
  },
  {
    id: 'teto_legal',
    nome: 'Juros acima do teto legal',
    fundamento: `${tetos.FUND_CHEQUE} ${tetos.FUND_CARTAO} ${tetos.FUND_PRONAMPE}`,
    explicacao_cliente: 'Algumas linhas de crédito têm um limite de juros fixado em lei. Conferimos se o seu contrato passou desse limite.',
    regra(d, calc) {
      const t = calc?.teto;
      if (!t) return { resultado: 'nao_aplicavel', detalhe: 'Linha sem teto legal de juros: o parâmetro é a média de mercado.' };
      const r = t.excedido === true ? 'aplicavel' : t.excedido === false ? 'nao_aplicavel' : 'verificar';
      return { resultado: r, detalhe: t.detalhe, fundamento: t.fundamento };
    }
  },
  {
    id: 'capitalizacao',
    nome: 'Capitalização de juros',
    fundamento: 'Súmula 539 STJ e Tema 246: capitalização em periodicidade inferior à anual é permitida nos contratos a partir de 31/03/2000, se expressamente pactuada; Súmula 541 STJ e Tema 247: taxa anual superior ao duodécuplo da mensal basta para permitir a cobrança da taxa efetiva anual.',
    explicacao_cliente: 'Verificamos se o contrato autoriza "juros sobre juros". Se não autorizar de forma clara, a cobrança pode ser questionada.',
    regra(d, calc) {
      const trecho = d.operacao?.clausula_capitalizacao_trecho || null;
      if (d.operacao?.capitalizacao_expressa === true) return { resultado: 'nao_aplicavel', detalhe: 'Capitalização expressamente pactuada.', trecho_contrato: trecho };
      if (calc?.taxa?.capitalizacao_por_duodecuplo === true) return { resultado: 'nao_aplicavel', detalhe: 'Taxa anual maior que 12× a mensal: pactuação caracterizada (Súmula 541).' };
      return { resultado: 'verificar', detalhe: 'Não há cláusula expressa nem duodécuplo identificados: conferir o contrato completo.', trecho_contrato: trecho };
    }
  },
  {
    id: 'tac_tec',
    nome: 'TAC e TEC',
    fundamento: 'STJ, Temas 618 e 619 (repetitivos) e Súmula 565: TAC e TEC (ou outro nome para o mesmo fato gerador) válidas só em contratos anteriores a 30/04/2008 (Res. CMN 3.518/2007); Tema 620 e Súmula 566: a tarifa de cadastro só pode ser cobrada no início do relacionamento.',
    explicacao_cliente: 'Tarifas de abertura de crédito e de emissão de carnê/boleto não podem ser cobradas em contratos feitos depois de abril de 2008.',
    regra(d) {
      const data = d.operacao?.data_contratacao || '';
      const pos2008 = data > '2008-04-30';
      const tac = itensDaLista(d.tarifas, it => reTAC.test(it.nome || ''));
      const cad = itensDaLista(d.tarifas, it => reCadastro.test(it.nome || ''));
      if (tac.length && pos2008) return { resultado: 'aplicavel', detalhe: `Cobrada após 30/04/2008: ${tac.map(x => x.it.nome).join(', ')}.`, trecho_contrato: tac.map(x => x.it.trecho).filter(Boolean).join(' | ') || null, itens: tac.map(x => ({ origem: 'tarifa', indice: x.i })) };
      if (cad.length) return { resultado: 'verificar', detalhe: 'Tarifa de cadastro: válida se for o início do relacionamento com o banco.', trecho_contrato: cad.map(x => x.it.trecho).filter(Boolean).join(' | ') || null };
      if (!data && tac.length) return { resultado: 'verificar', detalhe: 'Há TAC/TEC, mas falta a data da contratação.' };
      return { resultado: 'nao_aplicavel', detalhe: 'Não há TAC/TEC cobrada.' };
    }
  },
  {
    id: 'avaliacao_registro_terceiros',
    nome: 'Avaliação do bem, registro e serviços de terceiros',
    fundamento: 'STJ, Tema 958 (repetitivo): é abusivo cobrar serviços de terceiros sem especificar o serviço e, a partir de 25/02/2011 (Res. CMN 3.954/2011), a comissão do correspondente bancário; avaliação do bem e registro do contrato valem se o serviço foi efetivamente prestado e sem onerosidade excessiva. Tema 972: abusivo o ressarcimento do registro do pré-gravame a partir de 25/02/2011.',
    explicacao_cliente: 'Cobranças de "serviços de terceiros" sem dizer qual serviço foi prestado não são permitidas; avaliação e registro só valem se o serviço realmente aconteceu.',
    regra(d) {
      const terc = itensDaLista(d.tarifas, it => reTerceiros.test(it.nome || ''));
      const aval = itensDaLista(d.tarifas, it => reAvaliacao.test(it.nome || ''));
      if (terc.length) return { resultado: 'aplicavel', detalhe: `Serviços de terceiros: ${terc.map(x => x.it.nome).join(', ')}.`, trecho_contrato: terc.map(x => x.it.trecho).filter(Boolean).join(' | ') || null, itens: terc.map(x => ({ origem: 'tarifa', indice: x.i })) };
      if (aval.length) return { resultado: 'verificar', detalhe: `Conferir se o serviço foi prestado: ${aval.map(x => x.it.nome).join(', ')}.`, trecho_contrato: aval.map(x => x.it.trecho).filter(Boolean).join(' | ') || null };
      return { resultado: 'nao_aplicavel', detalhe: 'Não há essas tarifas.' };
    }
  },
  {
    id: 'seguro_venda_casada',
    nome: 'Seguro prestamista / proteção financeira',
    fundamento: 'STJ, Tema 972 (repetitivo): nos contratos bancários em geral, o consumidor não pode ser compelido a contratar seguro com a instituição financeira ou com seguradora por ela indicada (venda casada).',
    explicacao_cliente: 'Se o seguro veio embutido sem você poder recusar ou escolher a seguradora, é venda casada e pode ser devolvido.',
    regra(d) {
      const imp = itensDaLista(d.seguros, it => it.havia_opcao_recusar === false);
      const duv = itensDaLista(d.seguros, it => it.havia_opcao_recusar == null);
      if (imp.length) return { resultado: 'aplicavel', detalhe: `Seguro sem opção de recusa: ${imp.map(x => x.it.tipo || 'seguro').join(', ')}.`, trecho_contrato: imp.map(x => x.it.trecho).filter(Boolean).join(' | ') || null, itens: imp.map(x => ({ origem: 'seguro', indice: x.i })) };
      if (duv.length) return { resultado: 'verificar', detalhe: 'Contrato não mostra se havia opção de recusar ou escolher a seguradora.', trecho_contrato: duv.map(x => x.it.trecho).filter(Boolean).join(' | ') || null };
      return { resultado: 'nao_aplicavel', detalhe: (d.seguros || []).length ? 'Seguro com opção de recusa.' : 'Não há seguro.' };
    }
  },
  {
    id: 'comissao_permanencia',
    nome: 'Comissão de permanência cumulada',
    fundamento: 'Súmula 472 STJ: a cobrança de comissão de permanência — limitada à soma dos encargos remuneratórios e moratórios do contrato — exclui a exigibilidade dos juros remuneratórios, moratórios e da multa.',
    explicacao_cliente: 'Em atraso, o banco não pode cobrar comissão de permanência junto com juros e multa.',
    regra(d) {
      const e = d.encargos_mora || {};
      if (!e.comissao_permanencia) return { resultado: 'nao_aplicavel', detalhe: 'Não há comissão de permanência.' };
      if (e.comissao_permanencia_cumulada === true || e.juros_mora != null || e.multa_percentual != null) return { resultado: 'aplicavel', detalhe: 'Comissão de permanência prevista junto com outros encargos de mora.', trecho_contrato: e.trecho || null };
      return { resultado: 'verificar', detalhe: 'Comissão de permanência prevista; conferir se é cumulada.', trecho_contrato: e.trecho || null };
    }
  },
  {
    id: 'encargos_mora',
    nome: 'Encargos de mora e descaracterização da mora',
    fundamento: 'CDC art. 52, §1º: multa de mora limitada a 2% em relação de consumo; STJ, Tema 28 (repetitivo): abusividade nos encargos do período de normalidade descaracteriza a mora — relevante na defesa em busca e apreensão.',
    explicacao_cliente: 'A multa por atraso não pode passar de 2%. Se os juros normais forem abusivos, o atraso pode ser descaracterizado, o que ajuda a defender o bem em busca e apreensão.',
    regra(d, calc, previas = {}) {
      const e = d.encargos_mora || {};
      const multaAlta = e.multa_percentual != null && Number(e.multa_percentual) > 2;
      const jurosAbusivos = previas.juros_abusivos === 'aplicavel';
      const emCobranca = ['atrasado', 'busca_apreensao', 'executado'].includes(d.situacao);
      if (multaAlta) return { resultado: 'aplicavel', detalhe: `Multa de ${e.multa_percentual}% (acima de 2%).`, trecho_contrato: e.trecho || null };
      if (jurosAbusivos && emCobranca) return { resultado: 'aplicavel', detalhe: 'Juros do período de normalidade abusivos com contrato em cobrança: tese de descaracterização da mora (Tema 28).' };
      if (jurosAbusivos) return { resultado: 'verificar', detalhe: 'Juros abusivos podem descaracterizar a mora se houver cobrança.' };
      return { resultado: 'nao_aplicavel', detalhe: 'Encargos de mora dentro do limite.' };
    }
  },
  {
    id: 'taxa_maior_declarada',
    nome: 'Taxa efetiva maior que a declarada',
    fundamento: 'CDC arts. 6º, III, e 52: dever de informação clara sobre a taxa efetiva e o custo total; divergência entre a taxa implícita das parcelas e a taxa/CET informados.',
    explicacao_cliente: 'Recalculamos a taxa a partir das parcelas. Se ela sai maior do que a escrita no contrato, o banco não informou corretamente o custo.',
    regra(d, calc) {
      if (!calc?.taxa || calc.taxa.implicita_am == null || calc.taxa.declarada_am == null) return { resultado: 'verificar', detalhe: 'Sem taxa declarada ou parcela para comparar.' };
      if (calc.taxa.taxa_efetiva_maior_que_declarada) return { resultado: 'aplicavel', detalhe: `Taxa implícita ${pct(calc.taxa.implicita_am)} a.m. × declarada ${pct(calc.taxa.declarada_am)} a.m. (+${calc.taxa.diferenca_pp_am.toFixed(4).replace('.', ',')} p.p.).` };
      return { resultado: 'nao_aplicavel', detalhe: 'Taxa implícita compatível com a declarada.' };
    }
  },
  {
    id: 'cet_informado',
    nome: 'Custo Efetivo Total (CET) informado errado',
    fundamento: 'Res. CMN 4.881/2020, arts. 3º e 7º (contratos desde 01/02/2021; antes, Res. CMN 3.517/2007): o CET deve ser informado antes da contratação, com todos os encargos e despesas; CDC arts. 6º, III, 46 e 52: informação clara e prévia sobre o custo total.',
    explicacao_cliente: 'Calculamos o custo total real comparando o dinheiro que você recebeu com as parcelas que paga. Se ele sai maior que o CET escrito no contrato, o banco informou um custo menor do que o verdadeiro.',
    regra(d, calc) {
      const c = calc?.cet;
      if (!c || c.real_am == null) return { resultado: 'verificar', detalhe: 'Sem o valor liberado ao cliente: não dá para calcular o CET real.' };
      const real = `CET real ${pct(c.real_am)} a.m. (${pct(c.real_aa)} a.a.), considerando ${c.pagos_a_parte > 0 ? 'o valor liberado menos o que foi pago à parte' : 'o valor liberado'}`;
      if (c.declarado_am == null) return { resultado: 'verificar', detalhe: `${real}. O CET não foi localizado no contrato — se de fato não consta, a falta de informação já é irregular (${normaCET(d)}).` };
      if (c.real_maior_que_declarado) return { resultado: 'aplicavel', detalhe: `${real} × CET informado ${pct(c.declarado_am)} a.m. (+${c.diferenca_pp_am.toFixed(4).replace('.', ',')} p.p.).`, trecho_contrato: `CET informado: ${(c.declarado_am * 100).toFixed(2).replace('.', ',')}% a.m.` };
      return { resultado: 'nao_aplicavel', detalhe: `${real}, compatível com o CET informado (${pct(c.declarado_am)} a.m.).` };
    }
  },
  {
    id: 'honorarios_ccb',
    nome: 'Honorários extrajudiciais acima de 10%',
    fundamento: 'Lei 10.931/2004, art. 28, § 1º, IV: na Cédula de Crédito Bancário, os honorários advocatícios extrajudiciais não podem superar 10% do valor total devido.',
    explicacao_cliente: 'Se o contrato manda pagar honorários de advogado na cobrança sem processo, eles não podem passar de 10% da dívida.',
    regra(d) {
      const h = Number(d.clausulas?.honorarios_extrajudiciais_percentual);
      if (!(h > 0)) return { resultado: 'nao_aplicavel', detalhe: 'O contrato não fixa honorários extrajudiciais.' };
      const ccb = d.tipo_operacao === 'ccb_capital_giro' || /c[eé]dula de cr[eé]dito banc|\bccb\b/i.test(d.operacao?.tipo || '');
      const v = String(h).replace('.', ',');
      if (h > 10) return { resultado: ccb ? 'aplicavel' : 'verificar', detalhe: `Honorários extrajudiciais de ${v}%, acima de 10%${ccb ? '' : ' — o limite é da CCB: conferir se o título é uma Cédula de Crédito Bancário'}.` };
      return { resultado: 'nao_aplicavel', detalhe: `Honorários extrajudiciais de ${v}%, dentro do limite de 10%.` };
    }
  },
  {
    id: 'superendividamento',
    nome: 'Superendividamento (repactuação)',
    fundamento: 'Lei 14.181/2021 (CDC arts. 54-A e 104-A): repactuação quando as dívidas comprometem o mínimo existencial.',
    explicacao_cliente: 'Se as parcelas estão pesando demais na sua renda, a lei permite renegociar todas as dívidas em conjunto.',
    regra(d) {
      if (['atrasado', 'busca_apreensao', 'executado'].includes(d.situacao)) return { resultado: 'verificar', detalhe: 'Contrato em atraso: avaliar a renda e as demais dívidas para eventual repactuação.' };
      return { resultado: 'nao_aplicavel', detalhe: 'Sem sinais de superendividamento nos dados do contrato.' };
    }
  },
  {
    id: 'repeticao_dobro',
    nome: 'Repetição do indébito (simples ou em dobro)',
    fundamento: 'CDC art. 42, parágrafo único: devolução em dobro do que foi cobrado indevidamente; entendimento atual do STJ e modulação temporal a cargo do advogado.',
    explicacao_cliente: 'O que foi pago a mais pode ser devolvido; em alguns casos, em dobro. O advogado avalia qual se aplica.',
    regra(d, calc) {
      const c = calc?.cenario_principal ? calc.cenarios[calc.cenario_principal] : null;
      if (c && c.total_pago_a_mais > 0) return { resultado: 'verificar', detalhe: 'Há valor pago a mais: referência de repetição simples e em dobro no laudo.' };
      return { resultado: 'nao_aplicavel', detalhe: 'Sem valor pago a mais apurado.' };
    }
  }
];

// CET: a Res. 4.881/2020 revogou a 3.517/2007 a partir de 01/02/2021
function normaCET(d) {
  const data = String(d?.operacao?.data_contratacao || '');
  return data && data < '2021-02-01' ? 'Res. CMN 3.517/2007' : 'Res. CMN 4.881/2020';
}

const FUNDAMENTO_GERAL = 'Súmula 297 STJ: o CDC se aplica às instituições financeiras.';

// Itens (tarifas/seguros) que as teses marcam como questionáveis → cenário B do cálculo
function itensQuestionaveis(dados) {
  const out = [];
  for (const t of TESES) {
    if (!['tac_tec', 'avaliacao_registro_terceiros', 'seguro_venda_casada'].includes(t.id)) continue;
    const r = t.regra(dados, null);
    if (r.resultado === 'aplicavel' && Array.isArray(r.itens)) out.push(...r.itens);
  }
  return out;
}

// Aplica todas as teses (depois do cálculo)
function aplicarTeses(dados, calc) {
  const previas = {};
  const lista = TESES.map(t => {
    const r = t.regra(dados, calc, previas) || {};
    previas[t.id] = r.resultado;
    return { id: t.id, nome: t.nome, fundamento: r.fundamento || t.fundamento, explicacao_cliente: t.explicacao_cliente, resultado: r.resultado || 'verificar', detalhe: r.detalhe || '', trecho_contrato: r.trecho_contrato || null };
  });
  // Roteiro do TIPO de contrato (services/revisao_roteiros.js): pontos específicos do produto
  // e os que dependem de extrato/fatura, já com o valor calculado
  const rot = require('./revisao_roteiros').aplicarRoteiro(dados, calc);
  lista.push(...rot.itens);
  return { versao: VERSAO_TESES, versao_roteiros: rot.versao, roteiro: rot.roteiro, fundamento_geral: FUNDAMENTO_GERAL, teses: lista, aplicaveis: lista.filter(t => t.resultado === 'aplicavel').length };
}

module.exports = { VERSAO_TESES, TESES, FUNDAMENTO_GERAL, itensQuestionaveis, aplicarTeses };
