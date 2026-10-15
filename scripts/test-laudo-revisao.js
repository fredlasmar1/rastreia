/**
 * Teste do laudo da Revisão Bancária SEM banco e SEM APIs:
 * monta o registro com o motor de cálculo + teses (contrato realista do Banco Pan),
 * gera o PDF (origem BACEN e origem manual) e confere a mensagem ao cliente.
 *   node scripts/test-laudo-revisao.js   → PDFs em RELATORIOS_DIR (ou public/relatorios)
 */
const assert = require('assert');
const fs = require('fs');
const C = require('../services/revisao_bancaria_calculo');
const T = require('../services/revisao_bancaria_teses');
const { gerarDossie } = require('../services/pdf');
const { mensagemCliente } = require('../services/revisao_bancaria_laudo');

const dados = {
  pfpj: 'PF', tipo_operacao: 'financiamento_veiculo', situacao: 'busca_apreensao', parcelas_pagas: 14,
  contratante: { nome: 'CLIENTE TESTE ANONIMIZADO', cpf_cnpj: '000.000.000-00' },
  instituicao: { nome: 'Banco Pan', cnpj: '59.285.411/0001-13' },
  operacao: { numero_contrato: 'TESTE-0001', data_contratacao: '2023-05-10', data_primeiro_vencimento: '2023-06-10', valor_financiado_total: 45000, valor_parcela: 1580, prazo_meses: 48, sistema_amortizacao: 'price', taxa_juros_mensal_declarada: 2.19, taxa_juros_anual_declarada: 29.68, capitalizacao_expressa: true },
  tarifas: [
    { nome: 'Tarifa de cadastro', valor: 800, financiada: true, trecho: 'Tarifa de cadastro R$ 800,00' },
    { nome: 'Serviços de terceiros', valor: 700, financiada: true, trecho: 'Serviços de terceiros R$ 700,00' },
    { nome: 'Tarifa de avaliação do bem', valor: 450, financiada: true }
  ],
  seguros: [{ tipo: 'prestamista', nome: 'Seguro prestamista', valor: 1200, financiado: true, havia_opcao_recusar: false, trecho: 'Seguro prestamista contratado com a seguradora parceira' }],
  iof: { valor: 1100, financiado: true },
  garantia: { tipo: 'alienacao_fiduciaria', bem_descricao: 'Automóvel 2019' },
  encargos_mora: { juros_mora: 1, multa_percentual: 2, comissao_permanencia: false },
  campos_editados: ['operacao.valor_parcela']
};
const calc = C.calcular(dados, { taxaMediaBacenAM: 2.08, questionaveis: T.itensQuestionaveis(dados) });
const teses = T.aplicarTeses(dados, calc);
const taxaBacen = {
  ok: true, origem: 'bacen_sgs', serie_am: 25471, nome_serie: 'Taxa média de juros — PF — Aquisição de veículos', mes_contratacao: '2023-05', mes_referencia: '2023-05', recuou_meses: 0, valor_am: 2.08, data_consulta: '2026-10-13T12:00:00Z',
  olinda: { semana: '2023-05-02 a 2023-05-08', total_instituicoes: 44, menor_am: 1.2, maior_am: 3.6, banco: { nome: 'BCO PAN S.A.', posicao: 42, taxa_am: 3.2 } }
};
const taxaManual = { ok: true, origem: 'manual', valor_am: 2.08, mes_referencia: '2023-05', fonte_manual: 'BACEN série 25471', informado_por: 'Operador Teste', data_consulta: '2026-10-13T12:00:00Z' };
const parecerIa = {
  resumo_cliente: 'Seu contrato tem juros acima da média do mercado e cobrou seguro e serviços de terceiros que podem ser questionados.',
  pontos_encontrados: ['Seguro prestamista sem opção de recusa'], analise_tecnica: 'Texto técnico.',
  proximos_passos: ['Defesa na busca e apreensão com base neste laudo.', 'Ação revisional com pedido de restituição.'],
  ressalvas: ['Os documentos foram enviados por foto.']
};
const pedido = { id: '00000000-0000-4000-8000-000000000001', numero: 9999, tipo: 'revisao_contrato_bancario', cliente_nome: 'Cliente Teste', alvo_nome: 'CLIENTE TESTE ANONIMIZADO' };
const registro = (taxa) => ({
  etapa: 'aprovado', dados_conferidos: dados, calculo: calc, teses, taxa_media_bacen: taxa, veredito: calc.veredito.nivel,
  economia_estimada: calc.economia_estimada, versao_calculo: calc.versao_calculo, parecer_ia: JSON.stringify(parecerIa),
  parecer_juridico: 'Parecer jurídico de teste. O contrato apresenta pontos revisáveis (seguro casado e serviços de terceiros) e a defesa na busca e apreensão é recomendada.',
  revisor_id: 'x', revisado_em: '2026-10-13T15:00:00Z'
});

let ok = 0, falhas = 0;
async function teste(nome, fn) { try { await fn(); ok++; console.log('  ✔', nome); } catch (e) { falhas++; console.log('  ✘', nome, '\n     ', e.message); } }

