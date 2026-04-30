/**
 * services/pdf/consulta_veicular_pacotes.js
 *
 * Renderer único para os 3 pacotes Credify:
 *  - consulta_veicular_simples   (R$ 12)  — VeicularBNacionalOnLine + Gravame + Renainf
 *  - consulta_veicular_mediana   (R$ 39)  — Simples + RENAJUD + HistoricoProprietarios + IndicioSinistro
 *  - consulta_veicular_completa  (R$ 79)  — VeiculoTotal (pacote único Credify)
 *
 * Os dados vêm de services/credify/api.js. Este renderer NÃO consulta APIs;
 * apenas formata o que já foi salvo em dados_consulta.
 */

const chrome = require('./chrome');
const {
  COR, MARGEM, LARGURA, verificarPagina,
  secao, linha, avisoBox, boxPositivo, boxEmIntegracao, renderAlerta
} = require('./helpers');

function safeStr(v, fallback) {
  if (v == null || v === '') return fallback || '-';
  return String(v);
}

function rotuloPacote(tipo) {
  if (tipo === 'consulta_veicular_simples') return 'PACOTE SIMPLES';
  if (tipo === 'consulta_veicular_mediana') return 'PACOTE MEDIANO';
  if (tipo === 'consulta_veicular_completa') return 'PACOTE COMPLETO';
  return 'CONSULTA VEICULAR';
}

function renderIndisponivel(doc, y, titulo, info) {
  y = secao(doc, titulo, y);
  const partes = [];
  if (info?.erro) partes.push(info.erro);
  if (info?.detalhes && info.detalhes !== info.erro) partes.push(info.detalhes);
  const msg = partes.join(' - ') || 'sem retorno da API Credify';
  y = avisoBox(doc, y, `Consulta indisponível: ${msg}`);
  if (info?.fonte) {
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(info.fonte, MARGEM, y, { width: LARGURA });
    y += 12;
  }
  return y + 4;
}

function blocoIdentificacao(doc, y, v) {
  if (!v) return y;
  if (!v.disponivel) return renderIndisponivel(doc, y, 'IDENTIFICACAO DO VEICULO', v);

  y = secao(doc, 'IDENTIFICACAO DO VEICULO', y);
  if (v.marca || v.modelo || v.marca_modelo) {
    y = linha(doc, 'Marca / Modelo', v.marca_modelo || [v.marca, v.modelo].filter(Boolean).join(' '), y, 13);
  }
  if (v.ano_fabricacao || v.ano_modelo) {
    y = linha(doc, 'Ano fab. / modelo', `${safeStr(v.ano_fabricacao, '?')}/${safeStr(v.ano_modelo, '?')}`, y, 13);
  }
  if (v.cor) y = linha(doc, 'Cor', v.cor, y, 13);
  if (v.combustivel) y = linha(doc, 'Combustivel', v.combustivel, y, 13);
  if (v.chassi) y = linha(doc, 'Chassi', v.chassi, y, 13);
  if (v.renavam) y = linha(doc, 'Renavam', v.renavam, y, 13);
  if (v.tipo_veiculo) y = linha(doc, 'Tipo', v.tipo_veiculo, y, 13);
  if (v.especie) y = linha(doc, 'Especie', v.especie, y, 13);
  if (v.categoria) y = linha(doc, 'Categoria', v.categoria, y, 13);
  if (v.municipio || v.uf) y = linha(doc, 'Registro', [v.municipio, v.uf].filter(Boolean).join(' / '), y, 13);
  if (v.proprietario) y = linha(doc, 'Proprietario', v.proprietario, y, 13);
  if (v.proprietario_documento) y = linha(doc, 'Documento', v.proprietario_documento, y, 13);
  return y + 6;
}

function blocoGravame(doc, y, g) {
  if (!g) return y;
  if (!g.disponivel) return renderIndisponivel(doc, y, 'GRAVAME / FINANCIAMENTO', g);

  y = secao(doc, 'GRAVAME / FINANCIAMENTO', y);
  if (g.tem_gravame === false || g.sem_restricao) {
    y = boxPositivo(doc, y, 'Sem gravame ativo', 'Veiculo sem alienacao fiduciaria, leasing ou reserva de dominio registrada.');
    return y;
  }
  if (g.tipo) y = linha(doc, 'Tipo de restricao', g.tipo, y, 13);
  if (g.financeira || g.banco) y = linha(doc, 'Financeira', g.financeira || g.banco, y, 13);
  if (g.data_contrato) y = linha(doc, 'Data do contrato', g.data_contrato, y, 13);
  if (g.numero_contrato) y = linha(doc, 'No. contrato', g.numero_contrato, y, 13);
  if (g.uf) y = linha(doc, 'UF', g.uf, y, 13);
  if (g.observacao) y = linha(doc, 'Observacao', g.observacao, y, 13);
  return y + 6;
}

