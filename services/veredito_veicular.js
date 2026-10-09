/**
 * RASTREIA — Veredito da consulta veicular: "esse carro é seguro de vender?"
 *
 *   NAO_VENDA    → roubo/furto não recuperado, bloqueio judicial ativo,
 *                  chassi remarcado
 *   ATENCAO      → financiamento ativo, leilão, débitos, multas, recall,
 *                  roubo/furto recuperado, comunicado de venda, restrições
 *   PODE_VENDER  → nada encontrado nas bases consultadas
 *
 * Os indicadores da Consulta Nacional (leilão, roubo/furto, renajud...) valem
 * em todos os pacotes. Quando um indicador acusa e o pacote não detalha, o
 * motivo diz isso e o "Próximo passo" leva à Completa.
 *
 * Entrada: o objeto gravado em dados_consulta pelos pacotes Direct Data
 * (services/consultas.js) — { pacote, veiculo, gravame, estadual, fipe,
 * leilao, roubo_furto, renajud, recall, historico_proprietarios }.
 */
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const NAO_CONSULTADO = {
  simples: ['débitos de IPVA/licenciamento/multas', 'valor FIPE', 'detalhe de leilão', 'detalhe de roubo/furto', 'detalhe de bloqueio judicial', 'histórico de donos', 'recall'],
  mediana: ['detalhe de leilão', 'detalhe de roubo/furto', 'detalhe de bloqueio judicial', 'histórico de donos', 'recall'],
  completa: []
};

function veredictoVeicular(d = {}) {
  const pacote = d.pacote || 'simples';
  const v = d.veiculo || {};
  const ind = v.indicadores || {};
  const ok = (x) => x && x.disponivel !== false;
  const graves = []; const atencao = []; const faltou = [];

  if (!ok(d.veiculo)) faltou.push('dados do veículo (base nacional não respondeu)');

  // Roubo / furto
  if (ok(d.roubo_furto)) {
    if (d.roubo_furto.ativo) graves.push('Registro de roubo/furto sem recuperação — não negocie.');
    else if (d.roubo_furto.tem_registro) atencao.push('Já teve roubo/furto (recuperado) — confira a procedência e a vistoria.');
  } else if (ind.roubo_furto) {
    graves.push('Indicador de roubo/furto acusou na base nacional' + (pacote === 'completa' ? '.' : ' — veja o detalhe na Completa antes de negociar.'));
  }

  // Bloqueio judicial
  if (ok(d.renajud)) {
    if (d.renajud.bloqueios_ativos > 0) graves.push(`${d.renajud.bloqueios_ativos} bloqueio(s) judicial(is) ativo(s) (RENAJUD) — o carro não transfere até baixar.`);
  } else if (ind.renajud) {
    graves.push('Indicador de bloqueio judicial (RENAJUD) acusou' + (pacote === 'completa' ? '.' : ' — veja processo e tribunal na Completa.'));
  }

  if (v.chassi_remarcado) graves.push('Chassi remarcado' + (v.descricao_remarcacao ? ` (${v.descricao_remarcacao})` : '') + ' — exige laudo antes de qualquer negócio.');

  // Leilão
  if (ok(d.leilao)) {
    if (d.leilao.tem_registro) {
      const cls = d.leilao.registros.map(r => r.classificacao).filter(Boolean);
      atencao.push(`Passou por leilão (${d.leilao.total || d.leilao.registros.length} registro(s)${cls.length ? `, classificação: ${[...new Set(cls)].join(', ')}` : ''}) — desvaloriza e pode dificultar seguro.`);
    }
  } else if (ind.leilao) {
    atencao.push('Indicador de leilão acusou' + (pacote === 'completa' ? '.' : ' — data, leiloeiro e classificação na Completa.'));
  }

  // Financiamento
  if (ok(d.gravame) && d.gravame.tem_gravame) {
    atencao.push(`Financiado${d.gravame.financeira ? ` no ${d.gravame.financeira}` : ''} — quitar o contrato antes de transferir.`);
  } else if (!ok(d.gravame)) faltou.push('financiamento (gravame)');

  // Débitos
  if (ok(d.estadual) && d.estadual.total_debitos > 0) {
    atencao.push(`Débitos de ${brl(d.estadual.total_debitos)} (${d.estadual.debitos.map(x => x.nome).join(', ')}) — descontar do preço ou quitar na venda.`);
  }
  if (ind.renainf && !(ok(d.estadual) && d.estadual.total_debitos > 0)) atencao.push('Há multa registrada (RENAINF)' + (pacote === 'simples' ? ' — valores na Mediana.' : '.'));

  // Recall
  if (ok(d.recall) && d.recall.tem_recall) atencao.push(`Recall pendente: ${d.recall.campanhas.map(c => c.nome).filter(Boolean).join('; ') || 'campanha aberta'} — reparo gratuito na concessionária.`);
  else if (ind.recall && !ok(d.recall)) atencao.push('Indicador de recall pendente acusou.');

  if (ind.comunicado_venda) atencao.push('Existe comunicado de venda registrado — confira se o vendedor é o dono atual.');
  (v.restricoes || []).forEach(r => atencao.push(`Restrição: ${r}.`));

  let nivel = graves.length ? 'NAO_VENDA' : (atencao.length ? 'ATENCAO' : 'PODE_VENDER');
  if (nivel === 'PODE_VENDER' && faltou.length) nivel = 'INCONCLUSIVO';

  const TIT = {
    NAO_VENDA: { titulo: 'NÃO VENDA SEM RESOLVER', frase: 'Há impedimento grave. Resolva antes de vender, comprar ou aceitar na troca.' },
    ATENCAO: { titulo: 'ATENÇÃO', frase: 'Dá para negociar, mas resolva os pontos abaixo antes de fechar.' },
    PODE_VENDER: { titulo: 'PODE VENDER', frase: 'Nenhum impedimento nas bases consultadas — faça a vistoria cautelar.' },
    INCONCLUSIVO: { titulo: 'INCONCLUSIVO', frase: 'Alguma base não respondeu; refaça a consulta antes de decidir.' }
  };
  return {
    nivel, ...TIT[nivel], pacote,
    motivos: [...graves.map(texto => ({ nivel: 'grave', texto })), ...atencao.map(texto => ({ nivel: 'atencao', texto }))],
    faltou,
    nao_consultado: NAO_CONSULTADO[pacote] || [],
    fipe: ok(d.fipe) ? d.fipe.valor : null,
    debitos: ok(d.estadual) ? d.estadual.total_debitos : null
  };
}

module.exports = { veredictoVeicular };
