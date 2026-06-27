// services/faturamento.js
// Visão de dono: receita do mês/anterior/total, por forma de pagamento, por produto
// (com custo e lucro estimados), e mensalistas (cota usada vs ociosa).

const { pool } = require('../db');
const { estimarCustoProduto } = require('./custos');
const { PRODUTOS } = require('./produtos');

function inicioMes(offset = 0) {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth() + offset, 1);
}
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// "Recebido de fato" = não deletado, não cancelado, com data de pagamento.
const PAGOS = "deletado_em IS NULL AND status <> 'cancelado' AND pago_em IS NOT NULL";

async function montar() {
  const ini = inicioMes(0);
  const iniPrev = inicioMes(-1);

  const [mes, mesPrev, total, hoje, porForma, porProduto, mensalistas] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(valor),0) s, COUNT(*) n FROM pedidos WHERE ${PAGOS} AND pago_em >= $1`, [ini]),
    pool.query(`SELECT COALESCE(SUM(valor),0) s, COUNT(*) n FROM pedidos WHERE ${PAGOS} AND pago_em >= $1 AND pago_em < $2`, [iniPrev, ini]),
    pool.query(`SELECT COALESCE(SUM(valor),0) s, COUNT(*) n FROM pedidos WHERE ${PAGOS}`),
    pool.query(`SELECT COALESCE(SUM(valor),0) s, COUNT(*) n FROM pedidos WHERE ${PAGOS} AND pago_em::date = CURRENT_DATE`),
    pool.query(`SELECT COALESCE(forma_pagamento,'(não definida)') forma, COUNT(*) n, COALESCE(SUM(valor),0) s
                  FROM pedidos WHERE ${PAGOS} AND pago_em >= $1 GROUP BY 1 ORDER BY s DESC`, [ini]),
    pool.query(`SELECT tipo, COUNT(*) n, COALESCE(SUM(valor),0) s
                  FROM pedidos WHERE ${PAGOS} AND pago_em >= $1 GROUP BY tipo ORDER BY s DESC`, [ini]),
    pool.query(`SELECT nome, plano_nome, plano_cota_mensal, plano_consultas_usadas, plano_valor_mensal
                  FROM clientes WHERE ativo = true AND plano_cota_mensal > 0
                  ORDER BY plano_valor_mensal DESC NULLS LAST`)
  ]);

  // Custo/lucro por produto (estimativa do custo de API × quantidade).
  const produtos = [];
  let custoMes = 0;
  for (const row of porProduto.rows) {
    let custoUnit = 0;
    try { const est = await estimarCustoProduto(row.tipo); custoUnit = est ? est.total_brl : 0; } catch (_) {}
    const custoTot = custoUnit * Number(row.n);
    custoMes += custoTot;
    const receita = Number(row.s);
    produtos.push({
      tipo: row.tipo,
      nome: (PRODUTOS[row.tipo] && PRODUTOS[row.tipo].nome) || row.tipo,
      qtd: Number(row.n),
      receita: r2(receita),
      custo_unit: r2(custoUnit),
      custo_total: r2(custoTot),
      lucro: r2(receita - custoTot),
      margem_pct: receita > 0 ? r2((receita - custoTot) / receita * 100) : 0
    });
  }

  const receitaMes = Number(mes.rows[0].s);
  const mens = mensalistas.rows.map(m => ({
    nome: m.nome,
    plano: m.plano_nome || 'Plano',
    cota: Number(m.plano_cota_mensal || 0),
    usadas: Number(m.plano_consultas_usadas || 0),
    restantes: Math.max(Number(m.plano_cota_mensal || 0) - Number(m.plano_consultas_usadas || 0), 0),
    valor_mensal: Number(m.plano_valor_mensal || 0),
    ocioso: Number(m.plano_consultas_usadas || 0) === 0
  }));
  const recorrente = mens.reduce((a, m) => a + m.valor_mensal, 0);

  return {
    gerado_em: new Date().toISOString(),
    receita: {
      mes: r2(receitaMes), mes_pedidos: Number(mes.rows[0].n),
      mes_anterior: r2(mesPrev.rows[0].s), mes_anterior_pedidos: Number(mesPrev.rows[0].n),
      total: r2(total.rows[0].s), total_pedidos: Number(total.rows[0].n),
      hoje: r2(hoje.rows[0].s), hoje_pedidos: Number(hoje.rows[0].n)
    },
    custo_mes: r2(custoMes),
    lucro_mes: r2(receitaMes - custoMes),
    margem_mes_pct: receitaMes > 0 ? r2((receitaMes - custoMes) / receitaMes * 100) : 0,
    por_forma: porForma.rows.map(x => ({ forma: x.forma, qtd: Number(x.n), total: r2(x.s) })),
    por_produto: produtos,
    mensalistas: mens,
    mensalistas_resumo: {
      ativos: mens.length,
      ociosos: mens.filter(m => m.ocioso).length,
      recorrente_mes: r2(recorrente)
    }
  };
}

module.exports = { montar };