function blocoRenainf(doc, y, r) {
  if (!r) return y;
  if (!r.disponivel) return renderIndisponivel(doc, y, 'MULTAS RENAINF', r);

  y = secao(doc, 'MULTAS RENAINF (TRANSITO FEDERAL)', y);
  const qtd = r.quantidade ?? r.total ?? (Array.isArray(r.multas) ? r.multas.length : 0);
  if (!qtd) {
    y = boxPositivo(doc, y, 'Sem multas RENAINF em aberto', 'Veiculo sem registros de infracoes federais pendentes.');
    return y;
  }
  y = linha(doc, 'Total de multas', String(qtd), y, 13);
  if (r.valor_total != null) {
    y = linha(doc, 'Valor total em aberto', `R$ ${Number(r.valor_total).toFixed(2).replace('.', ',')}`, y, 13);
  }
  if (Array.isArray(r.multas)) {
    const top = r.multas.slice(0, 5);
    top.forEach((m, i) => {
      const desc = `${m.data || ''} - ${m.descricao || m.infracao || ''}`.trim();
      y = linha(doc, `Multa ${i + 1}`, desc || '-', y, 13);
    });
  }
  return y + 6;
}

function blocoRenajud(doc, y, r) {
  if (!r) return y;
  if (!r.disponivel) return renderIndisponivel(doc, y, 'BLOQUEIO JUDICIAL (RENAJUD)', r);

  y = secao(doc, 'BLOQUEIO JUDICIAL (RENAJUD)', y);
  const restricoes = r.restricoes || r.lista || [];
  if (!restricoes.length && !r.tem_restricao) {
    y = boxPositivo(doc, y, 'Sem bloqueio judicial RENAJUD', 'Veiculo sem restricoes judiciais ativas registradas no CNJ.');
    return y;
  }
  y = linha(doc, 'Restricoes ativas', String(restricoes.length || (r.tem_restricao ? 1 : 0)), y, 13);
  restricoes.slice(0, 5).forEach((rr, i) => {
    if (rr.tribunal) y = linha(doc, `Tribunal ${i + 1}`, rr.tribunal, y, 13);
    if (rr.processo) y = linha(doc, `Processo ${i + 1}`, rr.processo, y, 13);
    if (rr.tipo_restricao) y = linha(doc, `Tipo ${i + 1}`, rr.tipo_restricao, y, 13);
  });
  return y + 6;
}

function blocoHistorico(doc, y, h) {
  if (!h) return y;
  if (!h.disponivel) return renderIndisponivel(doc, y, 'HISTORICO DE PROPRIETARIOS', h);

  const lista = h.proprietarios || [];
  y = secao(doc, 'HISTORICO DE PROPRIETARIOS', y);
  y = linha(doc, 'Total de donos', String(lista.length), y, 13);
  lista.slice(0, 8).forEach((p, i) => {
    const txt = [p.exercicio, p.uf_circulacao, p.municipio].filter(Boolean).join(' - ');
    y = linha(doc, `Proprietario ${i + 1}`, txt || '-', y, 13);
  });
  if (lista.length > 8) {
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(`+ ${lista.length - 8} registros adicionais omitidos`, MARGEM, y);
    y += 12;
  }
  return y + 6;
}

function blocoSinistro(doc, y, s) {
  if (!s) return y;
  if (!s.disponivel) return renderIndisponivel(doc, y, 'INDICIO DE SINISTRO', s);

  y = secao(doc, 'INDICIO DE SINISTRO', y);
  if (!s.tem_indicio) {
    y = boxPositivo(doc, y, 'Sem indicios de sinistro', 'Nenhum registro de batida grave, perda total ou avaria estrutural foi encontrado nas bases consultadas.');
    return y;
  }
  if (s.descricao) y = linha(doc, 'Descricao', s.descricao, y, 13);
  if (s.data) y = linha(doc, 'Data', s.data, y, 13);
  if (s.severidade) y = linha(doc, 'Severidade', s.severidade, y, 13);
  return y + 6;
}

