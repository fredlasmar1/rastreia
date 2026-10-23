/**
 * RASTREIA — Roteiros de abusividade por TIPO de contrato (Revisão Bancária).
 *
 * Vindos da skill parecer-credito-bancario do escritório (Z - CLAUDE/Skills v5,
 * roteiros por tipo), só com as verificações que os dados lidos sustentam.
 * Complementam as 12 teses gerais (revisao_bancaria_teses.js): aqui ficam os
 * pontos ESPECÍFICOS de cada produto e os que precisam de extrato/fatura.
 *
 * Regra de ouro mantida: a IA LÊ (lancamentos, faturas_cartao, consignado_info,
 * notificacao_mora); o VALOR sai daqui, por conta simples e explícita.
 *
 * Cada verificação devolve:
 *   { id, nome, explicacao_cliente, fundamento, resultado, detalhe, valor, valor_base,
 *     documento, forca }
 *   resultado: 'aplicavel' (abuso) | 'verificar' (falta documento/dado) | 'nao_aplicavel'
 * As 'aplicavel'/'verificar' entram na lista de teses — e dali na tela, no
 * diagnóstico, no laudo e nas minutas.
 *
 * Citações conferidas: Súmula 379 e Súmula 72 (arquivocidadao.stj.jus.br,
 * 23/10/2026); Temas 618/619 e 972 (lista do teste 12); Res. CMN 4.765, 4.549 e
 * 3.919 e Lei 10.820 no acervo normativos-bcb / Planalto.
 */
const VERSAO_ROTEIROS = 'rb-roteiros-1.0.0 (2026-10-23)';

const soma = (xs) => xs.reduce((s, x) => s + (Number(x) || 0), 0);
const brl = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pc = (v) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const cat = (d, ...cs) => (d.lancamentos || []).filter(l => cs.includes(l.categoria) && Number(l.valor) > 0);
const desc = (d, re, ...cs) => (d.lancamentos || []).filter(l => (!cs.length || cs.includes(l.categoria)) && re.test(String(l.descricao || '')) && Number(l.valor) > 0);
const ehPF = (d) => (d.pfpj || 'PF') !== 'PJ' || d.mei === true;
const naoSeAplica = { resultado: 'nao_aplicavel' };

// tipo_operacao → roteiro
function roteiroDo(d = {}) {
  const t = d.tipo_operacao;
  if (t === 'cheque_especial' || t === 'conta_garantida') return 'cheque_especial';
  if (t === 'cartao_credito') return 'cartao';
  if (t === 'consignado') return 'consignado';
  if (t === 'emprestimo_pessoal' || t === 'renegociacao') return 'pessoal';
  if (t === 'financiamento_veiculo' || t === 'arrendamento_mercantil' || t === 'financiamento_bens') return 'veiculo';
  if (t === 'ccb_capital_giro' || t === 'desconto_recebiveis' || t === 'antecipacao_cartao') return 'ccb';
  return 'geral';
}

