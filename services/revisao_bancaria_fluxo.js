/**
 * RASTREIA — Fluxo da Revisão de Contrato Bancário após a conferência:
 *   dados_conferidos → taxa média BACEN (ou manual) → itens questionáveis
 *   (teses) → motor de cálculo → checklist de teses → parecer IA → etapa
 *   revisao_juridica.
 * Nenhum número do laudo sai daqui por IA: o parecer recebe os números
 * prontos e formatados do motor.
 */
const revisao = require('./revisao_bancaria');
const calculo = require('./revisao_bancaria_calculo');
const teses = require('./revisao_bancaria_teses');
const bacen = require('./bacen_taxas');

const brl = (v) => (v == null ? null : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (v, dec = 2) => (v == null ? null : `${(Number(v) * 100).toFixed(dec).replace('.', ',')}%`);

async function limiares() {
  return {
    razaoForte: await revisao.configNum('revisao_bancaria_razao_forte', 1.5),
    razaoModerada: await revisao.configNum('revisao_bancaria_razao_moderada', 1.2),
    economiaFortePct: await revisao.configNum('revisao_bancaria_economia_forte_pct', 15),
    economiaModeradaPct: await revisao.configNum('revisao_bancaria_economia_moderada_pct', 5),
    prescricaoAnos: await revisao.configNum('revisao_bancaria_prescricao_anos', 10)
  };
}

// Resumo do cálculo para o parecer IA (sem tabelas, com números formatados)
function casoParaParecer(dados, taxa, calc, ts, diag) {
  const cen = {};
  for (const [k, c] of Object.entries(calc.cenarios || {})) {
    cen[k] = {
      nome: c.nome, taxa_am: pct(c.taxa_am, 4), parcela_contratada: brl(c.parcela_contratada), parcela_revisada: brl(c.parcela_revisada),
      diferenca_por_parcela: brl(c.diferenca_por_parcela), total_pago_a_mais: brl(c.total_pago_a_mais),
      saldo_devedor_contratual: brl(c.saldo_devedor_contratual), saldo_devedor_revisado: brl(c.saldo_devedor_revisado),
      economia_futura: brl(c.economia_futura), economia_total: brl(c.economia_total),
      repeticao_simples: brl(c.repeticao_simples), repeticao_dobro: brl(c.repeticao_dobro),
      itens_excluidos: (c.itens_excluidos || []).map(i => `${i.nome} (${brl(i.valor)})`)
    };
  }
  const { campos_editados, conferido_por, conferido_em, ...contrato } = dados;
  return {
    contrato,
    taxa_media_bacen: { origem: taxa.origem, serie: taxa.serie_am || null, nome_serie: taxa.nome_serie || null, mes_referencia: taxa.mes_referencia, valor_am: `${String(taxa.valor_am).replace('.', ',')}%`, posicao_banco: taxa.olinda?.banco || null },
    numeros_formatados: {
      taxa_efetiva_am: pct(calc.taxa.efetiva_am, 4), taxa_efetiva_aa: pct(calc.taxa.efetiva_aa),
      taxa_implicita_am: pct(calc.taxa.implicita_am, 4), taxa_declarada_am: pct(calc.taxa.declarada_am, 4),
      taxa_bacen_am: calc.bacen ? pct(calc.bacen.am, 4) : null, razao_taxa_bacen: calc.razao != null ? calc.razao.toFixed(2).replace('.', ',') : null,
      economia_estimada: brl(calc.economia_estimada),
      cet_real_am: calc.cet && calc.cet.real_am != null ? pct(calc.cet.real_am, 4) : null,
      cet_informado_am: calc.cet && calc.cet.declarado_am != null ? pct(calc.cet.declarado_am, 4) : null,
      pago_a_mais_corrigido_ipca: calc.indebito_corrigido && calc.indebito_corrigido.nominal > 0 ? brl(calc.indebito_corrigido.corrigido) : null,
      valor_incontroverso_mensal: calc.valor_incontroverso ? brl(calc.valor_incontroverso.parcela_mensal) : null, economia_pct_valor_financiado: calc.veredito?.economia_pct != null ? `${calc.veredito.economia_pct.toFixed(1).replace('.', ',')}%` : null
    },
    veredito: calc.veredito, cenario_principal: calc.cenario_principal, cenarios: cen, alertas: calc.alertas,
    teses: ts.teses.map(t => ({ nome: t.nome, resultado: t.resultado, detalhe: t.detalhe, trecho_contrato: t.trecho_contrato, fundamento: t.fundamento })),
    // O parecer explica o diagnóstico; não cria tese nova
    diagnostico: diag ? { resumo: diag.resumo, achados: diag.achados.map(a => ({ forca: a.forca, titulo: a.titulo, base: a.base, defesa_banco: a.defesa_banco })), nao_e_abuso: diag.nao_e_abuso, garantias: diag.garantias } : null
  };
}

/**
 * Executa taxa + cálculo + teses + parecer. Se o BACEN falhar e não houver
 * taxa manual, fica em 'calculando' com aguardando_taxa_manual.
 */
async function processarCalculo(pedidoId, usuarioId = null) {
  const reg = await revisao.obter(pedidoId);
  if (!reg || !reg.dados_conferidos) return { ok: false, erro: 'Sem dados conferidos.' };
  // A conferência edita os números; cláusulas e saques vêm da leitura da IA
  const ex = reg.dados_extraidos || {};
  const d = { ...reg.dados_conferidos };
  if (!d.clausulas && ex.clausulas) d.clausulas = ex.clausulas;
  if (!d.operacoes_do_limite && Array.isArray(ex.operacoes_do_limite)) d.operacoes_do_limite = ex.operacoes_do_limite;
  const analise = require('./revisao_analise');
  if (d.operacao && !d.operacao.estrutura) d.operacao = analise.marcarLimite({ ...d.operacao });

  // 1) Taxa média: manual (se o operador informou) ou BACEN com cache
  let taxa = d.taxa_media_manual && d.taxa_media_manual.ok ? d.taxa_media_manual : null;
  if (!taxa) {
    taxa = await bacen.obterComCache(pedidoId, {
      tipoOperacao: d.tipo_operacao || 'outro', pfpj: d.pfpj || 'PF', subtipo: d.subtipo || null,
      dataContratacao: d.operacao?.data_contratacao, banco: d.instituicao || {}
    });
  }
  if (!taxa || !taxa.ok) {
    await revisao.atualizar(pedidoId, { etapa: 'calculando', campos: { taxa_media_bacen: { ok: false, aguardando_taxa_manual: true, erro: taxa?.erro || 'Falha no BACEN' } }, usuarioId, acao: 'Revisão bancária: taxa BACEN indisponível', detalhes: `${taxa?.erro || ''} — informe a taxa média manualmente` });
    return { ok: false, aguardando_taxa_manual: true, erro: taxa?.erro };
  }

  // 2) Cálculo (cenário B usa os itens que as teses marcam)
  const ipcaMensal = await bacen.buscarIPCA(String(d.operacao?.data_contratacao || '').slice(0, 7) || null);
  const calc = calculo.calcular(d, { taxaMediaBacenAM: taxa.valor_am, questionaveis: teses.itensQuestionaveis(d), limiares: await limiares(), ipcaMensal });
  analise.limiteDeCredito(d, calc, taxa);
  // 3) Teses completas (com o cálculo) + diagnóstico estratégico (sem IA)
  const ts = teses.aplicarTeses(d, calc);
  const diag = require('./revisao_diagnostico').montarDiagnostico(d, calc, taxa, ts);

  // 4) Parecer IA explicativo (falha não trava: o advogado escreve)
  const ia = require('./revisao_bancaria_ia');
  const par = await ia.gerarParecer(pedidoId, casoParaParecer(d, taxa, calc, ts, diag));

  // Tabelas completas ficam no cálculo (anexo técnico do PDF)
  await revisao.atualizar(pedidoId, {
    etapa: 'revisao_juridica',
    campos: {
      taxa_media_bacen: taxa, calculo: calc, teses: ts, diagnostico: diag, veredito: calc.veredito.nivel,
      economia_estimada: Math.round(calc.economia_estimada * 100) / 100, versao_calculo: calc.versao_calculo,
      parecer_ia: par.ok ? JSON.stringify(par.parecer) : null
    },
    usuarioId, acao: 'Revisão bancária: cálculo concluído',
    detalhes: `Veredito ${calc.veredito.nivel} · economia ${brl(calc.economia_estimada)} · ${ts.aplicaveis} tese(s) aplicável(is) · parecer IA ${par.ok ? 'gerado' : 'indisponível (' + par.erro + ')'}`
  });
  return { ok: true, veredito: calc.veredito.nivel, economia: calc.economia_estimada, parecer_ia: par.ok };
}

// Operador informa a taxa média quando o BACEN falha; recalcula
async function informarTaxaManual(pedidoId, { valorAm, mesReferencia, fonte }, usuario) {
  const t = bacen.taxaManual({ valorAm, mesReferencia, fonte, usuario: usuario?.nome || usuario?.id });
  if (!t.ok) return { ok: false, erro: 'Taxa inválida.' };
  const reg = await revisao.obter(pedidoId);
  await revisao.atualizar(pedidoId, { campos: { dados_conferidos: { ...reg.dados_conferidos, taxa_media_manual: t } }, usuarioId: usuario?.id, acao: 'Revisão bancária: taxa média informada manualmente', detalhes: `${valorAm}% a.m. (${mesReferencia || 's/ mês'}) — fonte: ${fonte || 'não informada'}` });
  return processarCalculo(pedidoId, usuario?.id);
}

/**
 * Aprovação jurídica → laudo. Idempotente: a troca de etapa é atômica
 * (UPDATE ... WHERE etapa = 'revisao_juridica'); um segundo clique encontra
 * a etapa 'aprovado' e não gera outro PDF nem outro envio.
 */
async function aprovar(pedidoId, revisor, parecerJuridico, parecerIaEditado) {
  const { pool } = require('../db');
  const client = await pool.connect();
  let virou = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(pedidoId)]);
    const r = await client.query(
      `UPDATE revisao_bancaria SET etapa = 'aprovado', parecer_juridico = $1, revisor_id = $2, revisado_em = now(), atualizado_em = now()
         ${parecerIaEditado && typeof parecerIaEditado === 'object' ? ', parecer_ia = $4' : ''}
       WHERE pedido_id = $3 AND etapa = 'revisao_juridica' RETURNING id`,
      parecerIaEditado && typeof parecerIaEditado === 'object' ? [parecerJuridico, revisor.id, pedidoId, JSON.stringify(parecerIaEditado)] : [parecerJuridico, revisor.id, pedidoId]
    );
    virou = r.rows.length > 0;
    if (virou) await client.query('INSERT INTO logs (pedido_id, usuario_id, acao, detalhes) VALUES ($1, $2, $3, $4)',
      [pedidoId, revisor.id, 'Revisão bancária: aprovada pelo jurídico', `${revisor.nome || ''}${revisor.oab ? ` (OAB ${revisor.oab})` : ''}`]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

  const reg = await revisao.obter(pedidoId);
  if (!virou) {
    if (reg.etapa === 'aprovado') {
      const p = (await pool.query('SELECT status, relatorio_url FROM pedidos WHERE id = $1', [pedidoId])).rows[0];
      if (p && p.status === 'concluido' && p.relatorio_url) return { ok: true, ja_aprovado: true, url: p.relatorio_url };
      // Aprovado mas o laudo não saiu (falha no PDF): tenta de novo, sem duplicar
      const r2 = await require('./revisao_bancaria_laudo').concluirRevisao(pedidoId, revisor);
      return { ...r2, ja_aprovado: true };
    }
    return { ok: false, erro: 'A revisão não está na etapa jurídica.' };
  }
  return require('./revisao_bancaria_laudo').concluirRevisao(pedidoId, revisor);
}

module.exports = { processarCalculo, informarTaxaManual, casoParaParecer, limiares, aprovar };
