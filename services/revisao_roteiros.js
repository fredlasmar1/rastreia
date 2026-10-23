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
 * Citações conferidas: Súmulas 379, 72, 332 e 286 (STJ, fontes oficiais,
 * 23/10/2026); Temas 618/619 e 972 (lista do teste 12); Res. CMN 4.765, 4.549 e
 * 3.919 e Leis 10.820, 13.999, 7.827 e 10.260 no acervo do escritório / Planalto.
 *
 * Fase 2 (23/10/2026): imóvel, renegociação em cadeia, programas (Pronampe,
 * FCO/FNE/FNO, Fies, rural) e garantias (fiança/aval sem o cônjuge, fiador que não
 * anuiu à renegociação) — somadas ao roteiro do tipo quando o caso tem programa
 * ou garantidores.
 */
const VERSAO_ROTEIROS = 'rb-roteiros-1.2.0 (2026-10-23)';
const hojeISO = () => new Date().toISOString().slice(0, 10);
const anosAtras = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10); };

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
  if (t === 'renegociacao') return 'renegociacao';
  if (t === 'financiamento_imobiliario') return 'imovel';
  if (t === 'emprestimo_pessoal') return 'pessoal';
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

// Execução: honorários contratuais acima dos 10% do CPC
COMUNS.push({
  id: 'honorarios_judiciais_contratuais',
  nome: 'Honorários de advogado acima de 10% na execução',
  explicacao_cliente: 'O contrato prevê honorários maiores para o advogado do banco na cobrança judicial, mas na execução quem fixa é o juiz — em regra 10%, e só 5% se pagar em 3 dias.',
  fundamento: 'CPC, art. 827: na execução por quantia certa, o juiz fixa, de plano, honorários de 10%, reduzidos à metade se o executado pagar em 3 dias (§ 1º).',
  forca: 'media',
  regra(d) {
    const h = Number(d.clausulas?.honorarios_judiciais_percentual);
    if (!(h > 10) || d.situacao !== 'executado') return naoSeAplica;
    const total = Number(d.planilha_banco?.total_cobrado) || 0;
    return { resultado: 'aplicavel', detalhe: `O contrato prevê ${String(h).replace('.', ',')}% na cobrança judicial.${total ? ` Sobre ${brl(total)}, cada ponto acima de 10% custa ${brl(total / 100)}.` : ''}`, valor: total ? total * (h - 10) / 100 : null, valor_base: total ? `${brl(total)} × (${String(h).replace('.', ',')}% − 10%) evitados` : null };
  }
});

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
        const temPlanilha = d.planilha_banco && Number(d.planilha_banco.total_cobrado) > 0;
        return { resultado: 'verificar', detalhe: temPlanilha ? 'A planilha do banco veio: conferir se cada encargo bate com o contrato; se cobrar a mais, o banco devolve em dobro.' : 'Execução em curso: conferir se a planilha do banco discrimina juros, encargos e períodos; se cobrar a mais, o banco devolve em dobro.', valor: null, documento: temPlanilha ? null : 'Planilha de cálculo juntada na execução' };
      }
    }
  ],
  pessoal: [],
  geral: [],
  imovel: [
    {
      id: 'imovel_intimacao_purgar',
      nome: 'Consolidação do imóvel sem intimação pessoal para pagar o atraso',
      explicacao_cliente: 'Antes de tomar o imóvel, o banco tem de intimar o comprador, pelo cartório, para pagar o atraso. Sem isso, o leilão pode ser anulado.',
      fundamento: 'Lei 9.514/1997, art. 26: a consolidação da propriedade exige a intimação do devedor pelo oficial do registro de imóveis para purgar a mora em 15 dias.',
      forca: 'alta',
      regra(d) {
        if (d.garantia?.tipo !== 'alienacao_fiduciaria' || !['atrasado', 'executado'].includes(d.situacao)) return naoSeAplica;
        return { resultado: 'verificar', detalhe: 'Contrato em atraso com o imóvel em garantia: conferir se houve a intimação do cartório e os prazos do leilão.', valor: null, documento: 'Matrícula atualizada do imóvel e a intimação do cartório de registro de imóveis' };
      }
    }
  ],
  renegociacao: [
    {
      id: 'renegociacao_cadeia',
      nome: 'Dívidas antigas embutidas na renegociação',
      explicacao_cliente: 'Renegociar não apaga o que foi cobrado errado antes: dá para revisar os contratos antigos que viraram esta dívida.',
      fundamento: 'Súmula 286 STJ: a renegociação de contrato bancário ou a confissão da dívida não impede a discussão sobre eventuais ilegalidades dos contratos anteriores.',
      forca: 'alta',
      regra() {
        return { resultado: 'verificar', detalhe: 'A revisão volta até o primeiro contrato: juros, tarifas e encargos de atraso que entraram no saldo renegociado podem sair.', valor: null, documento: 'Todos os contratos de origem e o extrato que mostra a quitação deles pela renegociação' };
      }
    },
    {
      id: 'tarifa_aditamento',
      nome: 'Tarifa cobrada para renegociar ou aditar o contrato',
      explicacao_cliente: 'Para pessoa física, o banco não pode cobrar tarifa para aditar contrato de adesão nem na quitação antecipada.',
      fundamento: 'Res. CMN 3.919/2010, art. 5º, § 1º: vedada a cobrança de tarifa de aditamento em contrato de adesão e na liquidação antecipada (pessoa natural).',
      forca: 'alta',
      regra(d) {
        if (!ehPF(d)) return naoSeAplica;
        const re = /aditamento|aditivo|renegocia|repactua/i;
        const t = [...(d.tarifas || []).filter(x => re.test(x.nome || '') && Number(x.valor) > 0).map(x => x.valor), ...desc(d, re, 'tarifa').map(l => l.valor)];
        if (!t.length) return naoSeAplica;
        return { resultado: 'aplicavel', detalhe: `Tarifa de renegociação/aditamento: ${brl(soma(t))}.`, valor: soma(t), valor_base: 'valor da tarifa cobrada' };
      }
    }
  ]
};