// ── Verificações que valem para qualquer contrato (precisam do extrato) ──
const COMUNS = [
  {
    id: 'mora_acima_1',
    nome: 'Juros de mora acima de 1% ao mês',
    explicacao_cliente: 'Nos atrasos, o banco só pode cobrar juros de mora de até 1% ao mês.',
    fundamento: 'Súmula 379 STJ: nos contratos bancários não regidos por legislação específica, os juros moratórios podem ser convencionados até o limite de 1% ao mês.',
    forca: 'alta',
    regra(d) {
      const j = Number(d.encargos_mora?.juros_mora);
      if (!(j > 1) || d.programa === 'rural') return naoSeAplica;
      const cobrados = cat(d, 'juros_mora');
      const total = soma(cobrados.map(l => l.valor));
      if (!cobrados.length) return { resultado: 'aplicavel', detalhe: `O contrato prevê juros de mora de ${pc(j)} a.m. O valor cobrado a mais aparece no extrato das parcelas pagas em atraso.`, valor: null, documento: 'Extrato com as parcelas pagas em atraso' };
      const excesso = total * (1 - 1 / j);
      return { resultado: 'aplicavel', detalhe: `Juros de mora de ${pc(j)} a.m.; o extrato mostra ${brl(total)} cobrados a esse título.`, valor: excesso, valor_base: `${brl(total)} × (1 − 1/${String(j).replace('.', ',')}) = parte acima de 1% a.m.` };
    }
  },
  {
    id: 'multa_acima_2_extrato',
    nome: 'Multa por atraso acima de 2%',
    explicacao_cliente: 'Em contrato com pessoa física, a multa por atraso não pode passar de 2%.',
    fundamento: 'CDC, art. 52, § 1º: a multa de mora não pode ser superior a 2% do valor da prestação.',
    forca: 'alta',
    regra(d) {
      const m = Number(d.encargos_mora?.multa_percentual);
      if (!(m > 2) || !ehPF(d)) return naoSeAplica;
      const multas = cat(d, 'multa');
      if (!multas.length) return naoSeAplica;   // sem extrato, a tese geral de encargos já aponta
      const total = soma(multas.map(l => l.valor));
      return { resultado: 'aplicavel', detalhe: `Multa de ${pc(m)}; o extrato mostra ${brl(total)} em multas.`, valor: total * (1 - 2 / m), valor_base: `${brl(total)} × (1 − 2/${String(m).replace('.', ',')}) = parte acima de 2%` };
    }
  },
  {
    id: 'tac_tec_extrato',
    nome: 'Tarifa de abertura de crédito cobrada no extrato',
    explicacao_cliente: 'Tarifa de abertura de crédito ou de emissão de carnê não pode ser cobrada em contratos feitos depois de abril de 2008.',
    fundamento: 'STJ, Temas 618 e 619 (repetitivos): TAC e TEC só em contratos anteriores a 30/04/2008.',
    forca: 'alta',
    regra(d) {
      const data = String(d.operacao?.data_contratacao || '');
      if (!data || data <= '2008-04-30') return naoSeAplica;
      const t = desc(d, /\btac\b|abertura de cr[eé]dito|\btec\b|emiss[aã]o de (carn[eê]|boleto)/i, 'tarifa');
      if (!t.length) return naoSeAplica;
      const total = soma(t.map(l => l.valor));
      return { resultado: 'aplicavel', detalhe: `${t.length} cobrança(s) no extrato: ${brl(total)}.`, valor: total, valor_base: 'soma das tarifas cobradas no extrato' };
    }
  }
];

