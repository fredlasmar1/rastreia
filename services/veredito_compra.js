/**
 * RASTREIA — Capacidade de Compra: "esse cliente consegue comprar/financiar?"
 * Serve à imobiliária (imóvel) e à loja de veículos (carro).
 *
 *   COMPORTA            → a parcela cabe na renda e nada trava o banco
 *   COMPORTA_COM_AJUSTE → nada trava, mas precisa de mais entrada/prazo/renda
 *   TRAVA_NO_BANCO      → dívida ativa, score muito baixo ou CPF irregular:
 *                         resolver antes de levar ao banco
 *   FALTAM_DADOS        → sem valor do bem ou sem renda
 *
 * Conta (padrão dos bancos): parcela até 30% da renda bruta.
 *   Imóvel  → SAC (1ª parcela, a mais alta), 360 meses, 11,5% a.a.
 *   Veículo → Price, 48 meses, 1,99% a.m.
 * Taxas e prazos são referência de mercado (out/2026) e podem ser trocados
 * pelo pedido. Função pura — usada pelo PDF e pelas telas.
 */

const LIMITE_PARCELA = 0.30;
const PADRAO = {
  imovel: { prazo: 360, taxaMensal: Math.pow(1 + 0.115, 1 / 12) - 1, sistema: 'SAC', rotuloTaxa: '11,5% ao ano' },
  veiculo: { prazo: 48, taxaMensal: 0.0199, sistema: 'Price', rotuloTaxa: '1,99% ao mês' }
};

const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round(n * 100) / 100;

function _valor(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^\d,.-]/g, '');
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Parcela para financiar PV em n meses à taxa i
function parcela(PV, n, i, sistema) {
  if (PV <= 0) return 0;
  if (sistema === 'SAC') return PV / n + PV * i;            // 1ª parcela (a maior)
  return PV * i / (1 - Math.pow(1 + i, -n));                // Price (fixa)
}
// Quanto dá para financiar com uma parcela máxima
function financiavel(pmax, n, i, sistema) {
  if (pmax <= 0) return 0;
  if (sistema === 'SAC') return pmax / (1 / n + i);
  return pmax * (1 - Math.pow(1 + i, -n)) / i;
}

