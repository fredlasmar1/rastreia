/**
 * services/pdf/investigacao_patrimonial.js
 * Investigação Patrimonial (R$ 497).
 *
 * Seções exigidas pelo produto:
 *  1. Identificação e localização atual
 *  2. IMÓVEIS E BENS RAÍZES
 *  3. VEÍCULOS (próprios + empresas vinculadas)
 *  4. EMPRESAS E PARTICIPAÇÕES SOCIETÁRIAS
 *  5. VÍNCULOS E INTERPOSTAS PESSOAS
 *  6. PROCESSOS COMO RÉU (foco em execuções e penhoras)
 *  7. ESTRATÉGIA DE EXECUÇÃO com ordem de penhora
 *  8. CONCLUSÃO (viabilidade)
 */

const chrome = require('./chrome');
const {
  COR, MARGEM, LARGURA, verificarPagina,
  secao, linha, boxEmIntegracao, truncar, parseValorCausa, formatarBRL
} = require('./helpers');
const {
  secaoCadastralPF, secaoCadastralPJ,
  secaoProcessos, secaoProtestos,
  secaoVinculosSocietarios, secaoChecklist, secaoParecerAnalista
} = require('./sections');

// ─── Coleta unificada do patrimônio ───────────────────────────────
// Centraliza a leitura para que TODAS as seções (imóveis, veículos,
// estratégia, conclusão) enxerguem as mesmas listas, independentemente
// da fonte/forma. Evita que a estratégia conclua "inviável" enquanto a
// tabela de veículos mostra carros (bug de chave divergente).
function coletarPatrimonio(dados) {
  const fonteImoveis = dados.imoveis || {};
  const imoveis = (Array.isArray(fonteImoveis.itens) && fonteImoveis.itens)
    || (Array.isArray(fonteImoveis.imoveis) && fonteImoveis.imoveis)
    || [];

  let veiculos = [];
  for (const f of [dados.historico_veiculos_proprietario, dados.veiculos, dados.veiculos_pj]) {
    if (f && Array.isArray(f.veiculos) && f.veiculos.length) { veiculos = f.veiculos; break; }
  }

  const empresas = dados.vinculos?.empresas || [];
  return { imoveis, veiculos, empresas };
}

// ─── Imóveis ──────────────────────────────────────────────────────
function secaoImoveis(doc, y, dados) {
  // Aceita tanto a forma interna { itens } quanto a do ONR RI Digital { imoveis }.
  const fonteImoveis = dados.imoveis || {};
  const imoveis = (Array.isArray(fonteImoveis.itens) && fonteImoveis.itens)
    || (Array.isArray(fonteImoveis.imoveis) && fonteImoveis.imoveis)
    || [];
  y = secao(doc, 'IMÓVEIS E BENS RAÍZES', y);

  if (!imoveis.length) {
    return boxEmIntegracao(doc, y,
      'CONSULTA DE IMÓVEIS — Em integração',
      'Pesquisa de imóveis por CPF/CNPJ via ONR (Operador Nacional do Registro) em integração no próximo release. Para consulta imediata: certidão de atos em cartórios da(s) comarca(s) onde o investigado reside/atua.'
    );
  }

  doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(`${imoveis.length} imóvel(is) identificado(s)`, MARGEM, y); y += 12;
  let valorTotal = 0;
  imoveis.forEach(im => {
    y = verificarPagina(doc, y, 32);
    doc.rect(MARGEM, y, LARGURA, 30).fill('#f9fafb').stroke(COR.borda);
    doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text(truncar(im.descricao || im.endereco || 'Imóvel', 80), MARGEM + 8, y + 4, { width: LARGURA - 16 });
    const l2 = [im.matricula ? `Matr. ${im.matricula}` : null, im.cartorio, im.cidade, im.uf, im.tipo].filter(Boolean).join(' | ');
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(l2, MARGEM + 8, y + 15);
    if (im.valor_estimado) {
      valorTotal += Number(im.valor_estimado) || 0;
      doc.fillColor(COR.verde).fontSize(8).font('Helvetica-Bold').text(formatarBRL(im.valor_estimado), MARGEM + LARGURA - 110, y + 4, { width: 100, align: 'right' });
    }
    const emNomeDe = im.em_nome_de
      || (Array.isArray(im.proprietarios) && im.proprietarios.length
            ? im.proprietarios.map(p => typeof p === 'string' ? p : (p.nome || '')).filter(Boolean).join(', ')
            : '');
    const onus = Array.isArray(im.onus) ? im.onus.filter(Boolean) : [];
    let rodape = emNomeDe ? `Em nome de: ${emNomeDe}` : '';
    if (onus.length) rodape += `${rodape ? '  |  ' : ''}Ônus: ${onus.join(', ')}`;
    if (rodape) {
      doc.fillColor(onus.length ? COR.vermelho : COR.cinza).fontSize(6.5).font('Helvetica-Oblique').text(truncar(rodape, 130), MARGEM + 8, y + 22, { width: LARGURA - 16, lineBreak: false });
    }
    y += 32;
  });
  if (valorTotal > 0) {
    y += 4;
    doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text(`Valor total estimado: ${formatarBRL(valorTotal)}`, MARGEM, y);
    y += 14;
  }
  return y + 4;
}

