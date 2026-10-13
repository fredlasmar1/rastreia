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
  console.log(`\n${ok} passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
