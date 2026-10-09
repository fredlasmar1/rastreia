/**
 * RASTREIA — Checagem do Vendedor: "esse vendedor tem algo que pode travar
 * ou anular a venda?" (imóvel ou veículo).
 *
 *   RISCO    → execução de dívida ativa contra o vendedor (a venda pode ser
 *              anulada por fraude à execução se ele ficar sem bens), débito
 *              trabalhista (TST) ou federal (RFB/PGFN), CPF irregular
 *   ATENCAO  → dívidas/protestos, outros processos ativos como réu
 *   LIVRE    → nada encontrado nas bases consultadas
 *
 * Função pura — usada pelo PDF e pelas telas.
 */
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function _norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function _ehReu(p, nome, doc) {
  const polo = _norm(p.polo_passivo);
  if (!polo) return false;
  const dig = String(doc || '').replace(/\D/g, '');
  if (dig.length >= 11 && polo.replace(/\D/g, '').includes(dig)) return true;
  const partes = _norm(nome).split(' ').filter(x => x.length >= 3);
  if (partes.length < 2) return partes.length === 1 && polo.includes(partes[0]) && partes[0].length >= 6;
  return polo.includes(partes[0]) && polo.includes(partes[partes.length - 1]);
}
const _ativo = (p) => !/arquiv|baixad|extint|encerrad|julgad/i.test(`${p.status || ''} ${p.status_detalhado || ''}`);
function _valor(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^\d,.-]/g, '');
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) ? n : 0;
}

function avaliarVendedor({ dados = {}, nomeAlvo, docAlvo } = {}) {
  const cad = dados.receita_federal || {};
  const nome = cad.nome || cad.razao_social || nomeAlvo || '';
  const doc = cad.cpf || cad.cnpj || docAlvo || '';
  const procs = Array.isArray((dados.processos || {}).processos) ? dados.processos.processos : [];
  const comoReu = procs.filter(p => _ehReu(p, nome, doc) && _ativo(p));
  const execucoes = comoReu.filter(p => /execu[cç][aã]o|cumprimento de senten|penhora|fiscal/i.test(`${_norm(p.classe)} ${_norm(p.assunto)}`));
  const outros = comoReu.filter(p => !execucoes.includes(p));
  const valorExec = execucoes.reduce((s, p) => s + _valor(p.valor_causa), 0);

  const neg = dados.negativacoes || {};
  const pendencia = Number(neg.total_pendencias || 0);
  const protestos = Math.max((neg.protestos || []).length, Number((dados.protestos || {}).total || 0));
  const cndt = dados.cndt || {}; const ccd = dados.certidao_conjunta || {};
  const irregular = (cad.situacao_rf && !/regular|ativa/i.test(cad.situacao_rf)) || !!cad.obito;

  const riscos = []; const atencao = []; const ok = []; const faltou = [];
  if (irregular) riscos.push(cad.obito ? 'CPF com registro de óbito — quem assina a venda?' : `Documento com situação "${cad.situacao_rf}" na Receita.`);
  if (execucoes.length) riscos.push(`${execucoes.length} execução(ões) de dívida ativa(s) contra o vendedor${valorExec ? ` (${brl(valorExec)} em causa)` : ''} — se a venda o deixar sem bens, a Justiça pode anular o negócio (fraude à execução). Exija quitação ou retenção do valor.`);
  if (cndt.disponivel !== false && cndt.positiva) riscos.push(`Débito trabalhista no TST (${cndt.total || 'há'} processo(s)) — mesma regra: pode anular a venda se não houver outros bens.`);
  if (ccd.disponivel !== false && ccd.positiva) riscos.push(`Débito com a Receita/PGFN${ccd.dividas?.length ? `: ${ccd.dividas.slice(0, 3).join('; ')}` : ''} — dívida federal também pode atingir a venda.`);

  if (pendencia > 0) atencao.push(`Dívidas em aberto de ${brl(pendencia)}${(neg.pendencias || []).length ? ` com ${(neg.pendencias || []).length} credor(es)` : ''}.`);
  if (protestos > 0) atencao.push(`${protestos} protesto(s) em cartório.`);
  if (outros.length) atencao.push(`${outros.length} outro(s) processo(s) ativo(s) como réu — conferir se envolvem o bem.`);

  if (!execucoes.length) ok.push('Nenhuma execução de dívida ativa contra o vendedor.');
  if (cndt.disponivel !== false && cndt.positiva === false) ok.push('Certidão trabalhista (TST) negativa.');
  if (ccd.disponivel !== false && ccd.positiva === false) ok.push('Sem débitos com a Receita/PGFN.');
  if (!pendencia && !protestos) ok.push('Nome limpo: sem dívidas nem protestos.');

  if (cndt.disponivel === false) faltou.push('certidão trabalhista (TST)');
  if (ccd.disponivel === false) faltou.push('certidão de débitos federais');
  if ((dados.processos || {}).disponivel === false) faltou.push('processos');

  let nivel = riscos.length ? 'RISCO' : (atencao.length ? 'ATENCAO' : 'LIVRE');
  if (nivel === 'LIVRE' && faltou.length) nivel = 'INCOMPLETO';
  const TIT = {
    RISCO: { titulo: 'RISCO — NÃO FECHE SEM RESOLVER', frase: 'Há algo que pode travar ou anular a venda. Resolva antes da escritura/transferência.' },
    ATENCAO: { titulo: 'ATENÇÃO', frase: 'Dá para seguir, mas confira os pontos abaixo antes de fechar.' },
    LIVRE: { titulo: 'LIVRE PARA NEGOCIAR', frase: 'Nada encontrado que trave a venda nas bases consultadas.' },
    INCOMPLETO: { titulo: 'INCOMPLETO', frase: 'Alguma certidão não respondeu; refaça a consulta antes de fechar.' }
  };
  return {
    nivel, ...TIT[nivel], riscos, atencao, pontos_positivos: ok, faltou,
    execucoes: execucoes.slice(0, 10).map(p => ({ numero: p.numero, classe: p.classe, valor_causa: p.valor_causa, tribunal: p.tribunal, data_inicio: p.data_inicio })),
    comprovantes: [cndt.comprovante && { nome: 'Certidão trabalhista (TST)', url: cndt.comprovante }, ccd.comprovante && { nome: 'Certidão de débitos federais', url: ccd.comprovante }].filter(Boolean)
  };
}

module.exports = { avaliarVendedor };