// ─── Veículos (do investigado + empresas vinculadas) ───────────────
function secaoVeiculos(doc, y, dados) {
  // O patrimônio veicular pode vir de fontes diferentes conforme o fluxo:
  //  - historico_veiculos_proprietario: fluxo de consulta veicular por placa (DirectData)
  //  - veiculos: Investigação Patrimonial chama consultarVeiculos (DETRAN-GO/Infosimples)
  //  - veiculos_pj: patrimônio veicular de PJ (Due Diligence)
  // Cada fonte tem campos próprios; normalizamos abaixo para uma linha única.
  const fontes = [
    dados.historico_veiculos_proprietario,
    dados.veiculos,
    dados.veiculos_pj
  ].filter(Boolean);

  let veiculos = [];
  let fonteNome = '';
  let notaIndisponivel = '';
  for (const f of fontes) {
    const arr = Array.isArray(f.veiculos) ? f.veiculos : [];
    if (arr.length) { veiculos = arr; fonteNome = f.fonte || ''; break; }
    if (!notaIndisponivel && f.disponivel === false) {
      notaIndisponivel = f.nota || f.detalhes || f.erro || '';
    }
  }

  // Normaliza cada veículo para um shape comum (campos variam entre as fontes).
  const norm = veiculos.map(v => {
    const descricao = v.veiculo
      || [v.marca, v.modelo].filter(Boolean).join(' ')
      || '-';
    const ano = v.ano || v.ano_modelo || v.anoModelo || '';
    return {
      placa: v.placa || '-',
      descricao: ano && !String(descricao).includes(String(ano)) ? `${descricao} ${ano}` : descricao,
      renavam: v.renavam || '-',
      chassi: v.chassi || '-',
      situacao: v.situacao || v.situacaoVeiculo || '-',
      restricoes: Array.isArray(v.restricoes) ? v.restricoes.filter(Boolean) : []
    };
  });

  y = secao(doc, 'VEÍCULOS', y);

  if (!norm.length) {
    return boxEmIntegracao(doc, y,
      notaIndisponivel ? 'CONSULTA VEICULAR — sem retorno para este alvo' : 'CONSULTA VEICULAR POR CPF/CNPJ — Em integração',
      notaIndisponivel
        ? `${notaIndisponivel} Para consulta imediata: DETRAN do estado do alvo ou Credify /veiculodocumento.`
        : 'Listagem de veículos por documento via DETRAN-GO (Infosimples) / Credify. Nenhum veículo retornado para este alvo, ou fonte não configurada.'
    );
  }

  doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(`${norm.length} veículo(s) identificado(s)`, MARGEM, y);
  if (fonteNome) doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique').text(`Fonte: ${fonteNome}`, MARGEM + LARGURA - 200, y + 2, { width: 200, align: 'right' });
  y += 14;

  y = verificarPagina(doc, y, 18);
  doc.rect(MARGEM, y, LARGURA, 14).fill(COR.azul);
  doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
  doc.text('PLACA', MARGEM + 6, y + 4, { width: 52, lineBreak: false });
  doc.text('VEÍCULO', MARGEM + 60, y + 4, { width: 184, lineBreak: false });
  doc.text('RENAVAM', MARGEM + 248, y + 4, { width: 68, lineBreak: false });
  doc.text('CHASSI', MARGEM + 320, y + 4, { width: 94, lineBreak: false });
  doc.text('SITUAÇÃO', MARGEM + 418, y + 4, { width: 72, lineBreak: false });
  y += 14;

  let comRestricao = [];
  norm.slice(0, 20).forEach((v, i) => {
    y = verificarPagina(doc, y, 14);
    doc.rect(MARGEM, y, LARGURA, 13).fill(i % 2 === 0 ? '#ffffff' : '#f9fafb');
    doc.fillColor('#111827').fontSize(7.5).font('Helvetica-Bold').text(v.placa, MARGEM + 6, y + 3, { width: 52, lineBreak: false });
    doc.font('Helvetica').text(truncar(v.descricao, 34), MARGEM + 60, y + 3, { width: 184, lineBreak: false });
    doc.text(v.renavam, MARGEM + 248, y + 3, { width: 68, lineBreak: false });
    doc.text(truncar(v.chassi, 18), MARGEM + 320, y + 3, { width: 94, lineBreak: false });
    const corSit = v.restricoes.length ? COR.vermelho : '#111827';
    doc.fillColor(corSit).text(truncar(v.restricoes.length ? 'C/ RESTRIÇÃO' : v.situacao, 14), MARGEM + 418, y + 3, { width: 72, lineBreak: false });
    if (v.restricoes.length) comRestricao.push(`${v.placa}: ${v.restricoes.join(', ')}`);
    y += 13;
  });
  if (norm.length > 20) {
    y = verificarPagina(doc, y, 12);
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique').text(`+${norm.length - 20} veículo(s) não exibido(s) nesta tabela`, MARGEM + 6, y);
    y += 10;
  }

  // Restrições são o sinal patrimonial mais relevante (RENAJUD = penhorável/bloqueado).
  if (comRestricao.length) {
    y += 4;
    y = verificarPagina(doc, y, 14 + comRestricao.length * 10);
    doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica-Bold').text('VEÍCULOS COM RESTRIÇÃO', MARGEM, y); y += 11;
    comRestricao.slice(0, 10).forEach(r => {
      y = verificarPagina(doc, y, 10);
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${r}`, MARGEM + 6, y, { width: LARGURA - 12 });
      y += 9;
    });
  }
  return y + 6;
}

// ─── Vínculos e interpostas pessoas ────────────────────────────────
function secaoInterpostas(doc, y, dados) {
  const interpostas = dados.interpostas || {};
  // Parentescos vêm da cadastral (Direct Data) e/ou do AML — unifica e deduplica.
  const parentescosRaw = [
    ...(dados.receita_federal?.parentescos || []),
    ...(interpostas.parentescos || [])
  ];
  const vistos = new Set();
  const parentescos = parentescosRaw.filter(p => {
    const k = (p.nome || '').trim().toLowerCase();
    if (!k || vistos.has(k)) return false;
    vistos.add(k); return true;
  });
  const empresasFamilia = interpostas.empresas_familia || [];
  const transferenciasRecentes = interpostas.transferencias || [];
  const sociosComum = interpostas.socios_comum || [];
  const pep = !!interpostas.pep;

  y = secao(doc, 'VÍNCULOS E INTERPOSTAS PESSOAS', y);

  const temAlgo = pep || parentescos.length || empresasFamilia.length || transferenciasRecentes.length || sociosComum.length;
  if (!temAlgo) {
    return boxEmIntegracao(doc, y,
      'ANÁLISE DE INTERPOSTAS PESSOAS — sem indícios',
      'Sem parentescos, sócios de mesmo sobrenome ou rede societária recorrente identificados para este alvo (fonte: Direct Data AML). Transferências patrimoniais recentes dependem do ONR (em integração).'
    );
  }

  if (pep) {
    y = verificarPagina(doc, y, 18);
    doc.rect(MARGEM, y, LARGURA, 16).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(8).font('Helvetica-Bold').text('PEP — Pessoa Exposta Politicamente (ou relacionada a uma). Reforça due diligence.', MARGEM + 8, y + 4, { width: LARGURA - 16 });
    y += 22;
  }

  if (parentescos.length) {
    doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('PARENTESCO DIRETO', MARGEM, y); y += 12;
    parentescos.slice(0, 8).forEach(p => {
      y = verificarPagina(doc, y, 11);
      const rel = p.tipo || p.vinculo || '';
      const docp = p.documento || p.cpf || '';
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${p.nome}${rel ? ` (${rel})` : ''}${docp ? ` - ${docp}` : ''}`, MARGEM + 6, y, { width: LARGURA - 12 });
      y += 10;
    });
    y += 4;
  }

  if (empresasFamilia.length) {
    doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('EMPRESAS COM SÓCIO DE MESMO SOBRENOME (POSSÍVEL FAMÍLIA)', MARGEM, y); y += 12;
    empresasFamilia.slice(0, 10).forEach(e => {
      y = verificarPagina(doc, y, 12);
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${e.razao_social} | ${e.cnpj || ''} | Sócio: ${e.socio} (${e.relacao || 'sobrenome em comum'})`, MARGEM + 6, y, { width: LARGURA - 12 });
      y += 11;
    });
    y += 4;
  }

  if (transferenciasRecentes.length) {
    doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold').text('TRANSFERÊNCIAS RECENTES (POSSÍVEL BLINDAGEM)', MARGEM, y); y += 12;
    transferenciasRecentes.slice(0, 10).forEach(t => {
      y = verificarPagina(doc, y, 12);
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${t.data || ''} | ${t.bem} | para: ${t.destinatario} | ${t.valor ? formatarBRL(t.valor) : ''}`, MARGEM + 6, y, { width: LARGURA - 12 });
      y += 11;
    });
    y += 4;
  }

  if (sociosComum.length) {
    doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('SÓCIOS EM COMUM COM OUTRAS EMPRESAS', MARGEM, y); y += 12;
    sociosComum.slice(0, 10).forEach(s => {
      y = verificarPagina(doc, y, 11);
      doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${s.socio} | ${s.empresas} empresa(s)`, MARGEM + 6, y);
      y += 10;
    });
    y += 4;
  }
  return y + 4;
}

// ─── Estratégia de execução com ordem de penhora ───────────────────
function secaoEstrategiaExecucao(doc, y, dados) {
  y = secao(doc, 'ESTRATÉGIA DE EXECUÇÃO', y);

  const { imoveis, veiculos, empresas } = coletarPatrimonio(dados);
  const valorImoveis = imoveis.reduce((acc, im) => acc + (Number(im.valor_estimado) || 0), 0);
  const valorTotalLocalizado = valorImoveis;

  doc.fillColor(COR.cinza).fontSize(7).font('Helvetica')
    .text('Ordem de preferência sugerida para penhora (arts. 833-835 CPC e orientações jurisprudenciais):', MARGEM, y, { width: LARGURA });
  y += 14;

  const ordem = [
    { n: 1, tipo: 'Dinheiro em aplicação/conta bancária', obs: 'BacenJud/SISBAJUD — primeira opção do CPC. Exige título executivo.', disp: 'Em integração' },
    { n: 2, tipo: 'Imóveis localizados', obs: imoveis.length ? `${imoveis.length} imóvel(is) mapeado(s). Priorizar de maior liquidez.` : 'Nenhum imóvel localizado na consulta.', disp: imoveis.length ? 'Disponível' : 'Em integração' },
    { n: 3, tipo: 'Veículos', obs: veiculos.length ? `${veiculos.length} veículo(s) identificado(s). RENAJUD para bloqueio.` : 'Nenhum veículo encontrado.', disp: veiculos.length ? 'Disponível' : '-' },
    { n: 4, tipo: 'Quotas societárias', obs: empresas.length ? `${empresas.length} empresa(s) com participação. Penhora de quota conforme art. 861 CPC.` : 'Nenhuma participação societária identificada.', disp: empresas.length ? 'Disponível' : '-' },
    { n: 5, tipo: 'Créditos e recebíveis', obs: 'Penhora no rosto dos autos ou na fonte pagadora (FGTS, salário, alugueis).', disp: 'Em integração' }
  ];

  ordem.forEach(o => {
    y = verificarPagina(doc, y, 26);
    doc.rect(MARGEM, y, LARGURA, 24).fill('#f9fafb').stroke(COR.borda);
    doc.fillColor(COR.azul).fontSize(8.5).font('Helvetica-Bold').text(`${o.n}. ${o.tipo}`, MARGEM + 8, y + 4, { width: LARGURA - 100 });
    const corDisp = o.disp === 'Disponível' ? COR.verde : COR.cinza;
    doc.fillColor(corDisp).fontSize(7).font('Helvetica-Bold').text(o.disp, MARGEM + LARGURA - 85, y + 4, { width: 75, align: 'right' });
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(o.obs, MARGEM + 8, y + 15, { width: LARGURA - 16 });
    y += 26;
  });
  y += 4;

  if (valorTotalLocalizado > 0) {
    y = verificarPagina(doc, y, 22);
    doc.rect(MARGEM, y, LARGURA, 20).fill('#eff6ff');
    doc.fillColor('#1e40af').fontSize(9).font('Helvetica-Bold').text(`Valor total localizado (imóveis): ${formatarBRL(valorTotalLocalizado)}`, MARGEM + 8, y + 5, { width: LARGURA - 16 });
    y += 24;
  }
  return y + 4;
}

// ─── Conclusão (viabilidade) ───────────────────────────────────────
function secaoConclusao(doc, y, dados) {
  const pat = coletarPatrimonio(dados);
  const imoveis = pat.imoveis.length;
  const veiculos = pat.veiculos.length;
  const empresas = pat.empresas.length;

  y = secao(doc, 'CONCLUSÃO', y);

  let status, cor, texto;
  if (imoveis > 0 || veiculos > 3 || empresas > 2) {
    status = 'VIÁVEL';
    cor = COR.verde;
    texto = 'Patrimônio identificado é suficiente para justificar o ajuizamento/prosseguimento da execução. Priorizar penhora dos ativos listados.';
  } else if (veiculos > 0 || empresas > 0) {
    status = 'PARCIALMENTE VIÁVEL';
    cor = COR.laranja;
    texto = 'Patrimônio limitado. Execução possível mas pode não recuperar integralmente o crédito. Avaliar custo/benefício do processo.';
  } else {
    status = 'INVIÁVEL NO CENÁRIO ATUAL';
    cor = COR.vermelho;
    texto = 'Nenhum ativo penhorável localizado. Considerar desconsideração da personalidade jurídica, investigação de interpostas pessoas (em integração) ou aguardar nova consulta após prazo.';
  }

  y = verificarPagina(doc, y, 24);
  doc.rect(MARGEM, y, LARGURA, 22).fill(cor === COR.verde ? '#dcfce7' : cor === COR.laranja ? '#fef3c7' : '#fee2e2');
  doc.fillColor(cor).fontSize(10).font('Helvetica-Bold').text(`EXECUÇÃO ${status}`, MARGEM + 8, y + 5, { width: LARGURA - 16 });
  y += 28;
  doc.fillColor('#111827').fontSize(8).font('Helvetica').text(texto, MARGEM, y, { width: LARGURA });
  y += doc.heightOfString(texto, { width: LARGURA, fontSize: 8 }) + 8;

  doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('PRÓXIMOS PASSOS RECOMENDADOS', MARGEM, y); y += 12;
  const passos = status === 'VIÁVEL'
    ? ['Protocolar pedido de penhora sobre os ativos priorizados', 'BacenJud/RENAJUD sobre dinheiro e veículos', 'Averbação da penhora no cartório de registro dos imóveis']
    : status === 'PARCIALMENTE VIÁVEL'
    ? ['Iniciar penhora dos ativos localizados', 'Solicitar busca patrimonial complementar em 90-180 dias', 'Avaliar desconsideração da personalidade jurídica se investigado for sócio']
    : ['Solicitar pesquisa patrimonial ampliada (Credify + ONR) no próximo release', 'Investigar interpostas pessoas (familiares diretos)', 'Ponderar arquivamento temporário sem prejuízo de retomada'];
  passos.forEach((p, i) => {
    y = verificarPagina(doc, y, 12);
    doc.fillColor('#111827').fontSize(7.5).font('Helvetica').text(`${i + 1}. ${p}`, MARGEM + 6, y, { width: LARGURA - 12 });
    y += doc.heightOfString(p, { width: LARGURA - 12, fontSize: 7.5 }) + 3;
  });
  return y + 6;
}

function render(doc, pedido, dados, score, checklist, produto) {
  let y = chrome.cabecalho(doc, pedido, produto);
  y = chrome.resumoExecutivo(doc, y, score);
  y = chrome.blocoAlvo(doc, y, pedido);
  y = chrome.blocoAlertasDetalhados(doc, y, score);

  // Identificação e localização atual
  if (pedido.alvo_tipo === 'PF') y = secaoCadastralPF(doc, y, dados);
  else y = secaoCadastralPJ(doc, y, dados);

  // Patrimônio: imóveis, veículos, empresas
  y = secaoImoveis(doc, y, dados);
  y = secaoVeiculos(doc, y, dados);
  y = secaoVinculosSocietarios(doc, y, dados);
  y = secaoInterpostas(doc, y, dados);

  // Processos como réu (execuções em curso)
  y = secaoProcessos(doc, y, dados, pedido);
  y = secaoProtestos(doc, y, dados);

  // Estratégia e conclusão
  y = secaoEstrategiaExecucao(doc, y, dados);
  y = secaoConclusao(doc, y, dados);
  y = secaoChecklist(doc, y, checklist);
  y = secaoParecerAnalista(doc, y, pedido);

  chrome.blocoFinal(doc, y, [
    'Credify - Veículos por CPF/CNPJ, Parentesco, Score Força Vínculo (em integração)',
    'ONR - Imóveis por CPF/CNPJ (em integração)'
  ]);
}

module.exports = { render };