const ROTEIROS = {
  cheque_especial: [
    {
      id: 'cheque_juros_acima_8_extrato',
      nome: 'Juros do cheque especial acima de 8% ao mês',
      explicacao_cliente: 'Desde janeiro de 2020, o cheque especial de pessoa física e MEI não pode cobrar mais de 8% ao mês.',
      fundamento: 'Res. CMN 4.765/2019, art. 3º: juros do cheque especial de pessoa natural e MEI limitados a 8% ao mês (desde 06/01/2020).',
      forca: 'alta',
      regra(d) {
        if (!ehPF(d)) return naoSeAplica;
        const j = cat(d, 'juros_cheque_especial').filter(l => !l.data || String(l.data) >= '2020-01-06');
        if (!j.length) return { resultado: 'verificar', detalhe: 'Para medir o que passou de 8% a.m., é preciso o extrato com os juros de cada mês.', valor: null, documento: 'Extrato da conta com os juros do cheque especial de cada mês' };
        const acima = j.filter(l => Number(l.taxa_am) > 8);
        if (!acima.length) {
          const semTaxa = j.filter(l => l.taxa_am == null).length;
          return semTaxa ? { resultado: 'verificar', detalhe: `${semTaxa} lançamento(s) de juros sem a taxa do mês no extrato.`, valor: null, documento: 'Extrato que mostre a taxa do cheque especial de cada mês' } : naoSeAplica;
        }
        const excesso = soma(acima.map(l => Number(l.valor) * (1 - 8 / Number(l.taxa_am))));
        return { resultado: 'aplicavel', detalhe: `${acima.length} mês(es) com taxa acima de 8% a.m. (até ${pc(Math.max(...acima.map(l => Number(l.taxa_am))))}).`, valor: excesso, valor_base: 'em cada mês: juros cobrados × (1 − 8/taxa do mês)' };
      }
    },
    {
      id: 'tarifa_disponibilizacao_limite',
      nome: 'Tarifa por deixar o limite disponível',
      explicacao_cliente: 'Cobrar só por ter o cheque especial disponível, sem usar, não é permitido.',
      fundamento: 'Res. CMN 4.765/2019, art. 2º (tarifa pela disponibilização do limite) — revogado e declarado inconstitucional pelo STF na ADI 6.407.',
      forca: 'alta',
      regra(d) {
        // só "disponibiliz…" (inclusive abreviado no extrato): avaliação emergencial de crédito é tarifa permitida (Res. 3.919, Tabela I)
        const t = desc(d, /disponibiliz/i, 'tarifa');
        if (!t.length) return naoSeAplica;
        const total = soma(t.map(l => l.valor));
        return { resultado: 'aplicavel', detalhe: `${t.length} cobrança(s) no extrato: ${brl(total)}.`, valor: total, valor_base: 'soma das tarifas de limite no extrato' };
      }
    }
  ],
  cartao: [
    {
      id: 'cartao_teto_100_faturas',
      nome: 'Juros e encargos do cartão acima do valor original da dívida',
      explicacao_cliente: 'Desde 2024, no rotativo e no parcelamento da fatura, os juros e encargos somados não podem passar do valor original da dívida.',
      fundamento: 'Lei 14.690/2023, art. 28, § 1º, e Res. CMN 4.549/2017, arts. 2º-A a 2º-D (operações a partir de 03/01/2024; a fatura deve mostrar o valor original e o total cobrado — art. 2º-B).',
      forca: 'alta',
      regra(d) {
        const fs = (d.faturas_cartao || []).filter(f => String(f.mes || '') >= '2024-01' && Number(f.valor_original_divida) > 0 && Number(f.juros_encargos_acumulados) > 0);
        if (!fs.length) return (d.faturas_cartao || []).length ? naoSeAplica : { resultado: 'verificar', detalhe: 'O teto se confere fatura a fatura (cada fatura mostra o valor original e o total de juros e encargos).', valor: null, documento: 'Faturas do cartão desde que a dívida entrou no rotativo' };
        // maior excesso por operação (valor original repetido = mesma dívida)
        const porOp = {};
        for (const f of fs) { const k = String(Number(f.valor_original_divida).toFixed(2)); const ex = Number(f.juros_encargos_acumulados) - Number(f.valor_original_divida); porOp[k] = Math.max(porOp[k] ?? -Infinity, ex); }
        const excesso = soma(Object.values(porOp).filter(x => x > 0));
        if (!(excesso > 0)) return naoSeAplica;
        return { resultado: 'aplicavel', detalhe: `Em ${Object.values(porOp).filter(x => x > 0).length} dívida(s) do cartão, os juros e encargos passaram do valor original.`, valor: excesso, valor_base: 'por dívida: juros e encargos acumulados − valor original (maior valor nas faturas)' };
      }
    },
    {
      id: 'cartao_rotativo_mais_de_um_mes',
      nome: 'Dívida mantida no rotativo por mais de uma fatura',
      explicacao_cliente: 'O saldo do cartão só pode ficar no rotativo (o juro mais caro) até a fatura seguinte; depois, o banco tem de oferecer parcelamento mais barato.',
      fundamento: 'Res. CMN 4.549/2017, art. 1º (rotativo só até o vencimento da fatura seguinte) e art. 2º (parcelamento em condições mais vantajosas).',
      forca: 'media',
      regra(d) {
        const fs = (d.faturas_cartao || []).filter(f => String(f.mes || '') >= '2017-04').sort((a, b) => String(a.mes).localeCompare(String(b.mes)));
        let seq = 0, max = 0, juros = 0;
        for (const f of fs) { if (f.no_rotativo === true) { seq++; if (seq >= 2) juros += Number(f.juros_rotativo) || 0; max = Math.max(max, seq); } else seq = 0; }
        if (max < 2) return naoSeAplica;
        return { resultado: 'aplicavel', detalhe: `${max} faturas seguidas no rotativo${juros > 0 ? `; juros do rotativo depois da 1ª fatura: ${brl(juros)}` : ''}.`, valor: null, valor_base: juros > 0 ? `juros do rotativo depois do 1º mês: ${brl(juros)} (a diferença para o parcelado depende da taxa do parcelado)` : null, documento: juros > 0 ? 'Taxa do parcelamento oferecido na fatura' : null };
      }
    }
  ],
  consignado: [
    {
      id: 'consignado_margem',
      nome: 'Descontos acima da margem consignável',
      explicacao_cliente: 'A lei limita quanto do salário ou benefício pode ser descontado. O que passou do limite pode ser cobrado de volta.',
      fundamento: 'Lei 10.820/2003: art. 6º, § 5º (INSS, até 45% do benefício: 35% empréstimos + 5% cartão consignado + 5% cartão de benefício) e art. 2º, § 2º, I (empregado, até 40% da remuneração disponível); quem retém acima perde as garantias da lei (art. 6º, § 6º).',
      forca: 'alta',
      regra(d) {
        const c = d.consignado_info || {};
        const lim = c.tipo_vinculo === 'inss' ? 45 : c.tipo_vinculo === 'clt' ? 40 : null;
        if (c.tipo_vinculo === 'publico') return { resultado: 'verificar', detalhe: 'Servidor público: a margem segue a lei do ente (estado ou município).', valor: null, documento: 'Holerite e a lei de consignação do órgão' };
        if (!lim || !(Number(c.remuneracao) > 0) || !(Number(c.soma_descontos_consignados) > 0)) return { resultado: 'verificar', detalhe: 'Para conferir a margem, falta o valor do benefício/salário e a soma dos descontos consignados.', valor: null, documento: c.tipo_vinculo === 'inss' ? 'Extrato de empréstimos consignados do INSS (Meu INSS)' : 'Holerite com os descontos' };
        const teto = Number(c.remuneracao) * lim / 100;
        const exc = Number(c.soma_descontos_consignados) - teto;
        if (!(exc > 0.005)) return naoSeAplica;
        return { resultado: 'aplicavel', detalhe: `Descontos de ${brl(c.soma_descontos_consignados)} sobre ${brl(c.remuneracao)}: o limite é ${lim}% (${brl(teto)}).`, valor: exc, valor_base: `${brl(exc)} POR MÊS acima do limite de ${lim}% — multiplicar pelos meses em que o desconto aconteceu` };
      }
    },
    {
      id: 'consignado_cartao_rmc',
      nome: 'Cartão consignado (RMC/RCC) no lugar do empréstimo pedido',
      explicacao_cliente: 'Quem pediu empréstimo e recebeu cartão consignado paga só o mínimo todo mês e a dívida quase não diminui.',
      fundamento: 'CDC, arts. 6º, III (informação clara), 39 (prática abusiva) e 52 (informação no crédito): contratação de cartão RMC/RCC em lugar do empréstimo pedido.',
      forca: 'alta',
      regra(d) {
        const c = d.consignado_info || {};
        if (c.cartao_rmc_rcc !== true) return naoSeAplica;
        const desc = cat(d, 'desconto_rmc');
        const total = soma(desc.map(l => l.valor));
        if (c.cliente_pediu_emprestimo === false) return naoSeAplica;
        return { resultado: c.cliente_pediu_emprestimo === true ? 'aplicavel' : 'verificar', detalhe: c.cliente_pediu_emprestimo === true ? 'O cliente pediu empréstimo e o banco averbou cartão consignado.' : 'Há cartão consignado: confirmar com o cliente se ele pediu empréstimo comum.', valor: total > 0 ? total : null, valor_base: total > 0 ? 'soma dos descontos do cartão consignado no extrato' : null, documento: total > 0 ? null : 'Extrato do benefício/holerite com os descontos do cartão (RMC/RCC)' };
      }
    }
  ],
  veiculo: [
    {
      id: 'veiculo_pre_gravame',
      nome: 'Tarifa de pré-gravame',
      explicacao_cliente: 'A cobrança do "registro de pré-gravame" é abusiva nos contratos feitos a partir de 2011.',
      fundamento: 'STJ, Tema 972 (repetitivo): abusivo o ressarcimento do registro do pré-gravame em contratos a partir de 25/02/2011.',
      forca: 'alta',
      regra(d) {
        if (String(d.operacao?.data_contratacao || '') < '2011-02-25') return naoSeAplica;
        const t = [...(d.tarifas || []).filter(x => /pr[eé].?gravame/i.test(x.nome || '') && Number(x.valor) > 0).map(x => x.valor), ...desc(d, /pr[eé].?gravame/i).map(l => l.valor)];
        if (!t.length) return naoSeAplica;
        return { resultado: 'aplicavel', detalhe: `Pré-gravame cobrado: ${brl(soma(t))}.`, valor: soma(t), valor_base: 'valor da tarifa de pré-gravame' };
      }
    },
    {
      id: 'veiculo_mora_sem_notificacao',
      nome: 'Busca e apreensão sem prova da notificação de atraso',
      explicacao_cliente: 'Para tomar o carro, o banco precisa provar que avisou do atraso no endereço do contrato.',
      fundamento: 'Súmula 72 STJ: a comprovação da mora é imprescindível à busca e apreensão do bem alienado fiduciariamente; DL 911/1969, art. 2º, § 2º.',
      forca: 'alta',
      regra(d) {
        if (d.situacao !== 'busca_apreensao') return naoSeAplica;
        const n = d.notificacao_mora || {};
        if (n.enviada === false) return { resultado: 'aplicavel', detalhe: 'Não há notificação de atraso nos documentos do processo.', valor: null, valor_base: 'protege o bem (afasta a busca e apreensão)' };
        if (n.enviada === true) return naoSeAplica;
        return { resultado: 'verificar', detalhe: 'Conferir no processo se o banco juntou a notificação enviada ao endereço do contrato.', valor: null, documento: 'Cópia da ação de busca e apreensão (petição, notificação e AR)' };
      }
    }
  ],
  ccb: [
    {
      id: 'ccb_planilha_execucao',
      nome: 'Execução da CCB sem planilha clara da dívida',
      explicacao_cliente: 'Para cobrar a cédula na Justiça, o banco tem de mostrar, mês a mês, como chegou ao saldo.',
      fundamento: 'Lei 10.931/2004, art. 28, § 2º: o saldo da CCB se apura por planilha de cálculo e extratos que discriminem encargos e períodos; se cobrar em desacordo com a cédula, o credor paga ao devedor o dobro do cobrado a maior (art. 28, § 3º).',
      forca: 'media',
      regra(d) {
        if (d.situacao !== 'executado') return naoSeAplica;
        return { resultado: 'verificar', detalhe: 'Execução em curso: conferir se a planilha do banco discrimina juros, encargos e períodos; se cobrar a mais, o banco devolve em dobro.', valor: null, documento: 'Planilha de cálculo juntada na execução' };
      }
    }
  ],
  pessoal: [],
  geral: []
};

