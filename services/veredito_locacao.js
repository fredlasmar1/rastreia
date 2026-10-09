/**
 * RASTREIA — Aprovação de Inquilino: a resposta que a imobiliária precisa
 * ("esse inquilino vai pagar?") em forma de veredito com motivo.
 *
 *   APROVAR                → pode alugar sem garantia extra
 *   APROVAR_COM_GARANTIA   → aluga, mas com a garantia indicada (e quanto)
 *   RECUSAR                → risco alto demonstrado (despejo, dívida grande…)
 *   FALTAM_DADOS           → não dá para afirmar (sem renda, sem aluguel)
 *
 * Regra de mercado: o custo da locação (aluguel + condomínio + IPTU) deve
 * caber em até 30% da renda bruta. Entre 30% e 40% aluga com garantia;
 * acima de 40% só com fiador/seguro de renda alta, e o motivo é dito.
 *
 * Função pura: recebe os dados das consultas e os valores informados no
 * pedido; usada pelo PDF (services/pdf/analise_inquilino.js) e pelas telas.
 */

const LIMITE_IDEAL = 0.30;
const LIMITE_MAXIMO = 0.40;

function _norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Réu identificado por CPF no polo ou por nome + sobrenome (primeiro nome só não basta)
function _ehReu(processo, nome, cpf) {
  const polo = _norm(processo.polo_passivo);
  if (!polo) return false;
  const dig = String(cpf || '').replace(/\D/g, '');
  if (dig.length === 11 && polo.replace(/\D/g, '').includes(dig)) return true;
  const partes = _norm(nome).split(' ').filter(p => p.length >= 3);
  if (partes.length < 2) return false;
  return polo.includes(partes[0]) && polo.includes(partes[partes.length - 1]);
}

function _valor(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^\d,.-]/g, '');
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) ? n : 0;
}

