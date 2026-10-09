/**
 * PDF — Consulta Veicular (Simples / Mediana / Completa) pela Direct Data.
 *
 * Responde "esse carro é seguro de vender?" na primeira dobra:
 *   1. Veredito (PODE VENDER / ATENÇÃO / NÃO VENDA SEM RESOLVER) + motivos
 *   2. Valor FIPE e débitos (Mediana/Completa)
 *   3. Dados do veículo
 *   4. Detalhe de cada base consultada
 * Regra do veredito: services/veredito_veicular.js.
 */
const chrome = require('./chrome');
const { COR, MARGEM, LARGURA, secao, linha, verificarPagina } = require('./helpers');
const { veredictoVeicular } = require('../veredito_veicular');

const CORES = {
  NAO_VENDA: { fundo: '#fee2e2', texto: '#7f1d1d' },
  ATENCAO: { fundo: '#ffedd5', texto: '#7c2d12' },
  PODE_VENDER: { fundo: '#dcfce7', texto: '#14532d' },
  INCONCLUSIVO: { fundo: '#e5e7eb', texto: '#1f2937' }
};
const NOME_PACOTE = { simples: 'Simples', mediana: 'Mediana', completa: 'Completa' };
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ok = (x) => x && x.disponivel !== false;

function texto(doc, y, txt, cor, tam = 9, bold = false, recuo = 4) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam);
  const h = doc.heightOfString(txt, { width: LARGURA - recuo * 2 });
  y = verificarPagina(doc, y, h + 4);
  doc.fillColor(cor).text(txt, MARGEM + recuo, y, { width: LARGURA - recuo * 2 });
  return y + h + 3;
}