// ── Programas oficiais: somados ao roteiro do tipo quando o contrato é de programa ──
const PROGRAMAS = {
  pronampe: [
    {
      id: 'pronampe_renegociacao_pos_honra',
      nome: 'Renegociação com desconto depois da honra do FGO',
      explicacao_cliente: 'Quando o fundo do governo já pagou o banco, a lei manda o banco oferecer renegociação, inclusive com desconto.',
      fundamento: 'Lei 13.999/2020, art. 5º, § 9º (red. Lei 14.995/2024): após a honra pelo FGO, os agentes financeiros deverão adotar estratégia de renegociação semelhante à de créditos próprios, inclusive com descontos, conforme o estatuto do Fundo; a parte honrada não recuperada é leiloada/cedida e, se não alienada, extinta (art. 5º, §§ 5º e 8º).',
      forca: 'alta',
      regra(d) {
        const pb = d.planilha_banco || {};
        const honrado = Number(pb.valor_honrado_fundo) > 0;
        if (!honrado) return d.situacao === 'executado' || d.situacao === 'atrasado'
          ? { resultado: 'verificar', detalhe: 'Contrato em atraso: confirmar se o FGO já honrou a dívida — se sim, o banco tem de renegociar com desconto.', valor: null, documento: 'Planilha de débito do banco (mostra a honra do FGO)' }
          : naoSeAplica;
        const parte = Number(pb.saldo_parte_fundo) > 0 ? ` A parte do fundo cobrada hoje é ${brl(pb.saldo_parte_fundo)}.` : '';
        return { resultado: 'aplicavel', detalhe: `O FGO pagou ${brl(pb.valor_honrado_fundo)} ao banco${pb.data_honra_fundo ? ` em ${String(pb.data_honra_fundo).split('-').reverse().join('/')}` : ''}.${parte} Pedir proposta de renegociação com desconto por escrito.`, valor: null, valor_base: 'desconto conforme o estatuto do FGO (pedir a proposta ao banco)' };
      }
    },
    {
      id: 'pronampe_garantia_excessiva',
      nome: 'Garantia além da permitida no Pronampe',
      explicacao_cliente: 'No Pronampe, o banco só pode exigir a garantia pessoal do próprio empresário; imóvel, veículo ou aval de terceiros podem ser liberados.',
      fundamento: 'Lei 13.999/2020, art. 4º, § 2º: no Pronampe, a garantia exigida se limita à garantia pessoal do proponente, no valor do empréstimo mais encargos (salvo empresa com menos de 1 ano).',
      forca: 'alta',
      regra(d) {
        const real = ['alienacao_fiduciaria', 'hipoteca'].includes(d.garantia?.tipo);
        const terceiros = (d.garantidores || []).filter(g => g.socio_da_empresa === false);
        if (!real && !terceiros.length) return naoSeAplica;
        return { resultado: 'aplicavel', detalhe: real ? 'O contrato tem garantia real (bem do cliente) além da pessoal.' : `${terceiros.length} garantidor(es) que não são sócios da empresa.`, valor: null, valor_base: 'libera os bens e os garantidores em excesso' };
      }
    }
  ],
  fundo_constitucional: [
    {
      id: 'fundo_renegociacao_extraordinaria',
      nome: 'Renegociação extraordinária com desconto não oferecida',
      explicacao_cliente: 'Dívidas antigas de FCO, FNE e FNO têm direito a renegociação com desconto. O pedido protocolado já suspende a cobrança.',
      fundamento: 'Lei 7.827/1989, arts. 15-E e 15-G (com a Lei 14.166/2021): renegociação extraordinária de operações contratadas há 7 anos ou mais; o protocolo suspende a cobrança, as execuções e a prescrição; pedido até 29/04/2028 (Dec. 12.445/2025).',
      forca: 'alta',
      regra(d) {
        const data = String(d.operacao?.data_contratacao || '');
        if (!data) return { resultado: 'verificar', detalhe: 'Falta a data da contratação original para saber se a operação tem 7 anos ou mais.', valor: null, documento: 'Ficha completa da operação (o banco entrega em até 30 dias)' };
        if (data > anosAtras(7)) return naoSeAplica;
        return { resultado: 'aplicavel', detalhe: 'Operação com 7 anos ou mais: cabe pedir a renegociação extraordinária (desconto por rebate/bônus) antes de qualquer ação.', valor: null, valor_base: 'desconto fixado na lei sobre o saldo atualizado sem multa e mora', documento: 'Ficha completa da operação (o banco entrega em até 30 dias)' };
      }
    }
  ],
  fies: [
    {
      id: 'fies_capitalizacao_antiga',
      nome: 'Juros sobre juros mensais em Fies antigo',
      explicacao_cliente: 'No Fies, o juro composto mensal só passou a valer para contratos de 2011 em diante. Antes disso, a cobrança é indevida.',
      fundamento: 'Lei 10.260/2001, art. 5º, II: a capitalização mensal de juros no Fies só passou a ser admitida com a Lei 12.431/2011 (MP 517/2010); STJ, REsp 1.155.684/RN (repetitivo).',
      forca: 'alta',
      regra(d, calc) {
        const data = String(d.operacao?.data_contratacao || '');
        if (!data || data >= '2010-12-31') return naoSeAplica;
        const mensal = d.operacao?.capitalizacao_expressa === true || calc?.taxa?.capitalizacao_por_duodecuplo === true;
        if (!mensal) return { resultado: 'verificar', detalhe: 'Contrato anterior a 2011: conferir no extrato se os juros foram capitalizados mês a mês.', valor: null, documento: 'Extrato da evolução do financiamento (agente financeiro)' };
        return { resultado: 'aplicavel', detalhe: 'Contrato anterior a 2011 com juros capitalizados mês a mês.', valor: null, valor_base: 'recálculo do saldo com juros simples no período anterior a 2011', documento: 'Extrato da evolução do financiamento (agente financeiro)' };
      }
    },
    {
      id: 'fies_renegociacao_2026',
      nome: 'Renegociação do Fies com 100% de desconto nos encargos de atraso',
      explicacao_cliente: 'Até 31/12/2026, contratos do Fies (2018 em diante) em atraso podem ser renegociados em até 180 parcelas, sem os encargos do atraso.',
      fundamento: 'Res. CG-Fies 64/2025, arts. 1º a 5º: adesão até 31/12/2026, entrada + até 180 parcelas e 100% de desconto dos encargos moratórios (inadimplência de mais de 90 dias em 31/07/2025).',
      forca: 'alta',
      regra(d) {
        if (String(d.operacao?.data_contratacao || '') < '2018-01-01' || hojeISO() > '2026-12-31') return naoSeAplica;
        return { resultado: d.situacao === 'atrasado' ? 'aplicavel' : 'verificar', detalhe: d.situacao === 'atrasado' ? 'Contrato em atraso: aderir antes de 31/12/2026.' : 'Vale se o contrato estava com mais de 90 dias de atraso em 31/07/2025.', valor: null, valor_base: 'encargos de atraso perdoados', documento: 'Extrato do Fies com a data do 1º atraso' };
      }
    }
  ],
  rural: [
    {
      id: 'rural_composicao_mp1376',
      nome: 'Composição de dívidas rurais (MP 1.376/2026) — prazo curto',
      explicacao_cliente: 'Produtor com perdas de safra pode trocar a dívida por uma nova, com juros de 6% a 12% ao ano e até 8 anos para pagar. O prazo para contratar é curto.',
      fundamento: 'MP 1.376/2026, arts. 1º a 5º: perdas de 30% em duas ou mais safras (2019–2025) com laudo; encargos de 6%, 9% ou 12% a.a.; até 8 anos; contratação em até 120 dias de 15/07/2026 (conferir a vigência da MP).',
      forca: 'alta',
      regra() {
        if (hojeISO() > '2026-11-12') return naoSeAplica;
        return { resultado: 'verificar', detalhe: 'Prazo para contratar até 12/11/2026: checar com o cliente se houve perda de safra com laudo.', valor: null, valor_base: 'troca de encargos de mercado por 6% a 12% a.a.', documento: 'Laudos de perda de safra (2019–2025)' };
      }
    }
  ]
};
PROGRAMAS.fco = PROGRAMAS.fne = PROGRAMAS.fno = PROGRAMAS.fundo_constitucional;