function avaliarCompra({ dados = {}, tipoBem = 'imovel', valorBem, entrada, prazoMeses, rendaDeclarada } = {}) {
  const cfg = PADRAO[tipoBem] || PADRAO.imovel;
  const cad = dados.receita_federal || {};
  const neg = dados.negativacoes || {};
  const score = Number((dados.score_credito || {}).score || 0);

  const vBem = _valor(valorBem);
  const vEntrada = Math.min(_valor(entrada), vBem);
  const n = Math.max(1, parseInt(prazoMeses, 10) || cfg.prazo);
  const i = cfg.taxaMensal;
  const financiado = Math.max(vBem - vEntrada, 0);

  const rDecl = _valor(rendaDeclarada);
  const rEst = cad.renda_inconsistente ? 0 : Number(cad.renda_numerica || 0);
  const renda = rDecl > 0 ? rDecl : rEst;
  const rendaFonte = rDecl > 0 ? 'declarada' : (rEst > 0 ? 'estimada (Direct Data)' : null);

  const p = parcela(financiado, n, i, cfg.sistema);
  const pMax = renda * LIMITE_PARCELA;
  const comprometimento = renda > 0 && p > 0 ? p / renda : null;
  const maxFinanciavel = financiavel(pMax, n, i, cfg.sistema);
  const entradaNecessaria = Math.max(vBem - maxFinanciavel, 0);
  const rendaNecessaria = p > 0 ? p / LIMITE_PARCELA : 0;

  const pendencia = Number(neg.total_pendencias || 0);
  const credores = Array.isArray(neg.pendencias) ? neg.pendencias : [];
  const protestos = (neg.protestos || []).length + Number((dados.protestos || {}).total || 0);
  const irregular = (cad.situacao_rf && !/regular/i.test(cad.situacao_rf)) || !!cad.obito;

  const travas = [];
  if (irregular) travas.push(cad.obito ? 'CPF com registro de óbito.' : `CPF com situação "${cad.situacao_rf}" na Receita.`);
  if (pendencia > 0) travas.push(`Nome negativado: ${brl(pendencia)} em dívidas${credores.length ? ` com ${credores.length} credor(es)` : ''} — o banco costuma recusar até quitar ou negociar.`);
  if (protestos > 0) travas.push(`${protestos} protesto(s) em cartório — precisa baixar antes do financiamento.`);
  if (score > 0 && score < 300) travas.push(`Score de crédito muito baixo (${score}/1000).`);

  const ajustes = [];
  const pontos = [];
  if (comprometimento != null) {
    const pct = Math.round(comprometimento * 100);
    if (comprometimento <= LIMITE_PARCELA) pontos.push(`A parcela de ${brl(p)} usa ${pct}% da renda ${rendaFonte} — dentro dos 30% que o banco aceita.`);
    else {
      ajustes.push(`A parcela de ${brl(p)} usa ${pct}% da renda ${rendaFonte} (o banco aceita até 30%).`);
      if (entradaNecessaria > vEntrada) ajustes.push(`Com a renda atual, a entrada precisa ser de ${brl(entradaNecessaria)} (hoje ${brl(vEntrada)}).`);
      ajustes.push(`Ou compor renda: precisa de ${brl(rendaNecessaria)} de renda somada.`);
    }
  }
  if (!pendencia && !protestos) pontos.push('Nome limpo: sem dívidas nem protestos.');
  if (score >= 600) pontos.push(`Score bom (${score}/1000) — ajuda na taxa.`);

  const faltam = [];
  if (!vBem) faltam.push('valor do ' + (tipoBem === 'veiculo' ? 'veículo' : 'imóvel'));
  if (!renda) faltam.push('renda (a estimada não veio — peça comprovante)');

  let veredito;
  if (travas.length) veredito = 'TRAVA_NO_BANCO';
  else if (faltam.length) veredito = 'FALTAM_DADOS';
  else veredito = ajustes.length ? 'COMPORTA_COM_AJUSTE' : 'COMPORTA';

  const TITULO = {
    COMPORTA: 'COMPORTA O FINANCIAMENTO',
    COMPORTA_COM_AJUSTE: 'COMPORTA COM AJUSTE',
    TRAVA_NO_BANCO: 'TRAVA NO BANCO — RESOLVER ANTES',
    FALTAM_DADOS: 'FALTAM DADOS'
  };
  return {
    veredito,
    titulo: TITULO[veredito],
    resumo: renda > 0
      ? `Com a renda ${rendaFonte} de ${brl(renda)}, financia até ${brl(maxFinanciavel)} (${cfg.sistema}, ${n} meses, ${cfg.rotuloTaxa}).`
      : '',
    travas, ajustes, pontos_positivos: pontos, faltam,
    numeros: {
      tipo_bem: tipoBem, valor_bem: vBem, entrada: vEntrada, financiado: r2(financiado),
      prazo_meses: n, sistema: cfg.sistema, taxa: cfg.rotuloTaxa,
      parcela: r2(p), renda, renda_fonte: rendaFonte,
      comprometimento_pct: comprometimento != null ? Math.round(comprometimento * 1000) / 10 : null,
      parcela_maxima: r2(pMax), max_financiavel: r2(maxFinanciavel),
      entrada_necessaria: r2(entradaNecessaria), renda_necessaria: r2(rendaNecessaria),
      score: score || null, pendencias: pendencia, protestos
    },
    credores: credores.slice(0, 10).map(c => ({ credor: c.credor, valor: c.valor, data: c.data_inclusao }))
  };
}

module.exports = { avaliarCompra, parcela, financiavel, PADRAO, LIMITE_PARCELA };