/**
 * aplicarRoteiro(d, calc) → { roteiro, versao, itens: [...] } (só aplicável/verificar)
 * Formato de tese: entra direto em aplicarTeses().teses.
 */
function aplicarRoteiro(d = {}, calc = null) {
  const r = roteiroDo(d);
  const lista = [...(ROTEIROS[r] || []), ...COMUNS];
  const itens = [];
  for (const v of lista) {
    let out;
    try { out = v.regra(d, calc) || naoSeAplica; } catch (e) { out = { resultado: 'verificar', detalhe: 'Não foi possível conferir com os dados lidos.' }; }
    if (out.resultado === 'nao_aplicavel') continue;
    itens.push({
      id: v.id, nome: v.nome, fundamento: v.fundamento, explicacao_cliente: v.explicacao_cliente, forca: v.forca,
      resultado: out.resultado, detalhe: out.detalhe || '', trecho_contrato: null,
      valor: out.valor > 0 ? Math.round(out.valor * 100) / 100 : null, valor_base: out.valor_base || null,
      documento: out.documento || null, origem: 'roteiro'
    });
  }
  return { roteiro: r, versao: VERSAO_ROTEIROS, itens };
}

module.exports = { VERSAO_ROTEIROS, ROTEIROS, COMUNS, roteiroDo, aplicarRoteiro };
