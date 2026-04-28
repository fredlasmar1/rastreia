/**
 * services/pdf/sections.js
 *
 * Seções reutilizáveis por múltiplos dossiês (não são o "chrome"
 * de topo/rodapé; são blocos intermediários reaproveitados). Cada
 * função recebe `(doc, y, dados, pedido)` e devolve o novo y.
 */

const {
  COR, MARGEM, LARGURA,
  formatarDoc, verificarPagina,
  secao, linha, avisoBox, boxPositivo,
  truncar, isAlvoNoPolo, construirResumoJudicial, parseValorCausa, formatarBRL
} = require('./helpers');

// ───────────────────────────────────────────────────────────────
// Dados cadastrais PJ (Receita Federal via CNPJa)
// ───────────────────────────────────────────────────────────────
function secaoCadastralPJ(doc, y, dados) {
  const cadastral = dados.receita_federal || {};
  y = secao(doc, 'DADOS CADASTRAIS - RECEITA FEDERAL', y);

  if (!cadastral.razao_social) {
    return avisoBox(doc, y, 'Dados cadastrais não retornados pela API. Verifique CNPJA_API_KEY.');
  }

  y = linha(doc, 'Razão Social', cadastral.razao_social, y, 13);
  if (cadastral.nome_fantasia) y = linha(doc, 'Nome Fantasia', cadastral.nome_fantasia, y, 13);
  y = linha(doc, 'CNPJ', cadastral.cnpj_formatado || cadastral.cnpj, y, 13);
  y = linha(doc, 'Situação RF', cadastral.situacao || '-', y, 13);
  y = linha(doc, 'Abertura', cadastral.data_abertura || '-', y, 13);
  y = linha(doc, 'Porte', cadastral.porte || '-', y, 13);
  y = linha(doc, 'Capital Social', cadastral.capital_social ? `R$ ${Number(cadastral.capital_social).toLocaleString('pt-BR')}` : '-', y, 13);
  y = linha(doc, 'Atividade', cadastral.atividade_principal || '-', y, 13);
  if (cadastral.simples_nacional) y = linha(doc, 'Simples Nacional', cadastral.simples_nacional, y, 13);
  y = linha(doc, 'Endereço', cadastral.endereco || '-', y, 13);
  if (cadastral.email) y = linha(doc, 'Email', cadastral.email, y, 13);
  if (cadastral.telefone) y = linha(doc, 'Telefone', cadastral.telefone, y, 13);

  if (cadastral.socios?.length > 0) {
    y += 4;
    doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('QUADRO SOCIETÁRIO', MARGEM, y); y += 14;
    cadastral.socios.forEach((s, i) => {
      y = verificarPagina(doc, y, 22);
      doc.rect(MARGEM, y, LARGURA, 20).fill(i % 2 === 0 ? '#f9fafb' : '#ffffff');
      doc.fillColor('#111827').fontSize(8).font('Helvetica-Bold').text(s.nome, MARGEM + 6, y + 3);
      doc.font('Helvetica').fillColor(COR.cinza).text(`${s.qualificacao || ''}  |  Desde: ${s.desde || 'N/D'}`, MARGEM + 6, y + 12);
      y += 22;
    });
  }
  return y + 8;
}

// ───────────────────────────────────────────────────────────────
// Regime tributário PJ como bloco próprio (para Dossiê PJ e Due Dil)
// ───────────────────────────────────────────────────────────────
function secaoRegimeTributario(doc, y, dados) {
  const cadastral = dados.receita_federal || {};
  if (!cadastral.razao_social) return y;

  y = secao(doc, 'REGIME TRIBUTÁRIO', y);
  const optante = cadastral.simples_nacional || cadastral.simples || 'Não informado';
  const mei = (cadastral.mei === true || cadastral.mei === 'Sim') ? 'Sim' : (cadastral.mei === false || cadastral.mei === 'Nao' || cadastral.mei === 'Não') ? 'Não' : 'Não informado';
  y = linha(doc, 'Simples Nacional', optante, y, 13);
  y = linha(doc, 'MEI', mei, y, 13);
  y = linha(doc, 'Regime', cadastral.regime_tributario || 'Lucro Real/Presumido - verificar contabilidade', y, 13);
  if (cadastral.data_opcao_simples) y = linha(doc, 'Opção Simples', cadastral.data_opcao_simples, y, 13);
  return y + 6;
}