// ── Garantias: somadas quando o contrato tem garantidores ──
const GARANTIAS = [
  {
    id: 'fianca_sem_conjuge',
    nome: 'Fiança sem a assinatura do cônjuge',
    explicacao_cliente: 'Fiança dada por pessoa casada sem a assinatura do marido ou da esposa não vale: o fiador fica livre.',
    fundamento: 'Súmula 332 STJ: a fiança prestada sem autorização de um dos cônjuges implica a ineficácia total da garantia; CC, art. 1.647, III.',
    forca: 'alta',
    regra(d) {
      const g = (d.garantidores || []).filter(x => x.tipo === 'fianca' && x.casado === true && x.conjuge_assinou === false);
      if (!g.length) return naoSeAplica;
      return { resultado: 'aplicavel', detalhe: `Fiador(es) casado(s) sem a assinatura do cônjuge: ${g.map(x => x.nome || 'fiador').join(', ')}.`, valor: null, valor_base: 'libera o fiador da dívida inteira' };
    }
  },
  {
    id: 'aval_sem_conjuge',
    nome: 'Aval sem a assinatura do cônjuge',
    explicacao_cliente: 'Aval de pessoa casada sem a assinatura do cônjuge pode ser questionado para proteger os bens do casal.',
    fundamento: 'CC, art. 1.647, III: aval de pessoa casada exige autorização do cônjuge (há decisões que dispensam em títulos regidos por lei própria, como a CCB — avaliar caso a caso).',
    forca: 'media',
    regra(d) {
      const g = (d.garantidores || []).filter(x => x.tipo === 'aval' && x.casado === true && x.conjuge_assinou === false);
      if (!g.length) return naoSeAplica;
      return { resultado: 'verificar', detalhe: `Avalista(s) casado(s) sem a assinatura do cônjuge: ${g.map(x => x.nome || 'avalista').join(', ')}.`, valor: null, documento: 'Certidão de casamento do avalista' };
    }
  },
  {
    id: 'fiador_nao_anuiu',
    nome: 'Prazo novo dado ao devedor sem o consentimento do fiador',
    explicacao_cliente: 'Se o banco deu prazo novo ou renegociou sem o fiador assinar, o fiador fica liberado.',
    fundamento: 'CC, art. 838, I: o fiador fica desobrigado se, sem seu consentimento, o credor conceder moratória ao devedor.',
    forca: 'alta',
    regra(d) {
      const g = (d.garantidores || []).filter(x => x.tipo === 'fianca' && x.assinou_renegociacao === false);
      if (!g.length) return naoSeAplica;
      return { resultado: 'aplicavel', detalhe: `Fiador(es) que não assinaram a renegociação: ${g.map(x => x.nome || 'fiador').join(', ')}.`, valor: null, valor_base: 'libera o fiador' };
    }
  }
];

/**
 * aplicarRoteiro(d, calc) → { roteiro, versao, itens: [...] } (só aplicável/verificar)
 * Formato de tese: entra direto em aplicarTeses().teses.
 */
function aplicarRoteiro(d = {}, calc = null) {
  const r = roteiroDo(d);
  const prog = require('./revisao_tetos').programaDoContrato(d);
  const lista = [...(ROTEIROS[r] || []), ...((prog && PROGRAMAS[prog]) || []), ...((d.garantidores || []).length ? GARANTIAS : []), ...COMUNS];
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

module.exports = { VERSAO_ROTEIROS, ROTEIROS, PROGRAMAS, GARANTIAS, COMUNS, roteiroDo, aplicarRoteiro };