function blocoVeiculoTotal(doc, y, vt) {
  if (!vt) return y;
  if (!vt.disponivel) return renderIndisponivel(doc, y, 'VEICULOTOTAL (PACOTE COMPLETO)', vt);

  // Identificação
  y = blocoIdentificacao(doc, y, vt.identificacao || vt);

  // Gravame
  if (vt.gravame) y = blocoGravame(doc, y, vt.gravame);

  // RENAINF
  if (vt.renainf) y = blocoRenainf(doc, y, vt.renainf);

  // RENAJUD
  if (vt.renajud) y = blocoRenajud(doc, y, vt.renajud);

  // Histórico
  if (vt.historico) y = blocoHistorico(doc, y, vt.historico);

  // Sinistro
  if (vt.sinistro) y = blocoSinistro(doc, y, vt.sinistro);

  // Roubo / Furto
  if (vt.roubo_furto) {
    y = secao(doc, 'ROUBO / FURTO', y);
    if (vt.roubo_furto.tem_registro) {
      y = avisoBox(doc, y, 'ATENCAO: veiculo consta em registro de roubo/furto. Verificar imediatamente com a delegacia.', '#fee2e2');
    } else {
      y = boxPositivo(doc, y, 'Sem registros de roubo/furto', 'Nada consta nas bases consultadas pela Credify.');
    }
  }

  // Leilão
  if (vt.leilao) {
    y = secao(doc, 'BASES DE LEILAO', y);
    if (vt.leilao.tem_registro) {
      y = avisoBox(doc, y, 'Veiculo aparece em base de leilao. Pode indicar sinistro grave, salvado ou recuperacao de seguradora.', '#fef3c7');
      if (vt.leilao.tipo) y = linha(doc, 'Tipo', vt.leilao.tipo, y, 13);
      if (vt.leilao.data) y = linha(doc, 'Data', vt.leilao.data, y, 13);
    } else {
      y = boxPositivo(doc, y, 'Veiculo nao consta em leiloes', 'Sem registros de venda em leilao de sinistro/salvado/recuperacao.');
    }
  }

  // Recall
  if (vt.recall) {
    y = secao(doc, 'RECALL DO FABRICANTE', y);
    if (vt.recall.tem_pendencia) {
      y = linha(doc, 'Recalls pendentes', String(vt.recall.quantidade || 1), y, 13);
      if (vt.recall.descricao) y = linha(doc, 'Descricao', vt.recall.descricao, y, 13);
    } else {
      y = boxPositivo(doc, y, 'Sem recalls pendentes', 'Veiculo em dia com a campanha do fabricante.');
    }
  }

  // FIPE
  if (vt.fipe) {
    y = secao(doc, 'AVALIACAO FIPE', y);
    if (vt.fipe.valor) y = linha(doc, 'Valor FIPE', `R$ ${Number(vt.fipe.valor).toFixed(2).replace('.', ',')}`, y, 13);
    if (vt.fipe.codigo) y = linha(doc, 'Codigo FIPE', vt.fipe.codigo, y, 13);
    if (vt.fipe.mes_referencia) y = linha(doc, 'Mes referencia', vt.fipe.mes_referencia, y, 13);
  }

  return y + 4;
}

function parecerFinal(doc, y, dados, tipo) {
  y = secao(doc, 'PARECER E PROXIMOS PASSOS', y);

  const alertasCriticos = [];
  const alertasObs = [];

  // Coleta de sinais (vale tanto para Simples/Mediano quanto para Completo)
  const g = dados.gravame || dados.veiculo_total?.gravame;
  const r = dados.renajud || dados.veiculo_total?.renajud;
  const s = dados.sinistro || dados.veiculo_total?.sinistro;
  const rf = dados.veiculo_total?.roubo_furto;
  const leilao = dados.veiculo_total?.leilao;
  const renainf = dados.renainf || dados.veiculo_total?.renainf;

  if (g?.disponivel && g.tem_gravame !== false && (g.tipo || g.financeira)) {
    alertasCriticos.push(`Veiculo possui gravame ativo${g.tipo ? ` (${g.tipo})` : ''}. Confirmar quitacao antes de transferir.`);
  }
  if (r?.disponivel && (r.restricoes?.length || r.tem_restricao)) {
    alertasCriticos.push('Bloqueio judicial RENAJUD ativo - transferencia pode ser impedida no DETRAN.');
  }
  if (s?.disponivel && s.tem_indicio) {
    alertasCriticos.push('Indicios de sinistro encontrados - exigir laudo cautelar antes da compra.');
  }
  if (rf?.tem_registro) {
    alertasCriticos.push('Veiculo aparece em registro de roubo/furto - NAO PROSSEGUIR sem acionar autoridades.');
  }
  if (leilao?.tem_registro) {
    alertasCriticos.push('Veiculo passou por leilao - alta probabilidade de sinistro grave/salvado.');
  }
  const qtdMultas = renainf?.quantidade ?? renainf?.total ?? (renainf?.multas?.length || 0);
  if (renainf?.disponivel && qtdMultas > 0) {
    alertasObs.push(`${qtdMultas} multa(s) RENAINF em aberto - negociar quitacao na compra.`);
  }

  if (alertasCriticos.length === 0 && alertasObs.length === 0) {
    y = boxPositivo(doc, y, 'Sem alertas criticos identificados',
      'Os dados consultados nao apontam restricoes graves. Ainda assim, recomendamos vistoria fisica antes de fechar o negocio.');
  } else {
    alertasCriticos.forEach(t => { y = renderAlerta(doc, y, { texto: t, severidade: 'critico' }); });
    alertasObs.forEach(t => { y = renderAlerta(doc, y, { texto: t, severidade: 'atencao' }); });
  }

  // Informa o que NAO esta incluido neste pacote
  if (tipo === 'consulta_veicular_simples') {
    y = boxEmIntegracao(doc, y, 'Quer mais cobertura?',
      'O pacote Mediano (R$ 39) acrescenta RENAJUD, historico de proprietarios e indicios de sinistro. O Completo (R$ 79) inclui tambem leilao, roubo/furto, recall e FIPE.');
  } else if (tipo === 'consulta_veicular_mediana') {
    y = boxEmIntegracao(doc, y, 'Compra de alto valor?',
      'O pacote Completo (R$ 79) inclui consulta em bases de leilao, roubo/furto, recall do fabricante e avaliacao FIPE - cobertura total para decisoes que nao admitem erro.');
  }

  return y + 4;
}