function blocoVeredito(doc, y, ver) {
  const c = CORES[ver.nivel];
  doc.font('Helvetica').fontSize(9);
  const hMot = ver.motivos.reduce((h, m) => h + doc.heightOfString('•  ' + m.texto, { width: LARGURA - 24 }) + 3, 0);
  const altura = 50 + hMot + 6;
  y = verificarPagina(doc, y + 4, altura);
  doc.rect(MARGEM, y, LARGURA, altura).fill(c.fundo);
  doc.fillColor(c.texto).fontSize(9).font('Helvetica-Bold').text('PODE VENDER ESTE VEÍCULO?', MARGEM + 12, y + 8);
  doc.fontSize(18).text(ver.titulo, MARGEM + 12, y + 19, { width: LARGURA - 24 });
  doc.fontSize(9).font('Helvetica').text(ver.frase, MARGEM + 12, y + 39, { width: LARGURA - 24 });
  let yy = y + 52;
  ver.motivos.forEach(m => {
    doc.fillColor(m.nivel === 'grave' ? '#991b1b' : '#9a3412').font(m.nivel === 'grave' ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
      .text('•  ' + m.texto, MARGEM + 12, yy, { width: LARGURA - 24 });
    yy += doc.heightOfString('•  ' + m.texto, { width: LARGURA - 24 }) + 3;
  });
  return y + altura + 6;
}

function blocoValor(doc, y, d, ver) {
  if (ver.fipe == null && ver.debitos == null) return y;
  y = secao(doc, 'VALOR E DÉBITOS', y);
  if (ver.fipe != null) y = linha(doc, 'Tabela FIPE', `${brl(ver.fipe)}${d.fipe.mes_referencia ? ` (ref. ${d.fipe.mes_referencia})` : ''}`, y, 13);
  if (ok(d.estadual)) {
    if (!d.estadual.debitos.length) y = linha(doc, 'Débitos', 'Nenhum débito encontrado', y, 13);
    d.estadual.debitos.forEach(x => { y = linha(doc, x.nome, `${brl(x.valor)}${x.situacao ? ` — ${x.situacao}` : ''}`, y, 13); });
    if (d.estadual.debitos.length) y = linha(doc, 'Total de débitos', brl(d.estadual.total_debitos), y, 13);
    if (ver.fipe != null && d.estadual.total_debitos > 0) y = linha(doc, 'FIPE menos débitos', brl(ver.fipe - d.estadual.total_debitos), y, 13);
  }
  return y + 4;
}

function blocoVeiculo(doc, y, v) {
  if (!ok(v)) return y;
  y = secao(doc, 'DADOS DO VEÍCULO', y);
  const campos = [
    ['Placa', v.placa], ['Marca/Modelo', v.marca_modelo], ['Ano fab./modelo', [v.ano_fabricacao, v.ano_modelo].filter(Boolean).join('/')],
    ['Cor', v.cor], ['Combustível', v.combustivel], ['Chassi', v.chassi], ['Renavam', v.renavam],
    ['Município/UF', [v.municipio, v.uf].filter(Boolean).join('/')], ['Espécie/Tipo', [v.especie, v.tipo].filter(Boolean).join(' / ')],
    ['Situação', v.situacao], ['Procedência', v.procedencia]
  ];
  campos.forEach(([k, val]) => { if (val) y = linha(doc, k, val, y, 12); });
  return y + 4;
}

function blocoBases(doc, y, d) {
  y = secao(doc, 'DETALHE DAS BASES', y);
  const g = d.gravame;
  if (ok(g)) y = linha(doc, 'Financiamento (gravame)', g.tem_gravame ? `ATIVO — ${g.financeira || 'financeira não informada'}${g.data_inclusao ? ` desde ${g.data_inclusao}` : ''}` : 'Livre', y, 12);
  if (ok(d.leilao)) {
    y = linha(doc, 'Leilão', d.leilao.tem_registro ? `${d.leilao.total || d.leilao.registros.length} registro(s)` : 'Nenhum registro', y, 12);
    d.leilao.registros.slice(0, 5).forEach(r => { y = texto(doc, y, `${r.data || '?'} — ${r.leiloeiro || 'leiloeiro não informado'}${r.lote ? `, lote ${r.lote}` : ''}${r.classificacao ? ` — ${r.classificacao}` : ''}`, '#374151', 8, false, 14); });
  }
  if (ok(d.roubo_furto)) {
    y = linha(doc, 'Roubo/furto', d.roubo_furto.tem_registro ? (d.roubo_furto.ativo ? 'REGISTRO ATIVO' : 'Teve registro — recuperado') : 'Nenhum registro', y, 12);
    d.roubo_furto.ocorrencias.slice(0, 5).forEach(o => { y = texto(doc, y, `${o.data || o.ano || '?'} — ${o.categoria || ''} ${o.orgao ? `(${o.orgao})` : ''}`, '#374151', 8, false, 14); });
  }
  if (ok(d.renajud)) {
    y = linha(doc, 'Bloqueio judicial (RENAJUD)', d.renajud.bloqueios_ativos ? `${d.renajud.bloqueios_ativos} ATIVO(S)` : 'Nenhum bloqueio ativo', y, 12);
    d.renajud.ocorrencias.slice(0, 5).forEach(o => { y = texto(doc, y, `${o.status || ''} — ${o.tipo || ''} — processo ${o.processo || '?'} (${o.tribunal || o.orgao || ''})`, '#374151', 8, false, 14); });
  }
  if (ok(d.recall)) y = linha(doc, 'Recall', d.recall.tem_recall ? d.recall.campanhas.map(c => c.nome).filter(Boolean).join('; ') || 'Pendente' : 'Nenhum pendente', y, 12);
  if (ok(d.historico_proprietarios)) {
    y = linha(doc, 'Histórico de donos', `${d.historico_proprietarios.total} registro(s)`, y, 12);
    d.historico_proprietarios.proprietarios.slice(0, 8).forEach(p => { y = texto(doc, y, `${p.ano || '?'} — ${p.nome || 'nome não informado'} ${p.documento_mascarado ? `(${p.documento_mascarado})` : ''} ${p.uf || ''}`, '#374151', 8, false, 14); });
  }
  return y + 4;
}

function render(doc, pedido, dados, score, checklist, produto) {
  const ver = veredictoVeicular(dados);
  let y = chrome.cabecalho(doc, pedido, { ...produto, nome: `Consulta Veicular ${NOME_PACOTE[ver.pacote] || ''}`.trim() });
  y = blocoVeredito(doc, y, ver);
  y = blocoValor(doc, y, dados, ver);
  y = blocoVeiculo(doc, y, dados.veiculo);
  y = blocoBases(doc, y, dados);
  if (ver.nao_consultado.length) {
    y = texto(doc, y + 2, `Este pacote não consulta: ${ver.nao_consultado.join(', ')}.`, COR.cinza, 8);
  }
  if (ver.faltou.length) y = texto(doc, y, `Não responderam nesta consulta: ${ver.faltou.join(', ')}.`, COR.laranja, 8);
  chrome.blocoFinal(doc, y, null, { fontes: ['Direct Data — Consulta Veicular Nacional, Estadual, Gravame, FIPE, Leilão, Roubo e Furto, RENAJUD, Recall e Histórico de Proprietários (conforme o pacote)'] });
}

module.exports = { render };