(async () => {
  console.log('Laudo — Revisão de Contrato Bancário');
  for (const [nome, taxa] of [['BACEN', taxaBacen], ['manual', taxaManual]]) {
    await teste(`PDF gerado (taxa ${nome})`, async () => {
      const out = await gerarDossie({ ...pedido, __revisao: { registro: registro(taxa), revisor: { nome: 'Advogado Teste', oab: 'GO 00.000' }, balladaoWhatsapp: '(62) 99999-0000' } }, []);
      const st = fs.statSync(out.filepath);
      assert.ok(st.size > 8000, 'PDF pequeno demais');
      console.log(`      ${out.filepath} (${Math.round(st.size / 1024)} KB)`);
    });
  }
  await teste('Mensagem ao cliente usa os números do cálculo', () => {
    const m = mensagemCliente({ ...pedido }, registro(taxaBacen), 'https://x/relatorios/a.pdf?exp=1&sig=s', '62999990000');
    const econ = 'R$ ' + calc.economia_estimada.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    assert.ok(m.includes(econ), 'economia');
    assert.ok(m.includes((calc.taxa.efetiva_am * 100).toFixed(2).replace('.', ',') + '% a.m.'), 'taxa');
    assert.ok(m.includes('wa.me/62999990000'), 'CTA Balladão');
    assert.ok(m.includes(calc.veredito.nivel.toUpperCase()), 'veredito');
  });
  // Contrato de LIMITE (GiroCaixa) sem a taxa dos saques: laudo com o diagnóstico estratégico
  const AN = require('../services/revisao_analise');
  const DG = require('../services/revisao_diagnostico');
  const exGiro = {
    classificacao: { tipo_operacao: 'ccb_capital_giro', pfpj: 'PJ' }, instituicao: { nome: 'CAIXA ECONOMICA FEDERAL' }, garantia: { tipo: 'aval' },
    contratante: { nome: 'EMPRESA TESTE LTDA', cpf_cnpj: '00.000.000/0001-00' },
    operacao: { tipo: 'GIROCAIXA Fácil (Limite de Crédito)', numero_contrato: 'TESTE-GIRO', valor_financiado_total: 150000, data_contratacao: '2025-06-17', capitalizacao_expressa: true, clausula_capitalizacao_trecho: 'podendo ser fixados entre a taxa mínima de 2,26% ao mês e a taxa máxima de 100,00% ao mês' },
    clausulas: {
      taxa_reduzida_condicionada: { presente: true, aviso_previo: false, clausula: 'Cl. 7ª §3º', trecho: 'o redutor será cancelado, sem necessidade de comunicação prévia' },
      debito_em_limite_rotativo: { autorizado: true, revogavel: true, clausula: 'Cl. 7ª' }, garantia_dividas_futuras: { presente: true },
      vencimento_antecipado: { presente: true, sem_notificacao: true, cruzado_outras_operacoes: true, por_fato_de_avalista: true, clausula: 'Cl. 11ª' },
      fundo_garantidor: { tipo: 'FGM', percentual: 80, honra_atualiza_pela_selic: true }, liquidacao_antecipada: { presente: true, clausula: 'Cl. 8ª' },
      canal_renegociacao: { presente: true, contato: '0800 726 8068, opção 8' }, avalistas_quantidade: 2, aval_com_anuencia_conjuge: true,
      foro: 'justica_federal', vigencia_dias: 7200, prazos_de_risco: [{ evento: 'Bloqueio do limite', dias: 5, clausula: 'Cl. 4ª' }]
    }
  };
  const dg = AN.montarDados(exGiro);
  const txGiro = { ok: true, origem: 'bacen_sgs', serie_am: 25442, nome_serie: 'Capital de giro PJ > 365 dias', mes_referencia: '2025-06', valor_am: 1.75, data_consulta: '2026-10-15T12:00:00Z' };
  const calcG = C.calcular(dg, { taxaMediaBacenAM: 1.75 });
  AN.limiteDeCredito(dg, calcG, txGiro);
  const tsG = T.aplicarTeses(dg, calcG);
  const regG = { etapa: 'aprovado', dados_conferidos: dg, calculo: calcG, teses: tsG, diagnostico: DG.montarDiagnostico(dg, calcG, txGiro, tsG), taxa_media_bacen: txGiro, veredito: calcG.veredito.nivel, economia_estimada: 0, versao_calculo: calcG.versao_calculo, parecer_juridico: 'Parecer de teste.', revisado_em: '2026-10-15T15:00:00Z' };
  await teste('Laudo do CLIENTE não leva o diagnóstico interno (estratégia, defesa do banco)', async () => {
    const out = await gerarDossie({ ...pedido, numero: 9998, alvo_nome: 'EMPRESA TESTE LTDA', __revisao: { registro: regG, revisor: { nome: 'Advogado Teste', oab: 'GO 00.000' } } }, []);
    const txt = require('child_process').execFileSync('pdftotext', ['-layout', out.filepath, '-']).toString();
    assert.ok(txt.includes('FALTAM DADOS'), 'veredito');
    for (const k of ['DIAGNÓSTICO', 'O banco deve alegar', 'O banco vai alegar', 'NÃO É ABUSO', 'PROVIDÊNCIAS IMEDIATAS', 'CAMINHOS POSSÍVEIS'])
      assert.ok(!txt.includes(k), 'vazou para o cliente: ' + k);
    assert.ok(!/NaN|undefined/.test(txt), 'NaN/undefined no PDF');
    console.log(`      ${out.filepath}`);
  });
  await teste('Mensagem ao cliente de contrato sem taxa não mostra NaN', () => {
    const m = mensagemCliente({ ...pedido }, regG, 'https://x/relatorios/b.pdf?exp=1&sig=s', '62999990000');
    assert.ok(!/NaN|undefined|null/.test(m), m);
  });
  console.log(`\n${ok} passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