function blocoLGPD(doc, y, pedido) {
  y = verificarPagina(doc, y, 60);
  doc.rect(MARGEM, y, LARGURA, 50).fill('#f9fafb');
  doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Bold').text('CONFORMIDADE LGPD', MARGEM + 8, y + 6);
  doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica').text(
    `Finalidade declarada: ${pedido.finalidade || '-'}. Aceite dos termos: ${pedido.aceite_termos ? 'Sim' : 'Nao'}.`,
    MARGEM + 8, y + 18, { width: LARGURA - 16 }
  );
  doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica').text(
    'Fonte de dados: Credify (catalogo veicular). Documento informativo - nao substitui inspecao tecnica veicular nem analise juridica.',
    MARGEM + 8, y + 30, { width: LARGURA - 16 }
  );
  return y + 56;
}

function render(doc, pedido, dados, score, checklist, produto) {
  const tipo = pedido.tipo;
  let y = chrome.cabecalho(doc, pedido, produto);

  // Faixa do pacote
  doc.rect(MARGEM, y, LARGURA, 22).fill(COR.azul_claro);
  doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text(rotuloPacote(tipo), MARGEM, y + 6, { width: LARGURA, align: 'center' });
  y += 30;

  // Alvo
  y = secao(doc, 'ALVO DA CONSULTA', y);
  y = linha(doc, 'Placa', pedido.alvo_placa || '-', y, 14);
  y = linha(doc, 'Solicitante', pedido.cliente_nome, y, 14);
  if (pedido.cliente_email) y = linha(doc, 'Email', pedido.cliente_email, y, 14);

  // O orquestrador (services/consultas.js) retorna chaves de topo:
  //   Simples/Mediano: { placa, pacote, veicular, gravame, renainf, [renajud, historico, sinistro] }
  //   Completo:        { placa, pacote, veiculo_total }
  // routes/pedidos.js grava cada chave de topo como uma row em dados_consulta (fonte = chave).
  // services/pdf/index.js#montarDados reconstroi: dados[fonte] = JSON parsed.
  // Logo, podemos ler diretamente dados.veicular, dados.gravame, dados.veiculo_total, etc.
  const cv = dados;

  if (tipo === 'consulta_veicular_completa') {
    y = blocoVeiculoTotal(doc, y, cv.veiculo_total);
  } else if (tipo === 'consulta_veicular_simples') {
    y = blocoIdentificacao(doc, y, cv.veicular);
    y = blocoGravame(doc, y, cv.gravame);
    y = blocoRenainf(doc, y, cv.renainf);
  } else if (tipo === 'consulta_veicular_mediana') {
    y = blocoIdentificacao(doc, y, cv.veicular);
    y = blocoGravame(doc, y, cv.gravame);
    y = blocoRenainf(doc, y, cv.renainf);
    y = blocoRenajud(doc, y, cv.renajud);
    y = blocoHistorico(doc, y, cv.historico);
    y = blocoSinistro(doc, y, cv.sinistro);
  }

  y = parecerFinal(doc, y, cv, tipo);
  y = blocoLGPD(doc, y, pedido);
}

module.exports = { render };