function _anosAtras(dataBR) {
  const m = String(dataBR || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function avaliarLocacao({ dados = {}, aluguel, encargos, rendaDeclarada, nomeAlvo, docAlvo } = {}) {
  const cad = dados.receita_federal || {};
  const neg = dados.negativacoes || {};
  const score = Number((dados.score_credito || {}).score || 0);
  const proc = dados.processos || {};
  const nome = cad.nome || nomeAlvo || '';
  const cpf = cad.cpf || docAlvo || '';

  const vAluguel = _valor(aluguel);
  const vEncargos = _valor(encargos);
  const custoMensal = vAluguel + vEncargos;

  // Renda: declarada (com comprovante, informada pela imobiliária) vale mais que a estimada
  const rDecl = _valor(rendaDeclarada);
  const rEst = cad.renda_inconsistente ? 0 : Number(cad.renda_numerica || 0);
  const renda = rDecl > 0 ? rDecl : rEst;
  const rendaFonte = rDecl > 0 ? 'declarada' : (rEst > 0 ? 'estimada (Direct Data)' : null);
  const comprometimento = renda > 0 && custoMensal > 0 ? custoMensal / renda : null;
  const rendaNecessaria = custoMensal > 0 ? custoMensal / LIMITE_IDEAL : 0;

  const processos = Array.isArray(proc.processos) ? proc.processos : [];
  const despejos = processos.filter(p => /despejo/i.test(`${p.classe || ''} ${p.assunto || ''}`) && _ehReu(p, nome, cpf));
  const despejosRecentes = despejos.filter(p => { const a = _anosAtras(p.data_inicio); return a == null || a <= 5; });
  const execucoes = processos.filter(p => /execu[cç][aã]o|cumprimento de senten/i.test(`${_norm(p.classe)} ${_norm(p.assunto)}`) && _ehReu(p, nome, cpf));
  const execAtivas = execucoes.filter(p => !/arquiv|baixad|extint|encerrad/i.test(`${p.status || ''} ${p.status_detalhado || ''}`));

  const pendencia = Number(neg.total_pendencias || 0);
  const protestos = (neg.protestos || []).length + Number((dados.protestos || {}).total || 0);
  const situacaoIrregular = cad.situacao_rf && !/regular/i.test(cad.situacao_rf);
  const obito = !!cad.obito;

  const motivos = [];   // o que pesa contra, em linguagem de corretor
  const pontos = [];    // o que pesa a favor
  let nivel = 0;        // 0 aprovar · 1 garantia · 2 recusar

  if (obito || situacaoIrregular) {
    motivos.push(obito ? 'CPF com registro de óbito.' : `CPF com situação "${cad.situacao_rf}" na Receita Federal.`);
    nivel = 2;
  }
  if (despejosRecentes.length) {
    motivos.push(`${despejosRecentes.length} ação(ões) de despejo como réu nos últimos 5 anos.`);
    nivel = 2;
  } else if (despejos.length) {
    motivos.push(`${despejos.length} ação(ões) de despejo antiga(s) (mais de 5 anos).`);
    nivel = Math.max(nivel, 1);
  }
  if (pendencia > 0) {
    const mesesAluguel = vAluguel > 0 ? pendencia / vAluguel : null;
    if (mesesAluguel != null && mesesAluguel >= 6) {
      motivos.push(`Dívidas em aberto de ${brl(pendencia)} (cerca de ${Math.round(mesesAluguel)} aluguéis).`);
      nivel = 2;
    } else {
      motivos.push(`Dívidas em aberto de ${brl(pendencia)}.`);
      nivel = Math.max(nivel, 1);
    }
  }
  if (protestos > 0) { motivos.push(`${protestos} protesto(s) em cartório.`); nivel = Math.max(nivel, 1); }
  if (execAtivas.length) { motivos.push(`${execAtivas.length} execução(ões) de dívida ativa(s) como réu.`); nivel = Math.max(nivel, 1); }
  if (score > 0 && score < 300) { motivos.push(`Score de crédito baixo (${score}/1000).`); nivel = Math.max(nivel, 1); }

  if (comprometimento != null) {
    const pct = Math.round(comprometimento * 100);
    if (comprometimento <= LIMITE_IDEAL) pontos.push(`O aluguel + encargos (${brl(custoMensal)}) consome ${pct}% da renda ${rendaFonte} — dentro dos 30%.`);
    else if (comprometimento <= LIMITE_MAXIMO) { motivos.push(`O aluguel + encargos consome ${pct}% da renda ${rendaFonte} (ideal até 30%).`); nivel = Math.max(nivel, 1); }
    else { motivos.push(`O aluguel + encargos consome ${pct}% da renda ${rendaFonte} — acima de 40%. Renda necessária: ${brl(rendaNecessaria)}.`); nivel = Math.max(nivel, 1); }
  }
  if (!pendencia && !protestos) pontos.push('Nome limpo: sem dívidas nem protestos.');
  if (!despejos.length) pontos.push('Nenhuma ação de despejo encontrada.');
  if (score >= 600) pontos.push(`Score de crédito bom (${score}/1000).`);

  // Sem renda ou sem aluguel não dá para dizer "aprovar"
  const faltam = [];
  if (!custoMensal) faltam.push('valor do aluguel');
  if (!renda) faltam.push('renda (a estimada não veio — peça comprovante)');

  let veredito;
  if (nivel === 2) veredito = 'RECUSAR';
  else if (faltam.length && nivel === 0) veredito = 'FALTAM_DADOS';
  else veredito = nivel === 1 ? 'APROVAR_COM_GARANTIA' : 'APROVAR';

  // Garantia: a mais leve que cobre o risco encontrado
  let garantia = null;
  if (veredito === 'APROVAR_COM_GARANTIA') {
    const fiadorRenda = vAluguel > 0 ? brl(custoMensal * 3) : '3× o aluguel';
    if (pendencia > 0 || protestos > 0 || execAtivas.length) {
      garantia = { tipo: 'Seguro-fiança ou caução de 3 aluguéis', detalhe: `Há dívida/protesto em aberto: prefira garantia que não dependa do crédito do inquilino. Caução sugerida: ${vAluguel ? brl(vAluguel * 3) : '3 aluguéis'}.` };
    } else if (comprometimento != null && comprometimento > LIMITE_MAXIMO) {
      garantia = { tipo: 'Fiador com renda própria', detalhe: `A renda não comporta o aluguel sozinha: fiador com renda de pelo menos ${fiadorRenda}, ou compor renda com outro morador.` };
    } else {
      garantia = { tipo: 'Seguro-fiança ou fiador', detalhe: `Fiador com renda de pelo menos ${fiadorRenda} ou seguro-fiança.` };
    }
  }

  const TITULO = {
    APROVAR: 'APROVAR',
    APROVAR_COM_GARANTIA: 'APROVAR COM GARANTIA',
    RECUSAR: 'RECUSAR',
    FALTAM_DADOS: 'FALTAM DADOS PARA APROVAR'
  };
  return {
    veredito,
    titulo: TITULO[veredito],
    motivos,
    pontos_positivos: pontos,
    faltam,
    garantia,
    numeros: {
      aluguel: vAluguel, encargos: vEncargos, custo_mensal: custoMensal,
      renda, renda_fonte: rendaFonte,
      comprometimento_pct: comprometimento != null ? Math.round(comprometimento * 1000) / 10 : null,
      renda_necessaria: Math.round(rendaNecessaria * 100) / 100,
      score: score || null, pendencias: pendencia, protestos
    },
    despejos: despejos.map(p => ({ numero: p.numero, data_inicio: p.data_inicio, status: p.status, tribunal: p.tribunal })),
    execucoes_ativas: execAtivas.map(p => ({ numero: p.numero, classe: p.classe, valor_causa: p.valor_causa }))
  };
}

module.exports = { avaliarLocacao, LIMITE_IDEAL, LIMITE_MAXIMO };