// ───────────────────────────────────────────────────────────────
// Dados cadastrais PF (DirectData)
// ───────────────────────────────────────────────────────────────
function secaoCadastralPF(doc, y, dados) {
  const cadastral = dados.receita_federal || {};
  y = secao(doc, 'DADOS CADASTRAIS - PESSOA FÍSICA', y);

  if (cadastral.aviso) {
    // Aviso destacado em vermelho para falhas operacionais críticas (saldo/token/quota)
    const cat = cadastral.falha_categoria;
    if (cat === 'saldo' || cat === 'token' || cat === 'quota') {
      y = verificarPagina(doc, y, 60);
      doc.rect(MARGEM, y, LARGURA, 54).fill('#fee2e2');
      doc.fillColor(COR.vermelho).fontSize(10).font('Helvetica-Bold').text('CONSULTA PARCIAL - FALHA OPERACIONAL', MARGEM + 8, y + 6);
      doc.fillColor('#7f1d1d').fontSize(8).font('Helvetica-Bold').text(cadastral.aviso, MARGEM + 8, y + 20, { width: LARGURA - 16 });
      doc.fillColor('#7f1d1d').fontSize(7).font('Helvetica').text(`Ação recomendada: ${cadastral.instrucao || 'contatar o administrador da plataforma'}`, MARGEM + 8, y + 34, { width: LARGURA - 16 });
      doc.fillColor('#7f1d1d').fontSize(7).font('Helvetica-Oblique').text('Este dossiê foi gerado sem os dados cadastrais completos. As demais seções podem apresentar informações parciais ou ausentes em cascata.', MARGEM + 8, y + 44, { width: LARGURA - 16 });
      return y + 60;
    }
    return avisoBox(doc, y, `${cadastral.aviso} ${cadastral.instrucao || ''}`);
  }
  if (!cadastral.nome && cadastral.erro) {
    return avisoBox(doc, y, 'Dados cadastrais indisponíveis. API retornou erro. Verifique DIRECTD_TOKEN.');
  }
  if (!cadastral.nome) {
    return avisoBox(doc, y, 'Dados cadastrais não retornados. Configure DIRECTD_TOKEN.');
  }

  y = linha(doc, 'Nome', cadastral.nome, y, 13);
  y = linha(doc, 'CPF', cadastral.cpf_formatado || formatarDoc(cadastral.cpf), y, 13);
  if (cadastral.data_nascimento) y = linha(doc, 'Nascimento', cadastral.data_nascimento, y, 13);
  if (cadastral.idade) y = linha(doc, 'Idade', `${cadastral.idade} anos`, y, 13);
  if (cadastral.sexo) y = linha(doc, 'Sexo', cadastral.sexo, y, 13);
  if (cadastral.nome_mae) y = linha(doc, 'Mãe', cadastral.nome_mae, y, 13);
  if (cadastral.nome_pai) y = linha(doc, 'Pai', cadastral.nome_pai, y, 13);
  y = linha(doc, 'Situação RF', cadastral.situacao_rf || '-', y, 13);
  if (cadastral.obito) {
    y = verificarPagina(doc, y, 18);
    doc.rect(MARGEM, y, LARGURA, 16).fill('#fee2e2');
    doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold').text('REGISTRO DE ÓBITO ENCONTRADO', MARGEM + 6, y + 3);
    y += 20;
  }
  if (cadastral.profissao) y = linha(doc, 'Profissão (CBO)', cadastral.profissao, y, 13);
  if (cadastral.classe_social) y = linha(doc, 'Classe Social', cadastral.classe_social, y, 13);
  if (cadastral.renda_estimada) {
    const rotulo = cadastral.renda_inconsistente ? 'Renda Estimada (inconsistente)' : 'Renda Estimada';
    const valor = cadastral.renda_inconsistente ? `${cadastral.renda_estimada} - descartada do score` : cadastral.renda_estimada;
    y = linha(doc, rotulo, valor, y, 13);
  }

  if (cadastral.parentescos?.length > 0) {
    const nomes = cadastral.parentescos.map(p => p.nome + (p.tipo ? ` (${p.tipo})` : '')).join('  |  ');
    const h = doc.heightOfString(nomes, { width: LARGURA - 12, fontSize: 7 });
    y = verificarPagina(doc, y, h + 16);
    y += 2;
    doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('VÍNCULOS FAMILIARES', MARGEM, y); y += 10;
    doc.fillColor('#111827').fontSize(7).font('Helvetica').text(nomes, MARGEM + 6, y, { width: LARGURA - 12 });
    y += h + 4;
  }
  if (cadastral.enderecos?.length > 0) {
    y = verificarPagina(doc, y, 12 + cadastral.enderecos.length * 10);
    doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('ENDEREÇOS', MARGEM, y); y += 10;
    cadastral.enderecos.forEach((e, i) => {
      y = verificarPagina(doc, y, 11);
      const end = [e.logradouro, e.numero, e.bairro, e.cidade, e.uf, e.cep].filter(Boolean).join(', ');
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`${i + 1}. ${end}`, MARGEM + 6, y, { width: LARGURA - 12 });
      y += 10;
    });
    y += 2;
  }
  if (cadastral.telefones?.length > 0) {
    y = verificarPagina(doc, y, 12 + cadastral.telefones.length * 9);
    doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('TELEFONES', MARGEM, y); y += 10;
    cadastral.telefones.forEach(t => {
      y = verificarPagina(doc, y, 10);
      const wpp = t.whatsapp ? ' [WPP]' : '';
      const info = [t.numero, t.tipo, t.operadora].filter(Boolean).join(' - ');
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${info}${wpp}`, MARGEM + 6, y);
      y += 9;
    });
    y += 2;
  }
  if (cadastral.emails?.length > 0) {
    y = verificarPagina(doc, y, 12);
    const emailsTxt = cadastral.emails.join('  |  ');
    doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('EMAILS', MARGEM, y);
    doc.fillColor('#111827').font('Helvetica').fontSize(7).text(emailsTxt, MARGEM + 50, y);
    y += 10;
  }
  return y + 4;
}

// ───────────────────────────────────────────────────────────────
// Processos judiciais (compartilhado por PF/PJ/Due Dil/Investigação/Devedor)
// ───────────────────────────────────────────────────────────────
function secaoProcessos(doc, y, dados, pedido) {
  const processos = dados.processos || {};
  y = secao(doc, 'PROCESSOS JUDICIAIS', y);
  const totalP = processos.total || 0;

  if (totalP === 0 && processos.escavador_falhou) {
    doc.rect(MARGEM, y, LARGURA, 30).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(9).font('Helvetica-Bold').text('Consulta de processos indisponível.', MARGEM + 8, y + 4);
    doc.fillColor('#92400e').fontSize(7).font('Helvetica').text(`Escavador retornou ${processos.escavador_status_http || 'erro'}: ${processos.escavador_detalhes || 'falha na autenticação/token'}. Datajud (TJGO/TRF1/STJ/TST) também vazio. Recomenda-se reexecutar a consulta após corrigir o token do Escavador.`, MARGEM + 8, y + 16, { width: LARGURA - 16 });
    y += 40;
  } else if (totalP === 0) {
    doc.rect(MARGEM, y, LARGURA, 24).fill('#dcfce7');
    doc.fillColor('#14532d').fontSize(9).font('Helvetica').text('Nenhum processo encontrado nas bases consultadas.', MARGEM + 8, y + 6);
    y += 30;
  } else {
    const lista = processos.processos || [];
    const ativos = lista.filter(p => p.status === 'Ativo');
    const inativos = lista.filter(p => p.status !== 'Ativo');

    const resumoJudicial = construirResumoJudicial(lista, pedido.alvo_documento, pedido.alvo_nome);

    doc.rect(MARGEM, y, LARGURA, 24).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(10).font('Helvetica-Bold').text(`${totalP} processo(s) encontrado(s)`, MARGEM + 8, y + 5);
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(`Fonte: ${processos.fonte || 'Datajud CNJ'}`, MARGEM + LARGURA - 150, y + 8);
    y += 28;

    const excluidos = processos.excluidos_advogado || 0;
    let resumoCount = `${ativos.length} ativo(s) | ${inativos.length} baixado(s)/inativo(s)`;
    if (excluidos > 0) resumoCount += ` | ${excluidos} excluído(s) (como advogado)`;
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(resumoCount, MARGEM + 8, y);
    y += 11;

    if (resumoJudicial) {
      doc.font('Helvetica').fontSize(8);
      const hRes = doc.heightOfString(resumoJudicial, { width: LARGURA - 16 });
      y = verificarPagina(doc, y, hRes + 14);
      doc.rect(MARGEM, y, LARGURA, hRes + 10).fill('#f9fafb').stroke(COR.borda);
      doc.fillColor('#111827').fontSize(8).font('Helvetica').text(resumoJudicial, MARGEM + 8, y + 5, { width: LARGURA - 16 });
      y += hRes + 14;
    }

    y = verificarPagina(doc, y, 18);
    doc.rect(MARGEM, y, LARGURA, 14).fill(COR.azul);
    doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
    doc.text('Número / Classe', MARGEM + 6, y + 4, { width: 200, lineBreak: false });
    doc.text('Polo / Valor', MARGEM + 210, y + 4, { width: 170, lineBreak: false });
    doc.text('Tribunal', MARGEM + 385, y + 4, { width: 60, lineBreak: false });
    doc.text('Status', MARGEM + LARGURA - 50, y + 4, { width: 50, lineBreak: false, align: 'right' });
    y += 16;

    lista.slice(0, 15).forEach((proc, i) => {
      const numeroTxt = proc.numero || 'Processo sem n. CNJ';
      const classeTxt = [proc.classe, proc.assunto].filter(Boolean).join(' · ') || '-';
      const poloAtivoDoAlvo = isAlvoNoPolo(proc.polo_ativo, pedido.alvo_documento, pedido.alvo_nome);
      const poloPassivoDoAlvo = isAlvoNoPolo(proc.polo_passivo, pedido.alvo_documento, pedido.alvo_nome);
      const papel = poloAtivoDoAlvo ? 'Autor' : poloPassivoDoAlvo ? 'Réu' : 'Parte';
      const parteContra = poloAtivoDoAlvo
        ? (proc.polo_passivo || 'outra parte')
        : poloPassivoDoAlvo ? (proc.polo_ativo || 'outra parte')
        : (proc.polo_ativo || proc.polo_passivo || '-');
      const poloLabel = `${papel} vs ${truncar(parteContra, 40)}`;
      const valorTxt = proc.valor_causa || '-';
      const dataTxt = proc.data_inicio ? `Ajuiz: ${proc.data_inicio}` : '';
      const ultMovTxt = proc.ultima_movimentacao ? `Últ. mov: ${proc.ultima_movimentacao}` : '';

      const hLinha = 32;
      y = verificarPagina(doc, y, hLinha);

      const corStatus = proc.status === 'Ativo' ? COR.vermelho : COR.verde;
      const fundo = i % 2 === 0 ? '#ffffff' : '#f9fafb';
      doc.rect(MARGEM, y, LARGURA, hLinha).fill(fundo);
      doc.rect(MARGEM, y, 3, hLinha).fill(corStatus);

      doc.fillColor(COR.azul).fontSize(7).font('Helvetica-Bold').text(numeroTxt, MARGEM + 8, y + 3, { width: 200, lineBreak: false });
      doc.fillColor('#111827').fontSize(6.5).font('Helvetica').text(truncar(classeTxt, 60), MARGEM + 8, y + 13, { width: 200, lineBreak: false });
      if (dataTxt || ultMovTxt) {
        doc.fillColor(COR.cinza).fontSize(6).font('Helvetica').text([dataTxt, ultMovTxt].filter(Boolean).join(' | '), MARGEM + 8, y + 22, { width: 200, lineBreak: false });
      }

      doc.fillColor('#111827').fontSize(6.5).font('Helvetica-Bold').text(truncar(poloLabel, 48), MARGEM + 210, y + 3, { width: 170, lineBreak: false });
      if (valorTxt && valorTxt !== '-') {
        doc.fillColor(COR.cinza).fontSize(6).font('Helvetica').text(`Valor causa: ${valorTxt}`, MARGEM + 210, y + 13, { width: 170, lineBreak: false });
      }

      doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica').text(proc.tribunal || '-', MARGEM + 385, y + 3, { width: 60, lineBreak: false });
      doc.fillColor(corStatus).fontSize(7).font('Helvetica-Bold').text(proc.status === 'Ativo' ? 'ATIVO' : 'BAIXADO', MARGEM + LARGURA - 50, y + 3, { width: 50, align: 'right', lineBreak: false });
      y += hLinha + 1;
    });

    if (lista.length > 15) {
      y = verificarPagina(doc, y, 14);
      doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique').text(`(+${lista.length - 15} processo(s) adicional/is não exibido/s nesta tabela)`, MARGEM + 8, y);
      y += 12;
    }
  }

  if (processos.aviso) {
    doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text(`Atenção: ${processos.aviso}`, MARGEM, y, { width: LARGURA });
    y += 14;
  }
  if (processos.nota) {
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique').text(processos.nota, MARGEM, y, { width: LARGURA });
    const h = doc.heightOfString(processos.nota, { width: LARGURA, fontSize: 7 });
    y += h + 4;
  }
  return y + 6;
}

// ───────────────────────────────────────────────────────────────
// Listas negras CGU
// ───────────────────────────────────────────────────────────────
function secaoListasNegras(doc, y, dados) {
  const transparencia = dados.transparencia || {};
  if (transparencia.em_lista_negra === undefined) return y;

  y = secao(doc, 'LISTAS NEGRAS FEDERAIS (CGU)', y);
  if (transparencia.em_lista_negra) {
    doc.rect(MARGEM, y, LARGURA, 20).fill('#fee2e2');
    doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold').text('CONSTA EM LISTA NEGRA FEDERAL', MARGEM + 8, y + 4);
    y += 26;
    const todos = [...(transparencia.ceis || []), ...(transparencia.cnep || [])];
    todos.forEach(r => {
      y = verificarPagina(doc, y, 18);
      doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text(`${r.tipo}: ${r.sancao}`, MARGEM + 6, y);
      doc.fillColor(COR.cinza).font('Helvetica').text(`Órgão: ${r.orgao}`, MARGEM + 6, y + 9);
      y += 20;
    });
  } else {
    doc.rect(MARGEM, y, LARGURA, 20).fill('#dcfce7');
    doc.fillColor('#14532d').fontSize(9).font('Helvetica').text('Não consta em lista negra federal (CEIS/CNEP).', MARGEM + 8, y + 4);
    y += 26;
  }
  return y;
}

// ───────────────────────────────────────────────────────────────
// Bloco estendido de listas negras para PJ (detalha CEIS/CNEP/CEPIM)
// ───────────────────────────────────────────────────────────────
function secaoListasNegrasDetalhadas(doc, y, dados) {
  const transparencia = dados.transparencia || {};
  if (transparencia.em_lista_negra === undefined) return y;

  y = secao(doc, 'LISTAS NEGRAS FEDERAIS (CGU / CEIS / CNEP / CEPIM)', y);

  const ceis = transparencia.ceis || [];
  const cnep = transparencia.cnep || [];
  const cepim = transparencia.cepim || [];

  if (!transparencia.em_lista_negra && ceis.length === 0 && cnep.length === 0 && cepim.length === 0) {
    return boxPositivo(doc, y, 'NADA CONSTA', 'Não localizado em CEIS (Cadastro de Empresas Inidôneas), CNEP (Cadastro Nacional de Empresas Punidas) nem CEPIM (Entidades Privadas sem fins lucrativos impedidas).');
  }

  y = verificarPagina(doc, y, 20);
  doc.rect(MARGEM, y, LARGURA, 18).fill('#fee2e2');
  doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold').text(`${ceis.length + cnep.length + cepim.length} registro(s) em listas federais`, MARGEM + 8, y + 4);
  y += 22;

  const renderLista = (titulo, itens) => {
    if (!itens.length) return;
    y = verificarPagina(doc, y, 16);
    doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica-Bold').text(`${titulo} (${itens.length})`, MARGEM, y); y += 11;
    itens.forEach(r => {
      y = verificarPagina(doc, y, 22);
      doc.rect(MARGEM, y, LARGURA, 20).fill('#fef2f2');
      doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text(r.sancao || r.tipo || '-', MARGEM + 6, y + 3, { width: LARGURA - 12 });
      const info = [r.orgao, r.inicio, r.fim].filter(Boolean).join(' | ');
      doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica').text(info || '-', MARGEM + 6, y + 12, { width: LARGURA - 12 });
      y += 22;
    });
  };

  renderLista('CEIS - Inidôneas', ceis);
  renderLista('CNEP - Punidas', cnep);
  renderLista('CEPIM - Entidades sem fins lucrativos impedidas', cepim);
  return y + 4;
}

// ───────────────────────────────────────────────────────────────
// Score QUOD (crédito) — usado em PF e Devedor
// ───────────────────────────────────────────────────────────────
function secaoScoreCredito(doc, y, dados) {
  const scoreCredito = dados.score_credito || {};
  if (!scoreCredito.score) return y;

  y = secao(doc, 'SCORE DE CRÉDITO (QUOD)', y);
  const scoreCred = Number(scoreCredito.score) || 0;
  const corCred = scoreCred >= 700 ? COR.verde : scoreCred >= 400 ? COR.laranja : COR.vermelho;
  doc.rect(MARGEM, y, LARGURA, 40).fill('#f8fafc').stroke(COR.borda);
  doc.fillColor(corCred).fontSize(22).font('Helvetica-Bold').text(`${scoreCred}`, MARGEM + 10, y + 4);
  doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text('/1000', MARGEM + 55, y + 10);
  doc.fillColor(corCred).fontSize(10).font('Helvetica-Bold').text(scoreCredito.faixa || '', MARGEM + 100, y + 6);
  if (scoreCredito.motivos?.length > 0) {
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica');
    scoreCredito.motivos.slice(0, 3).forEach((m, i) => {
      doc.text(`- ${m}`, MARGEM + 100, y + 20 + (i * 9), { width: 380 });
    });
  }
  return y + 44 + Math.min((scoreCredito.motivos?.length || 0), 3) * 9;
}

// ───────────────────────────────────────────────────────────────
// Protestos e negativações (DirectData)
// ───────────────────────────────────────────────────────────────
function secaoProtestos(doc, y, dados) {
  const negativacoes = dados.negativacoes || {};
  y = secao(doc, 'PROTESTOS E NEGATIVAÇÕES', y);

  if (!negativacoes.status || negativacoes.status === 'Nao consultado' || negativacoes.status === 'Não consultado') {
    doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text('Consulta de protestos/negativações não realizada.', MARGEM, y);
    return y + 16;
  }

  const temPendencia = negativacoes.total_pendencias > 0 || negativacoes.status === 'Consta Pendencia' || negativacoes.status === 'Consta Pendência';
  if (!temPendencia) {
    doc.rect(MARGEM, y, LARGURA, 18).fill('#dcfce7');
    doc.fillColor('#14532d').fontSize(8).font('Helvetica-Bold').text('NADA CONSTA - Nenhum protesto ou negativação encontrada.', MARGEM + 8, y + 4);
    return y + 26;
  }

  const valorTotal = Number(negativacoes.total_pendencias || 0);
  doc.rect(MARGEM, y, LARGURA, 18).fill('#fee2e2');
  doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica-Bold')
    .text(`CONSTA PENDÊNCIA | Valor total: R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, MARGEM + 8, y + 4);
  y += 22;

  if (negativacoes.protestos?.length > 0) {
    doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text('PROTESTOS EM CARTÓRIO:', MARGEM, y); y += 10;
    negativacoes.protestos.slice(0, 8).forEach(p => {
      y = verificarPagina(doc, y, 14);
      doc.rect(MARGEM, y, 3, 10).fill(COR.vermelho);
      doc.fillColor('#111827').fontSize(6.5).font('Helvetica-Bold').text(`${p.nome_cartorio || 'Cartório'}`, MARGEM + 8, y);
      doc.fillColor(COR.cinza).font('Helvetica').fontSize(6).text(`R$ ${Number(p.valor_total_protesto || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | ${p.situacao || ''}`, MARGEM + 250, y);
      y += 12;
      (p.titulos || []).slice(0, 3).forEach(t => {
        y = verificarPagina(doc, y, 10);
        doc.fillColor(COR.cinza).fontSize(5.5).font('Helvetica')
          .text(`    ${t.tipo || 'Título'} - R$ ${Number(t.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} - ${t.data || ''}`, MARGEM + 16, y);
        y += 9;
      });
    });
    y += 4;
  }

  if (negativacoes.acoes_judiciais?.length > 0) {
    doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text('AÇÕES JUDICIAIS:', MARGEM, y); y += 10;
    negativacoes.acoes_judiciais.slice(0, 5).forEach(a => {
      y = verificarPagina(doc, y, 10);
      doc.fillColor('#111827').fontSize(6.5).font('Helvetica')
        .text(`- ${a.tipo || 'Ação'} | R$ ${Number(a.valor || 0).toLocaleString('pt-BR')} | ${a.data || ''}`, MARGEM + 8, y);
      y += 10;
    });
    y += 4;
  }

  if (negativacoes.cheques_sem_fundo?.length > 0) {
    doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text('CHEQUES SEM FUNDO:', MARGEM, y); y += 10;
    negativacoes.cheques_sem_fundo.slice(0, 3).forEach(c => {
      doc.fillColor('#111827').fontSize(6.5).font('Helvetica')
        .text(`- Banco: ${c.banco || ''} | Ag: ${c.agencia || ''} | ${c.data || ''}`, MARGEM + 8, y);
      y += 10;
    });
    y += 4;
  }
  doc.fillColor(COR.cinza).fontSize(5.5).font('Helvetica').text(`Fonte: ${negativacoes.fonte || 'Direct Data'}`, MARGEM, y);
  return y + 12;
}

// ───────────────────────────────────────────────────────────────
// Vínculos societários (empresas do alvo)
// ───────────────────────────────────────────────────────────────
function secaoVinculosSocietarios(doc, y, dados) {
  const vinculos = dados.vinculos || {};
  if (!vinculos.total) return y;

  y = secao(doc, 'VÍNCULOS SOCIETÁRIOS', y);
  doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(`${vinculos.total} empresa(s) vinculada(s)`, MARGEM, y); y += 14;
  (vinculos.empresas || []).slice(0, 10).forEach((emp, i) => {
    y = verificarPagina(doc, y, 24);
    doc.rect(MARGEM, y, LARGURA, 22).fill(i % 2 === 0 ? '#f9fafb' : '#ffffff');
    doc.fillColor(COR.azul).fontSize(7).font('Helvetica-Bold').text(emp.razao_social || 'N/D', MARGEM + 6, y + 3);
    const info = [emp.cnpj, emp.cargo, emp.situacao, emp.data_entrada ? `Desde: ${emp.data_entrada}` : ''].filter(Boolean).join('  |  ');
    doc.fillColor(COR.cinza).font('Helvetica').text(info, MARGEM + 6, y + 13, { width: LARGURA - 12 });
    y += 24;
  });
  doc.fillColor(COR.cinza).fontSize(6).font('Helvetica').text(`Fonte: ${vinculos.fonte || 'Direct Data'}`, MARGEM, y);
  return y + 12;
}

// ───────────────────────────────────────────────────────────────
// Checklist + Parecer do analista (pedido.observacoes)
// ───────────────────────────────────────────────────────────────
function secaoChecklist(doc, y, checklist) {
  if (!checklist || checklist.length === 0) return y;
  y = secao(doc, 'VERIFICAÇÕES COMPLEMENTARES', y);
  checklist.forEach(c => {
    y = verificarPagina(doc, y, 11);
    const prefixo = c.obrigatorio ? '[!]' : '[o]';
    const cor_item = c.obrigatorio ? COR.vermelho : COR.cinza;
    doc.fillColor(cor_item).fontSize(6).font('Helvetica-Bold').text(prefixo, MARGEM, y);
    doc.fillColor('#111827').font('Helvetica').fontSize(6.5).text(c.item, MARGEM + 20, y, { width: LARGURA - 20 });
    y += 11;
  });
  return y + 2;
}

function secaoParecerAnalista(doc, y, pedido) {
  if (!pedido.observacoes) return y;
  y = secao(doc, 'PARECER DO ANALISTA', y);
  doc.rect(MARGEM, y, LARGURA, 3).fill(COR.azul); y += 8;
  doc.fillColor('#111827').fontSize(9).font('Helvetica').text(pedido.observacoes, MARGEM, y, { width: LARGURA });
  return y + doc.heightOfString(pedido.observacoes, { width: LARGURA }) + 10;
}

// ───────────────────────────────────────────────────────────────
// Perfil financeiro consolidado (PF)
// ───────────────────────────────────────────────────────────────
function secaoPerfilFinanceiroPF(doc, y, dados) {
  const cadastral = dados.receita_federal || {};
  const perfilEco = dados.perfil_economico || {};
  const scoreCredito = dados.score_credito || {};
  const negativacoes = dados.negativacoes || {};
  const processos = dados.processos || {};

  if (!cadastral.renda_estimada && !scoreCredito.score) return y;

  y = secao(doc, 'PERFIL FINANCEIRO', y);

  const renda = cadastral.renda_inconsistente
    ? 0
    : (parseFloat(String(cadastral.renda_estimada || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0);
  const pendencias = Number(negativacoes.total_pendencias || 0);
  const scoreQ = Number(scoreCredito.score || 0);
  const totalProcessos = processos.total || 0;

  if (perfilEco.nivel_socioeconomico) y = linha(doc, 'Nível Socioeconômico', perfilEco.nivel_socioeconomico, y, 12);
  if (perfilEco.poder_aquisitivo) y = linha(doc, 'Poder Aquisitivo', perfilEco.poder_aquisitivo, y, 12);
  if (perfilEco.renda_presumida) y = linha(doc, 'Renda Presumida', `R$ ${Number(perfilEco.renda_presumida).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, y, 12);
  y += 2;

  let nivelEndividamento = 'Baixo';
  let corEndiv = COR.verde;
  if (pendencias > 0 && renda > 0) {
    const razao = pendencias / (renda * 12);
    if (razao > 5) { nivelEndividamento = 'Crítico (dívida > 5x renda anual)'; corEndiv = COR.vermelho; }
    else if (razao > 2) { nivelEndividamento = 'Alto (dívida > 2x renda anual)'; corEndiv = COR.vermelho; }
    else if (razao > 0.5) { nivelEndividamento = 'Moderado (dívida > 50% renda anual)'; corEndiv = COR.laranja; }
    else { nivelEndividamento = 'Baixo (dívida < 50% renda anual)'; corEndiv = COR.verde; }
  } else if (pendencias > 0) {
    nivelEndividamento = 'Possui pendências (renda não informada)';
    corEndiv = COR.laranja;
  } else {
    nivelEndividamento = 'Sem pendências financeiras';
    corEndiv = COR.verde;
  }

  y += 2;
  doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('ANÁLISE DE CAPACIDADE FINANCEIRA', MARGEM, y); y += 14;
  doc.fillColor(corEndiv).fontSize(8).font('Helvetica-Bold').text(`Endividamento: ${nivelEndividamento}`, MARGEM + 6, y); y += 12;

  let capacidade = 'Indeterminada';
  let corCap = COR.cinza;
  if (scoreQ >= 700 && pendencias === 0) { capacidade = 'ALTA - bom pagador, sem restrições'; corCap = COR.verde; }
  else if (scoreQ >= 500 && pendencias === 0) { capacidade = 'MÉDIA - score moderado, sem restrições'; corCap = COR.laranja; }
  else if (scoreQ >= 500) { capacidade = 'MÉDIA COM RESSALVAS - score ok mas possui pendências'; corCap = COR.laranja; }
  else if (scoreQ > 0) { capacidade = 'BAIXA - score ruim e/ou pendências ativas'; corCap = COR.vermelho; }
  doc.fillColor(corCap).fontSize(8).font('Helvetica-Bold').text(`Capacidade de Pagamento: ${capacidade}`, MARGEM + 6, y); y += 12;

  const processosAtivos = (processos.processos || []).filter(p => p.status === 'Ativo').length;
  const risco = processosAtivos > 5 ? 'ALTO' : processosAtivos > 0 ? 'MODERADO' : 'BAIXO';
  const corRisco = processosAtivos > 5 ? COR.vermelho : processosAtivos > 0 ? COR.laranja : COR.verde;
  doc.fillColor(corRisco).fontSize(8).font('Helvetica-Bold').text(`Risco Judicial: ${risco} (${processosAtivos} processo(s) ativo(s) de ${totalProcessos} total)`, MARGEM + 6, y);
  return y + 14;
}

module.exports = {
  secaoCadastralPJ, secaoRegimeTributario, secaoCadastralPF,
  secaoProcessos, secaoListasNegras, secaoListasNegrasDetalhadas,
  secaoScoreCredito, secaoProtestos, secaoVinculosSocietarios,
  secaoChecklist, secaoParecerAnalista, secaoPerfilFinanceiroPF
};
