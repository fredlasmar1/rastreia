const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { PRODUTOS, calcularScore, gerarChecklist } = require('./produtos');

const COR = {
  azul: '#1a3a8a', azul_claro: '#2563eb', verde: '#16a34a',
  vermelho: '#dc2626', laranja: '#ea580c', cinza: '#6b7280',
  fundo: '#f9fafb', borda: '#e5e7eb', branco: '#ffffff'
};

const MARGEM = 50;
const LARGURA = 495;
const RODAPE_H = 30;

function formatarDoc(doc) {
  if (!doc) return '';
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

function corScore(classificacao) {
  const c = (classificacao || '').toUpperCase();
  if (c.includes('BAIXO RISCO')) return COR.verde;
  if (c.includes('BAIXO-MODERADO')) return COR.verde;
  if (c.includes('MODERADO')) return COR.laranja;
  if (c.includes('MÉDIO') || c === 'RISCO MEDIO') return COR.laranja;
  if (c.includes('INDISPON')) return COR.cinza;
  return COR.vermelho;
}

function limiteY(doc) {
  return doc.page.height - MARGEM - RODAPE_H;
}

function verificarPagina(doc, y, espaco) {
  if (y + (espaco || 20) > limiteY(doc)) {
    doc.addPage();
    return MARGEM;
  }
  return y;
}

function secao(doc, titulo, y) {
  y = verificarPagina(doc, y, 30);
  doc.fillColor(COR.azul).fontSize(11).font('Helvetica-Bold').text(titulo, MARGEM, y);
  y += 16;
  doc.moveTo(MARGEM, y).lineTo(MARGEM + LARGURA, y).strokeColor(COR.azul_claro).lineWidth(1.5).stroke();
  return y + 10;
}

// Renderiza linha label: valor. Garante paginação correta e retorna novo y.
// altura default = 13. Compactado para caber mais no A4.
function linha(doc, label, valor, y, altura) {
  const h = altura || 13;
  y = verificarPagina(doc, y, h);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR.cinza).text(label + ':', MARGEM, y, { width: 140, lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor('#111827').text(String(valor || '-'), 195, y, { width: 350, lineBreak: false });
  return y + h;
}

function avisoBox(doc, y, msg, cor) {
  y = verificarPagina(doc, y, 28);
  doc.rect(MARGEM, y, LARGURA, 22).fill(cor || '#fef3c7');
  doc.fillColor('#92400e').fontSize(8).font('Helvetica').text(msg, MARGEM + 8, y + 5, { width: LARGURA - 16 });
  return y + 28;
}

// Normaliza alerta (aceita string legada ou objeto com severidade)
function normalizarAlerta(a) {
  if (typeof a === 'string') return { texto: a, severidade: 'atencao' };
  return { texto: a.texto || String(a), severidade: a.severidade || 'atencao' };
}

// Estilo por severidade — fundo, cor do texto e rótulo
const ESTILO_SEV = {
  critico:  { fundo: '#fee2e2', texto: '#991b1b', rotulo: 'CRÍTICO' },
  atencao:  { fundo: '#fef3c7', texto: '#92400e', rotulo: 'ATENÇÃO' },
  observar: { fundo: '#f3f4f6', texto: '#374151', rotulo: 'OBSERVAR' },
  positivo: { fundo: '#dcfce7', texto: '#14532d', rotulo: 'POSITIVO' }
};

function renderAlerta(doc, y, alerta) {
  const { texto, severidade } = normalizarAlerta(alerta);
  const est = ESTILO_SEV[severidade] || ESTILO_SEV.atencao;
  const larguraRot = 52;
  const larguraTxt = LARGURA - larguraRot - 8;
  // altura dinâmica
  doc.font('Helvetica').fontSize(7.5);
  const h = Math.max(15, doc.heightOfString(texto, { width: larguraTxt }) + 6);
  y = verificarPagina(doc, y, h + 3);
  doc.rect(MARGEM, y, LARGURA, h).fill(est.fundo);
  // Faixa de rótulo à esquerda
  doc.rect(MARGEM, y, larguraRot, h).fill(est.texto);
  doc.fillColor('#ffffff').fontSize(6.5).font('Helvetica-Bold').text(est.rotulo, MARGEM, y + (h / 2) - 3, { width: larguraRot, align: 'center' });
  doc.fillColor(est.texto).fontSize(7.5).font('Helvetica').text(texto, MARGEM + larguraRot + 6, y + 3, { width: larguraTxt });
  return y + h + 3;
}

// Ordena alertas por severidade (crítico > atenção > observar > positivo)
function ordenarAlertas(alertas) {
  const ordem = { critico: 0, atencao: 1, observar: 2, positivo: 3 };
  return [...(alertas || [])].map(normalizarAlerta).sort((a, b) =>
    (ordem[a.severidade] ?? 1) - (ordem[b.severidade] ?? 1)
  );
}

function contarPorSeveridade(alertas) {
  const contagem = { critico: 0, atencao: 0, observar: 0, positivo: 0 };
  (alertas || []).map(normalizarAlerta).forEach(a => {
    if (contagem[a.severidade] !== undefined) contagem[a.severidade]++;
  });
  return contagem;
}

function truncar(texto, max) {
  if (!texto) return '';
  const s = String(texto);
  return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s;
}

function isAlvoNoPolo(poloStr, cpf, nome) {
  if (!poloStr) return false;
  const polo = String(poloStr).toLowerCase();
  const cpfDigits = String(cpf || '').replace(/\D/g, '');
  if (cpfDigits && cpfDigits.length >= 11 && polo.replace(/\D/g, '').includes(cpfDigits)) return true;
  if (nome) {
    const primeiro = String(nome).toLowerCase().trim().split(/\s+/)[0];
    if (primeiro && primeiro.length >= 3 && polo.includes(primeiro)) return true;
  }
  return false;
}

function parseValorCausa(valor) {
  if (valor == null) return 0;
  if (typeof valor === 'number') return valor;
  const s = String(valor).replace(/[^\d,\.]/g, '');
  if (!s) return 0;
  // Formato BR: "1.234,56" -> remove pontos (milhar) e troca vírgula por ponto
  const normalizado = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

function construirResumoJudicial(lista, cpf, nome) {
  if (!lista || !lista.length) return '';
  const ativos = lista.filter(p => String(p.status || '').toLowerCase() === 'ativo');
  const inativos = lista.filter(p => String(p.status || '').toLowerCase() !== 'ativo');
  let autor = 0, reu = 0, valorAtivos = 0;
  const classes = new Set();
  let maisRecente = null;
  ativos.forEach(p => {
    if (isAlvoNoPolo(p.polo_ativo, cpf, nome)) autor++;
    else if (isAlvoNoPolo(p.polo_passivo, cpf, nome)) reu++;
    if (p.classe) classes.add(String(p.classe).trim());
    valorAtivos += parseValorCausa(p.valor_causa);
    const dataRef = p.ultima_movimentacao || p.data_inicio;
    if (dataRef) {
      const d = new Date(dataRef);
      if (!isNaN(d) && (!maisRecente || d > maisRecente)) maisRecente = d;
    }
  });
  const partes = [];
  if (ativos.length) {
    const papel = reu > autor ? 'réu' : autor > reu ? 'autor' : 'parte';
    partes.push(`${papel} em ${ativos.length} processo(s) ativo(s)`);
    if (valorAtivos > 0) partes.push(`somando R$ ${valorAtivos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} em valores de causa`);
    if (classes.size > 0) partes.push(`nas áreas ${[...classes].slice(0, 3).join(', ')}`);
  }
  if (inativos.length) partes.push(`${inativos.length} processo(s) no histórico (baixados/arquivados)`);
  if (maisRecente) {
    const dias = Math.floor((Date.now() - maisRecente.getTime()) / 86400000);
    if (dias >= 0) partes.push(`movimentação mais recente há ${dias} dia(s)`);
  }
  const sujeito = nome ? String(nome).split(' ')[0] : 'O alvo';
  return partes.length ? `${sujeito} consta como ${partes.join('; ')}.` : '';
}

function rodape(doc) {
  const y = doc.page.height - RODAPE_H;
  doc.rect(0, y, 595, RODAPE_H).fill('#f3f4f6');
  doc.fillColor(COR.cinza).fontSize(6).font('Helvetica')
    .text('Documento informativo gerado pelo sistema Rastreia. Nao substitui consulta juridica. Recobro Recuperacao de Credito | Anapolis - GO', MARGEM, y + 10, { align: 'center', width: LARGURA });
}

function gerarDossie(pedido, dadosDB) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: MARGEM, size: 'A4' });
      const filename = `rastreia_${pedido.tipo}_${pedido.id.substring(0,8)}_${Date.now()}.pdf`;
      const dirRelatorios = path.join(__dirname, '../public/relatorios');
      if (!fs.existsSync(dirRelatorios)) fs.mkdirSync(dirRelatorios, { recursive: true });
      const filepath = path.join(dirRelatorios, filename);
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // Montar dados por fonte
      const dados = {};
      dadosDB.forEach(d => {
        try { dados[d.fonte] = typeof d.dados === 'string' ? JSON.parse(d.dados) : d.dados; }
        catch { dados[d.fonte] = d.dados || {}; }
      });

      const produto = PRODUTOS[pedido.tipo] || {};
      const score = calcularScore(pedido.tipo, dados);
      const checklist = gerarChecklist(pedido.tipo, dados);
      const cadastral = dados.receita_federal || {};
      const processos = dados.processos || {};
      const transparencia = dados.transparencia || {};
      const scoreCredito = dados.score_credito || {};
      const negativacoes = dados.negativacoes || {};
      const perfilEco = dados.perfil_economico || {};
      const vinculos = dados.vinculos || {};
      const serasa = dados.serasa || {};

      // ════ CABECALHO (fundo branco) ════
      doc.rect(0, 0, 595, 80).fill('#ffffff');
      doc.rect(0, 78, 595, 2).fill(COR.azul); // linha azul separadora
      // Logo Recobro (colorida - icone azul + texto preto)
      const logoPng = path.join(__dirname, '../public/img/logo-recobro.png');
      if (fs.existsSync(logoPng)) {
        try {
          doc.image(logoPng, MARGEM, 12, { width: 150 });
        } catch (e) {
          console.error('[PDF] Erro logo:', e.message);
        }
      }
      // RASTREIA no lado direito
      doc.fillColor(COR.azul).fontSize(22).font('Helvetica-Bold').text('RASTREIA', 0, 16, { width: 595 - MARGEM, align: 'right' });
      doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text('Sistema de Inteligencia de Dados', 0, 40, { width: 595 - MARGEM, align: 'right' });
      doc.fillColor(COR.cinza).fontSize(6.5).text(`Emitido em: ${new Date().toLocaleString('pt-BR')}  |  Protocolo: #${pedido.numero || pedido.id.substring(0,8).toUpperCase()}`, 0, 52, { width: 595 - MARGEM, align: 'right' });

      doc.rect(0, 80, 595, 24).fill(COR.azul);
      doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text((produto.nome || pedido.tipo).toUpperCase(), 0, 85, { width: 595, align: 'center' });

      let y = 118;

      // ════ CONSULTA VEICULAR (fluxo próprio) ════
      if (pedido.tipo === 'consulta_veicular') {
        const v = dados.veiculo_placa || {};

        y = secao(doc, 'ALVO DA CONSULTA', y);
        y = linha(doc, 'Placa', pedido.alvo_placa || v.placa || '-', y, 14);
        y = linha(doc, 'Solicitante', pedido.cliente_nome, y, 20);

        if (!v.disponivel) {
          // Montar mensagem de erro detalhada
          const partes = [];
          if (v.erro) partes.push(v.erro);
          if (v.detalhes && v.detalhes !== v.erro) partes.push(v.detalhes);
          const msgErro = partes.join(' - ') || 'sem retorno da API';
          y = avisoBox(doc, y, `Consulta indisponível: ${msgErro}`);
          // Linha de diagnóstico técnico
          const diag = [];
          if (v.status_http) diag.push(`HTTP ${v.status_http}`);
          if (v.codigo_api) diag.push(`Código API: ${v.codigo_api}`);
          if (v.fonte) diag.push(v.fonte);
          if (diag.length) {
            doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(diag.join(' | '), MARGEM, y, { width: LARGURA });
            y += 14;
          }
        } else {
          y = secao(doc, 'IDENTIFICACAO DO VEICULO', y);
          y = linha(doc, 'Marca / Modelo', v.marca_modelo || [v.marca, v.modelo].filter(Boolean).join(' ') || '-', y, 13);
          if (v.ano_modelo || v.ano_fabricacao) {
            y = linha(doc, 'Ano', `${v.ano_fabricacao || '?'}/${v.ano_modelo || '?'}`, y, 13);
          }
          if (v.cor) { y = linha(doc, 'Cor', v.cor, y, 13); }
          if (v.combustivel) { y = linha(doc, 'Combustivel', v.combustivel, y, 13); }
          if (v.chassi) { y = linha(doc, 'Chassi', v.chassi, y, 13); }
          if (v.renavam) { y = linha(doc, 'Renavam', v.renavam, y, 13); }
          if (v.tipo_veiculo) { y = linha(doc, 'Tipo', v.tipo_veiculo, y, 13); }
          if (v.categoria) { y = linha(doc, 'Categoria', v.categoria, y, 13); }
          if (v.especie) { y = linha(doc, 'Especie', v.especie, y, 13); }
          if (v.potencia) { y = linha(doc, 'Potencia', String(v.potencia), y, 13); }
          if (v.municipio || v.uf) { y = linha(doc, 'Registro', [v.municipio, v.uf].filter(Boolean).join(' / '), y, 13); }
          y += 6;

          // Proprietário (só admin vê documento completo; cliente vê nome)
          if (v.proprietario || v.proprietario_documento) {
            y = secao(doc, 'PROPRIETARIO', y);
            if (v.proprietario) { y = linha(doc, 'Nome', v.proprietario, y, 13); }
            if (v.proprietario_documento) { y = linha(doc, 'Documento', v.proprietario_documento, y, 13); }
            if (v.ano_exercicio) { y = linha(doc, 'Exercicio', String(v.ano_exercicio), y, 13); }
            y += 6;
          }

          // ══ HISTÓRICO DE PROPRIETÁRIOS (DirectData ProprietariosPlaca) ══
          // Mostra a cadeia de donos do veículo por exercício, indicando padrões
          // (rotatividade alta, troca recente de UF, etc).
          const pp = dados.proprietarios_placa || {};
          if (pp.disponivel && Array.isArray(pp.proprietarios) && pp.proprietarios.length > 0) {
            y = secao(doc, 'HISTORICO DE PROPRIETARIOS', y);

            const lista = pp.proprietarios.slice(0, 10); // limite por pedido do padrão
            const totalOculto = pp.proprietarios.length > 10 ? pp.proprietarios.length - 10 : 0;

            // Sinais analíticos simples: rotatividade e troca de UF
            const ufsDistintas = new Set(lista.map(p => (p.uf_circulacao || '').toUpperCase()).filter(Boolean));
            const anos = lista.map(p => parseInt(p.exercicio, 10)).filter(n => n > 0);
            const janela = anos.length >= 2 ? Math.max(...anos) - Math.min(...anos) + 1 : null;
            const sinais = [];
            if (pp.proprietarios.length >= 3) {
              sinais.push(`${pp.proprietarios.length} proprietários${janela ? ` em ${janela} ano(s)` : ''}`);
            }
            if (ufsDistintas.size >= 2) {
              sinais.push(`circulou em ${ufsDistintas.size} UFs (${Array.from(ufsDistintas).join(', ')})`);
            }
            if (sinais.length > 0) {
              y = verificarPagina(doc, y, 20);
              doc.rect(MARGEM, y, LARGURA, 16).fill('#eff6ff');
              doc.fillColor('#1e40af').fontSize(8).font('Helvetica-Bold')
                .text(`Padrão: ${sinais.join(' | ')}`, MARGEM + 8, y + 4, { width: LARGURA - 16, lineBreak: false });
              y += 20;
            }

            // Cabeçalho da tabela
            const colX = {
              exercicio: MARGEM + 6,
              documento: MARGEM + 58,
              nome: MARGEM + 180,
              uf: MARGEM + 420,
              data: MARGEM + 460
            };
            y = verificarPagina(doc, y, 16 + lista.length * 14);
            doc.rect(MARGEM, y, LARGURA, 14).fill(COR.azul);
            doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
            doc.text('EXERC.', colX.exercicio, y + 4, { width: 48, lineBreak: false });
            doc.text('DOCUMENTO', colX.documento, y + 4, { width: 118, lineBreak: false });
            doc.text('NOME', colX.nome, y + 4, { width: 235, lineBreak: false });
            doc.text('UF', colX.uf, y + 4, { width: 36, lineBreak: false });
            doc.text('PAGAMENTO', colX.data, y + 4, { width: 85, lineBreak: false });
            y += 14;

            // Linhas zebra
            lista.forEach((p, i) => {
              y = verificarPagina(doc, y, 14);
              doc.rect(MARGEM, y, LARGURA, 13).fill(i % 2 === 0 ? '#ffffff' : '#f9fafb');
              doc.fillColor('#111827').fontSize(7.5).font('Helvetica');
              doc.text(p.exercicio || '-', colX.exercicio, y + 3, { width: 48, lineBreak: false });
              doc.text(p.documento_formatado || p.documento || '-', colX.documento, y + 3, { width: 118, lineBreak: false });
              doc.font('Helvetica-Bold').text(truncar(p.nome || '-', 42), colX.nome, y + 3, { width: 235, lineBreak: false });
              doc.font('Helvetica').text(p.uf_circulacao || '-', colX.uf, y + 3, { width: 36, lineBreak: false });
              doc.text(p.data_pagamento || '-', colX.data, y + 3, { width: 85, lineBreak: false });
              y += 13;
            });

            if (totalOculto > 0) {
              y = verificarPagina(doc, y, 14);
              doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique')
                .text(`+${totalOculto} proprietário(s) anteriores não exibidos`, MARGEM + 6, y + 2);
              y += 12;
            }
            y += 8;
          } else if (pp.fonte && !pp.disponivel && pp.erro && !/DIRECTD_TOKEN|Placa inválida/i.test(pp.erro)) {
            // Nota discreta se a API respondeu mas sem histórico
            y = verificarPagina(doc, y, 14);
            doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique')
              .text(`Histórico de proprietários indisponível: ${pp.erro}`, MARGEM, y);
            y += 14;
          }

          y = secao(doc, 'SITUAÇÃO E RESTRIÇÕES', y);
          y = linha(doc, 'Situação', v.situacao || 'Sem informação', y, 13);

          // Mapeamento de indicadores DirectData → alertas estruturados
          const ind = v.indicadores || {};
          const restricoesEstruturadas = [];
          if (ind.rouboFurto) restricoesEstruturadas.push({
            tipo: 'ROUBO/FURTO', severidade: 'critico',
            texto: 'Veículo consta em registro de roubo ou furto. NÃO NEGOCIAR. Risco de apreensão e responsabilização criminal (art. 180 CP - receptação).'
          });
          if (ind.renajud) restricoesEstruturadas.push({
            tipo: 'RENAJUD', severidade: 'critico',
            texto: 'Restrição judicial ativa (RENAJUD). Veículo penhorado ou sob ordem judicial. Transferência bloqueada até liberação pelo juízo.'
          });
          if (ind.rfb) restricoesEstruturadas.push({
            tipo: 'RECEITA FEDERAL', severidade: 'critico',
            texto: 'Restrição da Receita Federal. Normalmente relacionada a dívida ativa, apreensão aduaneira ou pendência fiscal. Impede transferência.'
          });
          if (ind.leilao) restricoesEstruturadas.push({
            tipo: 'LEILÃO', severidade: 'critico',
            texto: 'Veículo atualmente ou anteriormente em leilão. Verificar laudo de sinistro e categoria (avariado, recuperado, destinação especial).'
          });
          if (ind.pendenciaEmissao) restricoesEstruturadas.push({
            tipo: 'DOCUMENTO PENDENTE', severidade: 'atencao',
            texto: 'Pendência de emissão de documento (CRLV). Pode indicar atraso no licenciamento, IPVA não quitado ou transferência não concretizada.'
          });
          if (ind.comunicadoVenda) restricoesEstruturadas.push({
            tipo: 'COMUNICADO DE VENDA', severidade: 'atencao',
            texto: 'Vendedor anterior comunicou a venda ao DETRAN, mas transferência ainda não foi finalizada. Confirmar proprietário real antes da negociação.'
          });
          if (ind.renainf) restricoesEstruturadas.push({
            tipo: 'INFRAÇÕES', severidade: 'atencao',
            texto: 'Infrações registradas no RENAINF. Multas podem gerar débito herdado ao novo proprietário — exigir comprovante de quitação.'
          });
          if (ind.alarme) restricoesEstruturadas.push({
            tipo: 'ALARME', severidade: 'atencao',
            texto: 'Alarme registrado na base veicular. Investigar origem (b.o. não concluído, suspeita de clonagem, etc).'
          });
          if (ind.recall) restricoesEstruturadas.push({
            tipo: 'RECALL', severidade: 'observar',
            texto: 'Veículo tem recall registrado pela montadora. Não impede negócio, mas convém confirmar se o reparo foi realizado junto à concessionária.'
          });
          // Restrições textuais livres (vindas em v.restricoes como strings)
          if (Array.isArray(v.restricoes)) {
            v.restricoes.forEach(r => {
              if (!r) return;
              const txt = String(r).trim();
              if (!txt) return;
              // Evita duplicar indicadores já mapeados (heurística simples)
              const jaCapturado = restricoesEstruturadas.some(x => txt.toUpperCase().includes(x.tipo));
              if (!jaCapturado) {
                restricoesEstruturadas.push({
                  tipo: 'OUTRA RESTRIÇÃO', severidade: 'atencao',
                  texto: txt
                });
              }
            });
          }

          if (restricoesEstruturadas.length > 0) {
            // Contador por severidade
            const contSevV = { critico: 0, atencao: 0, observar: 0 };
            restricoesEstruturadas.forEach(r => { if (contSevV[r.severidade] !== undefined) contSevV[r.severidade]++; });
            const resumoSev = [];
            if (contSevV.critico) resumoSev.push(`${contSevV.critico} crítico(s)`);
            if (contSevV.atencao) resumoSev.push(`${contSevV.atencao} atenção`);
            if (contSevV.observar) resumoSev.push(`${contSevV.observar} observação`);
            y += 2;
            y = verificarPagina(doc, y, 24);
            doc.rect(MARGEM, y, LARGURA, 20).fill(contSevV.critico > 0 ? '#fee2e2' : '#fef3c7');
            doc.fillColor(contSevV.critico > 0 ? '#991b1b' : '#92400e').fontSize(9.5).font('Helvetica-Bold')
              .text(`${restricoesEstruturadas.length} restrição(ões) identificada(s)`, MARGEM + 8, y + 5, { lineBreak: false });
            doc.fillColor(contSevV.critico > 0 ? '#991b1b' : '#92400e').fontSize(7.5).font('Helvetica')
              .text(resumoSev.join(' | '), MARGEM + LARGURA - 200, y + 7, { width: 190, align: 'right', lineBreak: false });
            y += 24;

            // Ordenar: críticos primeiro, depois atenção, depois observar
            const ordem = { critico: 0, atencao: 1, observar: 2 };
            const ordenadas = [...restricoesEstruturadas].sort((a, b) => (ordem[a.severidade] ?? 9) - (ordem[b.severidade] ?? 9));

            // Renderizar cada restrição como alerta (tipo em negrito no início do texto)
            ordenadas.forEach(r => {
              y = renderAlerta(doc, y, {
                texto: `${r.tipo}: ${r.texto}`,
                severidade: r.severidade
              });
            });
          } else {
            y = verificarPagina(doc, y, 32);
            doc.rect(MARGEM, y, LARGURA, 28).fill('#d1fae5');
            doc.fillColor('#065f46').fontSize(9.5).font('Helvetica-Bold')
              .text('Nenhuma restrição identificada', MARGEM + 8, y + 5, { lineBreak: false });
            doc.fillColor('#065f46').fontSize(7).font('Helvetica')
              .text('RENAJUD, roubo/furto, Receita Federal, leilão, recall e RENAINF negativos', MARGEM + 8, y + 17, { width: LARGURA - 16, lineBreak: false });
            y += 32;
          }
          y += 6;

          if (v.fipe_valor || v.fipe_codigo) {
            y = secao(doc, 'AVALIACAO FIPE', y);
            if (v.fipe_valor) { y = linha(doc, 'Valor FIPE', typeof v.fipe_valor === 'number' ? `R$ ${Number(v.fipe_valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}` : String(v.fipe_valor), y, 13); }
            if (v.fipe_codigo) { y = linha(doc, 'Codigo FIPE', v.fipe_codigo, y, 13); }
            if (v.fipe_mes_referencia) { y = linha(doc, 'Mes referencia', v.fipe_mes_referencia, y, 13); }
            y += 6;
          }
        }

        // Pular o resto do pipeline PF/PJ
        doc.end();
        stream.on('finish', () => resolve({ path: filepath, url: `/relatorios/${filename}` }));
        return;
      }

      // ════ RESUMO EXECUTIVO (topo — decisão em 10s) ════
      const corS = corScore(score.classificacao);
      const alertasOrd = ordenarAlertas(score.alertas || []);
      const contSev = contarPorSeveridade(score.alertas || []);
      const top3Criticos = alertasOrd.filter(a => a.severidade === 'critico').slice(0, 3);

      // Caixa com borda azul grossa
      y = verificarPagina(doc, y, 120);
      const boxTopY = y;
      doc.save();
      doc.rect(MARGEM, y, LARGURA, 3).fill(COR.azul);
      y += 6;
      doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica-Bold').text('RESUMO EXECUTIVO', MARGEM, y, { characterSpacing: 1.2 });
      y += 10;

      // Score grande + classificação + decisão
      const scoreText = score.score === '-' ? '?' : `${score.score}`;
      doc.fillColor(corS).fontSize(32).font('Helvetica-Bold').text(scoreText, MARGEM, y, { width: 80, align: 'left' });
      doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text('/100', MARGEM + 56, y + 22);
      doc.fillColor(corS).fontSize(12).font('Helvetica-Bold').text(score.classificacao, MARGEM + 90, y + 2, { width: LARGURA - 90 });
      doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(score.recomendacao, MARGEM + 90, y + 20, { width: LARGURA - 90 });
      y += 46;

      // Linha de contagem por severidade
      const partes = [];
      if (contSev.critico > 0) partes.push(`${contSev.critico} crítico(s)`);
      if (contSev.atencao > 0) partes.push(`${contSev.atencao} atenção`);
      if (contSev.observar > 0) partes.push(`${contSev.observar} observar`);
      if (contSev.positivo > 0) partes.push(`${contSev.positivo} positivo(s)`);
      const resumoTxt = partes.length > 0 ? `Alertas: ${partes.join(' · ')}` : 'Nenhum alerta gerado';
      doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text(resumoTxt, MARGEM, y);
      y += 14;

      // Top-3 alertas críticos inline
      if (top3Criticos.length > 0) {
        doc.fillColor(COR.vermelho).fontSize(7.5).font('Helvetica-Bold').text('PRINCIPAIS PONTOS CRÍTICOS', MARGEM, y);
        y += 10;
        top3Criticos.forEach(a => {
          doc.font('Helvetica').fontSize(7.5);
          const hT = doc.heightOfString(a.texto, { width: LARGURA - 12 });
          y = verificarPagina(doc, y, hT + 4);
          doc.fillColor('#111827').text(`• ${a.texto}`, MARGEM + 6, y, { width: LARGURA - 12 });
          y += hT + 2;
        });
      }
      y += 6;
      // Borda inferior do resumo
      doc.rect(MARGEM, y, LARGURA, 1).fill(COR.borda);
      doc.restore();
      y += 12;

      // ════ ALVO ════
      y = secao(doc, 'ALVO DA CONSULTA', y);
      y = linha(doc, 'Nome', pedido.alvo_nome, y, 14);
      y = linha(doc, 'CPF / CNPJ', formatarDoc(pedido.alvo_documento), y, 14);
      y = linha(doc, 'Tipo', pedido.alvo_tipo === 'PF' ? 'Pessoa Fisica' : 'Pessoa Juridica', y, 14);
      y = linha(doc, 'Solicitante', pedido.cliente_nome, y, 20);

      // ════ ALERTAS DETALHADOS (por severidade) ════
      if (alertasOrd.length > 0) {
        y = secao(doc, 'ALERTAS E SINAIS', y);
        alertasOrd.forEach(a => {
          y = renderAlerta(doc, y, a);
        });
        y += 4;
      }

      // Como o score foi composto (transparência - art. 20 LGPD)
      if (score.contribuicoes && score.contribuicoes.length > 0) {
        y = verificarPagina(doc, y, 40);
        y = secao(doc, 'COMO O SCORE FOI COMPOSTO', y);
        doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text('Ponto de partida: 100 pontos. Cada dimensão ajusta o score conforme os dados encontrados.', MARGEM, y, { width: LARGURA });
        y += 12;
        // Cabeçalho da tabela
        doc.fillColor('#111827').fontSize(7.5).font('Helvetica-Bold');
        doc.text('Dimensão', MARGEM, y);
        doc.text('Ajuste', MARGEM + 200, y, { width: 50, align: 'right' });
        doc.text('Motivo', MARGEM + 260, y, { width: LARGURA - 260 });
        y += 11;
        doc.rect(MARGEM, y - 2, LARGURA, 0.5).fill(COR.borda);
        score.contribuicoes.forEach(c => {
          y = verificarPagina(doc, y, 14);
          const cor = c.delta < 0 ? COR.vermelho : COR.verde;
          const sinal = c.delta > 0 ? '+' : '';
          doc.fillColor('#111827').fontSize(7.5).font('Helvetica').text(c.dimensao, MARGEM, y, { width: 195 });
          doc.fillColor(cor).fontSize(7.5).font('Helvetica-Bold').text(`${sinal}${c.delta}`, MARGEM + 200, y, { width: 50, align: 'right' });
          doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(c.motivo, MARGEM + 260, y, { width: LARGURA - 260 });
          y += 12;
        });
        // Linha de total
        y = verificarPagina(doc, y, 14);
        doc.rect(MARGEM, y, LARGURA, 0.5).fill(COR.borda); y += 3;
        doc.fillColor('#111827').fontSize(8).font('Helvetica-Bold').text('Score final', MARGEM, y, { width: 195 });
        doc.fillColor(corS).fontSize(8).font('Helvetica-Bold').text(`${score.score}/100`, MARGEM + 200, y, { width: 50, align: 'right' });
        doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(score.classificacao, MARGEM + 260, y, { width: LARGURA - 260 });
        y += 14;
        // Nota LGPD
        doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica-Oblique').text('Decisão automatizada - art. 20 da LGPD garante direito a revisão. Entre em contato para auditoria do cálculo.', MARGEM, y, { width: LARGURA });
        y += 14;
      }

      // ════ HISTÓRICO DE SCORES DESTE CPF/CNPJ ════
      const historicoScores = dados.historico_scores || {};
      const historicoLista = Array.isArray(historicoScores.pedidos) ? historicoScores.pedidos : [];
      if (historicoLista.length > 0) {
        y = verificarPagina(doc, y, 50);
        y = secao(doc, 'HISTÓRICO DE SCORES DESTE ALVO', y);
        doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(`Consultas anteriores do mesmo ${pedido.alvo_tipo === 'PJ' ? 'CNPJ' : 'CPF'} nesta base. Tendência calculada contra o score atual.`, MARGEM, y, { width: LARGURA });
        y += 12;
        // Cabeçalho
        doc.fillColor('#111827').fontSize(7.5).font('Helvetica-Bold');
        doc.text('Data', MARGEM, y, { width: 80 });
        doc.text('Pedido', MARGEM + 85, y, { width: 60 });
        doc.text('Score', MARGEM + 150, y, { width: 50, align: 'right' });
        doc.text('Classificação', MARGEM + 210, y, { width: 120 });
        doc.text('Tendência', MARGEM + 335, y, { width: 90 });
        y += 11;
        doc.rect(MARGEM, y - 2, LARGURA, 0.5).fill(COR.borda);
        const scoreAtual = typeof score.score === 'number' ? score.score : null;
        historicoLista.slice(0, 5).forEach(h => {
          y = verificarPagina(doc, y, 14);
          const dt = h.criado_em ? new Date(h.criado_em) : null;
          const dataTxt = dt && !isNaN(dt) ? dt.toLocaleDateString('pt-BR') : '-';
          const scoreTxt = h.score_calculado != null ? String(h.score_calculado) : '-';
          const classifTxt = h.score_classificacao || '-';
          let tendencia = '—';
          let corT = COR.cinza;
          if (scoreAtual != null && h.score_calculado != null) {
            const delta = scoreAtual - h.score_calculado;
            // ASCII puro: Helvetica do PDFKit não tem glifos de setas Unicode
            if (delta > 2) { tendencia = `MELHOROU +${delta}`; corT = COR.verde; }
            else if (delta < -2) { tendencia = `PIOROU ${delta}`; corT = COR.vermelho; }
            else { tendencia = `ESTÁVEL (${delta >= 0 ? '+' : ''}${delta})`; corT = COR.cinza; }
          }
          doc.fillColor('#111827').fontSize(7.5).font('Helvetica').text(dataTxt, MARGEM, y, { width: 80 });
          doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(h.numero ? `#${h.numero}` : '-', MARGEM + 85, y, { width: 60 });
          doc.fillColor('#111827').fontSize(7.5).font('Helvetica-Bold').text(scoreTxt, MARGEM + 150, y, { width: 50, align: 'right' });
          doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(classifTxt, MARGEM + 210, y, { width: 120 });
          doc.fillColor(corT).fontSize(7).font('Helvetica-Bold').text(tendencia, MARGEM + 335, y, { width: 90 });
          y += 12;
        });
        if (historicoLista.length > 5) {
          y = verificarPagina(doc, y, 12);
          doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica-Oblique').text(`(+${historicoLista.length - 5} consulta(s) anterior(es) não exibida(s))`, MARGEM, y, { width: LARGURA });
          y += 10;
        }
        y += 6;
      }

      // ════ DADOS CADASTRAIS — PJ ════
      if (pedido.alvo_tipo === 'PJ') {
        y = secao(doc, 'DADOS CADASTRAIS - RECEITA FEDERAL', y);
        if (cadastral.razao_social) {
          y = linha(doc, 'Razao Social', cadastral.razao_social, y, 13);
          if (cadastral.nome_fantasia) { y = linha(doc, 'Nome Fantasia', cadastral.nome_fantasia, y, 13); }
          y = linha(doc, 'CNPJ', cadastral.cnpj_formatado || cadastral.cnpj, y, 13);
          y = linha(doc, 'Situacao RF', cadastral.situacao || '-', y, 13);
          y = linha(doc, 'Abertura', cadastral.data_abertura || '-', y, 13);
          y = linha(doc, 'Porte', cadastral.porte || '-', y, 13);
          y = linha(doc, 'Capital Social', cadastral.capital_social ? `R$ ${Number(cadastral.capital_social).toLocaleString('pt-BR')}` : '-', y, 13);
          y = linha(doc, 'Atividade', cadastral.atividade_principal || '-', y, 13);
          if (cadastral.simples_nacional) { y = linha(doc, 'Simples Nacional', cadastral.simples_nacional, y, 13); }
          y = linha(doc, 'Endereco', cadastral.endereco || '-', y, 13);
          if (cadastral.email) { y = linha(doc, 'Email', cadastral.email, y, 13); }
          if (cadastral.telefone) { y = linha(doc, 'Telefone', cadastral.telefone, y, 13); }

          if (cadastral.socios?.length > 0) {
            y += 4;
            doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('QUADRO SOCIETARIO', MARGEM, y); y += 14;
            cadastral.socios.forEach((s, i) => {
              y = verificarPagina(doc, y, 22);
              doc.rect(MARGEM, y, LARGURA, 20).fill(i % 2 === 0 ? '#f9fafb' : '#ffffff');
              doc.fillColor('#111827').fontSize(8).font('Helvetica-Bold').text(s.nome, MARGEM + 6, y + 3);
              doc.font('Helvetica').fillColor(COR.cinza).text(`${s.qualificacao || ''}  |  Desde: ${s.desde || 'N/D'}`, MARGEM + 6, y + 12);
              y += 22;
            });
          }
          y += 8;
        } else {
          y = avisoBox(doc, y, 'Dados cadastrais nao retornados pela API. Verifique CNPJA_API_KEY.');
        }
      }

      // ════ DADOS CADASTRAIS — PF ════
      if (pedido.alvo_tipo === 'PF') {
        y = secao(doc, 'DADOS CADASTRAIS - PESSOA FISICA', y);

        if (cadastral.aviso) {
          y = avisoBox(doc, y, `${cadastral.aviso} ${cadastral.instrucao || ''}`);
        } else if (cadastral.nome) {
          y = linha(doc, 'Nome', cadastral.nome, y, 13);
          y = linha(doc, 'CPF', cadastral.cpf_formatado || formatarDoc(cadastral.cpf), y, 13);
          if (cadastral.data_nascimento) { y = linha(doc, 'Nascimento', cadastral.data_nascimento, y, 13); }
          if (cadastral.idade) { y = linha(doc, 'Idade', `${cadastral.idade} anos`, y, 13); }
          if (cadastral.sexo) { y = linha(doc, 'Sexo', cadastral.sexo, y, 13); }
          if (cadastral.nome_mae) { y = linha(doc, 'Mae', cadastral.nome_mae, y, 13); }
          if (cadastral.nome_pai) { y = linha(doc, 'Pai', cadastral.nome_pai, y, 13); }
          y = linha(doc, 'Situacao RF', cadastral.situacao_rf || '-', y, 13);
          if (cadastral.obito) {
            y = verificarPagina(doc, y, 18);
            doc.rect(MARGEM, y, LARGURA, 16).fill('#fee2e2');
            doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold').text('REGISTRO DE OBITO ENCONTRADO', MARGEM + 6, y + 3);
            y += 20;
          }
          if (cadastral.profissao) { y = linha(doc, 'Profissao (CBO)', cadastral.profissao, y, 13); }
          if (cadastral.classe_social) { y = linha(doc, 'Classe Social', cadastral.classe_social, y, 13); }
          if (cadastral.renda_estimada) {
            const rotulo = cadastral.renda_inconsistente ? 'Renda Estimada (inconsistente)' : 'Renda Estimada';
            const valor = cadastral.renda_inconsistente ? `${cadastral.renda_estimada} - descartada do score` : cadastral.renda_estimada;
            y = linha(doc, rotulo, valor, y, 13);
          }

          // Parentescos (inline)
          if (cadastral.parentescos?.length > 0) {
            const nomes = cadastral.parentescos.map(p => p.nome + (p.tipo ? ` (${p.tipo})` : '')).join('  |  ');
            const h = doc.heightOfString(nomes, { width: LARGURA - 12, fontSize: 7 });
            y = verificarPagina(doc, y, h + 16);
            y += 2;
            doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('VINCULOS FAMILIARES', MARGEM, y); y += 10;
            doc.fillColor('#111827').fontSize(7).font('Helvetica').text(nomes, MARGEM + 6, y, { width: LARGURA - 12 });
            y += h + 4;
          }
          // Enderecos (inline)
          if (cadastral.enderecos?.length > 0) {
            y = verificarPagina(doc, y, 12 + cadastral.enderecos.length * 10);
            doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('ENDERECOS', MARGEM, y); y += 10;
            cadastral.enderecos.forEach((e, i) => {
              y = verificarPagina(doc, y, 11);
              const end = [e.logradouro, e.numero, e.bairro, e.cidade, e.uf, e.cep].filter(Boolean).join(', ');
              doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`${i + 1}. ${end}`, MARGEM + 6, y, { width: LARGURA - 12 });
              y += 10;
            });
            y += 2;
          }
          // Telefones (inline, separados por |)
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
          // Emails (inline)
          if (cadastral.emails?.length > 0) {
            y = verificarPagina(doc, y, 12);
            const emailsTxt = cadastral.emails.join('  |  ');
            doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('EMAILS', MARGEM, y);
            doc.fillColor('#111827').font('Helvetica').fontSize(7).text(emailsTxt, MARGEM + 50, y);
            y += 10;
          }
          y += 4;
        } else if (cadastral.erro) {
          y = avisoBox(doc, y, 'Dados cadastrais indisponiveis. API retornou erro. Verifique DIRECTD_TOKEN.');
        } else {
          y = avisoBox(doc, y, 'Dados cadastrais nao retornados. Configure DIRECTD_TOKEN.');
        }
      }

      // ════ PROCESSOS JUDICIAIS ════
      y = secao(doc, 'PROCESSOS JUDICIAIS', y);
      const totalP = processos.total || 0;
      if (totalP === 0 && processos.escavador_falhou) {
        doc.rect(MARGEM, y, LARGURA, 30).fill('#fef3c7');
        doc.fillColor('#92400e').fontSize(9).font('Helvetica-Bold').text('Consulta de processos indisponivel.', MARGEM + 8, y + 4);
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

        // ---------- RESUMO JUDICIAL EM LINGUAGEM NATURAL ----------
        const resumoJudicial = construirResumoJudicial(lista, pedido.alvo_documento, pedido.alvo_nome);

        // Cabeçalho com total e fonte
        doc.rect(MARGEM, y, LARGURA, 24).fill('#fef3c7');
        doc.fillColor('#92400e').fontSize(10).font('Helvetica-Bold').text(`${totalP} processo(s) encontrado(s)`, MARGEM + 8, y + 5);
        doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(`Fonte: ${processos.fonte || 'Datajud CNJ'}`, MARGEM + LARGURA - 150, y + 8);
        y += 28;

        const excluidos = processos.excluidos_advogado || 0;
        let resumoCount = `${ativos.length} ativo(s) | ${inativos.length} baixado(s)/inativo(s)`;
        if (excluidos > 0) resumoCount += ` | ${excluidos} excluído(s) (como advogado)`;
        doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(resumoCount, MARGEM + 8, y);
        y += 11;

        // Parágrafo de síntese
        if (resumoJudicial) {
          doc.font('Helvetica').fontSize(8);
          const hRes = doc.heightOfString(resumoJudicial, { width: LARGURA - 16 });
          y = verificarPagina(doc, y, hRes + 14);
          doc.rect(MARGEM, y, LARGURA, hRes + 10).fill('#f9fafb').stroke(COR.borda);
          doc.fillColor('#111827').fontSize(8).font('Helvetica').text(resumoJudicial, MARGEM + 8, y + 5, { width: LARGURA - 16 });
          y += hRes + 14;
        }

        // ---------- TABELA RICA DE PROCESSOS ----------
        // Cabeçalho da tabela
        y = verificarPagina(doc, y, 18);
        doc.rect(MARGEM, y, LARGURA, 14).fill(COR.azul);
        doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
        doc.text('Número / Classe', MARGEM + 6, y + 4, { width: 200, lineBreak: false });
        doc.text('Polo / Valor', MARGEM + 210, y + 4, { width: 170, lineBreak: false });
        doc.text('Tribunal', MARGEM + 385, y + 4, { width: 60, lineBreak: false });
        doc.text('Status', MARGEM + LARGURA - 50, y + 4, { width: 50, lineBreak: false, align: 'right' });
        y += 16;

        lista.slice(0, 15).forEach((proc, i) => {
          // Calcular altura da linha (dinâmica conforme conteúdo)
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

          // estimar altura: 3 linhas de 9 = ~28
          const hLinha = 32;
          y = verificarPagina(doc, y, hLinha);

          const corStatus = proc.status === 'Ativo' ? COR.vermelho : COR.verde;
          const fundo = i % 2 === 0 ? '#ffffff' : '#f9fafb';
          doc.rect(MARGEM, y, LARGURA, hLinha).fill(fundo);
          doc.rect(MARGEM, y, 3, hLinha).fill(corStatus);

          // coluna 1: numero + classe/assunto
          doc.fillColor(COR.azul).fontSize(7).font('Helvetica-Bold').text(numeroTxt, MARGEM + 8, y + 3, { width: 200, lineBreak: false });
          doc.fillColor('#111827').fontSize(6.5).font('Helvetica').text(truncar(classeTxt, 60), MARGEM + 8, y + 13, { width: 200, lineBreak: false });
          if (dataTxt || ultMovTxt) {
            doc.fillColor(COR.cinza).fontSize(6).font('Helvetica').text([dataTxt, ultMovTxt].filter(Boolean).join(' | '), MARGEM + 8, y + 22, { width: 200, lineBreak: false });
          }

          // coluna 2: polo / valor
          doc.fillColor('#111827').fontSize(6.5).font('Helvetica-Bold').text(truncar(poloLabel, 48), MARGEM + 210, y + 3, { width: 170, lineBreak: false });
          if (valorTxt && valorTxt !== '-') {
            doc.fillColor(COR.cinza).fontSize(6).font('Helvetica').text(`Valor causa: ${valorTxt}`, MARGEM + 210, y + 13, { width: 170, lineBreak: false });
          }

          // coluna 3: tribunal
          doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica').text(proc.tribunal || '-', MARGEM + 385, y + 3, { width: 60, lineBreak: false });

          // coluna 4: status
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
        doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text(`Atencao: ${processos.aviso}`, MARGEM, y, { width: LARGURA });
        y += 14;
      }
      if (processos.nota) {
        doc.fillColor(COR.cinza).fontSize(7).font('Helvetica-Oblique').text(processos.nota, MARGEM, y, { width: LARGURA });
        const h = doc.heightOfString(processos.nota, { width: LARGURA, fontSize: 7 });
        y += h + 4;
      }
      y += 6;

      // ════ LISTAS NEGRAS ════
      if (transparencia && transparencia.em_lista_negra !== undefined) {
        y = secao(doc, 'LISTAS NEGRAS FEDERAIS (CGU)', y);
        if (transparencia.em_lista_negra) {
          doc.rect(MARGEM, y, LARGURA, 20).fill('#fee2e2');
          doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold').text('CONSTA EM LISTA NEGRA FEDERAL', MARGEM + 8, y + 4);
          y += 26;
          const todos = [...(transparencia.ceis || []), ...(transparencia.cnep || [])];
          todos.forEach(r => {
            y = verificarPagina(doc, y, 18);
            doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text(`${r.tipo}: ${r.sancao}`, MARGEM + 6, y);
            doc.fillColor(COR.cinza).font('Helvetica').text(`Orgao: ${r.orgao}`, MARGEM + 6, y + 9);
            y += 20;
          });
        } else {
          doc.rect(MARGEM, y, LARGURA, 20).fill('#dcfce7');
          doc.fillColor('#14532d').fontSize(9).font('Helvetica').text('Nao consta em lista negra federal (CEIS/CNEP).', MARGEM + 8, y + 4);
          y += 26;
        }
      }

      // ════ SCORE DE CREDITO ════
      if (scoreCredito.score) {
        y = secao(doc, 'SCORE DE CREDITO (QUOD)', y);
        const scoreCred = Number(scoreCredito.score) || 0;
        const corCred = scoreCred >= 700 ? COR.verde : scoreCred >= 400 ? COR.laranja : COR.vermelho;
        doc.rect(MARGEM, y, LARGURA, 40).fill('#f8fafc').stroke(COR.borda);
        doc.fillColor(corCred).fontSize(22).font('Helvetica-Bold').text(`${scoreCred}`, MARGEM + 10, y + 4);
        doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text('/1000', MARGEM + 55, y + 10);
        doc.fillColor(corCred).fontSize(10).font('Helvetica-Bold').text(scoreCredito.faixa || '', MARGEM + 100, y + 6);
        // Motivos
        if (scoreCredito.motivos?.length > 0) {
          doc.fillColor(COR.cinza).fontSize(7).font('Helvetica');
          scoreCredito.motivos.slice(0, 3).forEach((m, i) => {
            doc.text(`- ${m}`, MARGEM + 100, y + 20 + (i * 9), { width: 380 });
          });
        }
        y += 44 + Math.min((scoreCredito.motivos?.length || 0), 3) * 9;
      }

      // ════ RESTRICOES FINANCEIRAS (Protestos + Negativacoes) ════
      y = secao(doc, 'PROTESTOS E NEGATIVACOES', y);
      if (negativacoes.status && negativacoes.status !== 'Nao consultado') {
        const temPendencia = negativacoes.total_pendencias > 0 || negativacoes.status === 'Consta Pendencia';
        if (!temPendencia) {
          doc.rect(MARGEM, y, LARGURA, 18).fill('#dcfce7');
          doc.fillColor('#14532d').fontSize(8).font('Helvetica-Bold').text('NADA CONSTA - Nenhum protesto ou negativacao encontrada.', MARGEM + 8, y + 4);
          y += 22;
        } else {
          const valorTotal = Number(negativacoes.total_pendencias || 0);
          doc.rect(MARGEM, y, LARGURA, 18).fill('#fee2e2');
          doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica-Bold')
            .text(`CONSTA PENDENCIA | Valor total: R$ ${valorTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}`, MARGEM + 8, y + 4);
          y += 22;

          // Protestos detalhados
          if (negativacoes.protestos?.length > 0) {
            doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text('PROTESTOS EM CARTORIO:', MARGEM, y); y += 10;
            negativacoes.protestos.slice(0, 8).forEach(p => {
              y = verificarPagina(doc, y, 14);
              doc.rect(MARGEM, y, 3, 10).fill(COR.vermelho);
              doc.fillColor('#111827').fontSize(6.5).font('Helvetica-Bold')
                .text(`${p.nome_cartorio || 'Cartorio'}`, MARGEM + 8, y);
              doc.fillColor(COR.cinza).font('Helvetica').fontSize(6)
                .text(`R$ ${Number(p.valor_total_protesto || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})} | ${p.situacao || ''}`, MARGEM + 250, y);
              y += 12;
              // Titulos individuais
              (p.titulos || []).slice(0, 3).forEach(t => {
                y = verificarPagina(doc, y, 10);
                doc.fillColor(COR.cinza).fontSize(5.5).font('Helvetica')
                  .text(`    ${t.tipo || 'Titulo'} - R$ ${Number(t.valor || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})} - ${t.data || ''}`, MARGEM + 16, y);
                y += 9;
              });
            });
            y += 4;
          }

          // Acoes judiciais
          if (negativacoes.acoes_judiciais?.length > 0) {
            doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text('ACOES JUDICIAIS:', MARGEM, y); y += 10;
            negativacoes.acoes_judiciais.slice(0, 5).forEach(a => {
              y = verificarPagina(doc, y, 10);
              doc.fillColor('#111827').fontSize(6.5).font('Helvetica')
                .text(`- ${a.tipo || 'Acao'} | R$ ${Number(a.valor || 0).toLocaleString('pt-BR')} | ${a.data || ''}`, MARGEM + 8, y);
              y += 10;
            });
            y += 4;
          }

          // Cheques sem fundo
          if (negativacoes.cheques_sem_fundo?.length > 0) {
            doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text('CHEQUES SEM FUNDO:', MARGEM, y); y += 10;
            negativacoes.cheques_sem_fundo.slice(0, 3).forEach(c => {
              doc.fillColor('#111827').fontSize(6.5).font('Helvetica')
                .text(`- Banco: ${c.banco || ''} | Ag: ${c.agencia || ''} | ${c.data || ''}`, MARGEM + 8, y);
              y += 10;
            });
            y += 4;
          }
        }
        doc.fillColor(COR.cinza).fontSize(5.5).font('Helvetica').text(`Fonte: ${negativacoes.fonte || 'Direct Data'}`, MARGEM, y); y += 8;
      } else {
        doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text('Consulta de protestos/negativacoes nao realizada.', MARGEM, y);
        y += 12;
      }
      y += 4;

      // ════ PERFIL FINANCEIRO CONSOLIDADO ════
      if (pedido.alvo_tipo === 'PF' && (cadastral.renda_estimada || scoreCredito.score)) {
        y = secao(doc, 'PERFIL FINANCEIRO', y);

        // Calcular nivel de endividamento
        // Nao usa renda para capacidade se foi marcada como inconsistente
        const renda = cadastral.renda_inconsistente
          ? 0
          : (parseFloat(String(cadastral.renda_estimada || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0);
        const pendencias = Number(negativacoes.total_pendencias || 0);
        const scoreQ = Number(scoreCredito.score || 0);
        const totalProcessos = processos.total || 0;

        // Perfil econômico complementar — renda já foi exibida em DADOS CADASTRAIS, não repetir aqui
        if (perfilEco.nivel_socioeconomico) { y = linha(doc, 'Nivel Socioeconomico', perfilEco.nivel_socioeconomico, y, 12); }
        if (perfilEco.poder_aquisitivo) { y = linha(doc, 'Poder Aquisitivo', perfilEco.poder_aquisitivo, y, 12); }
        if (perfilEco.renda_presumida) { y = linha(doc, 'Renda Presumida', `R$ ${Number(perfilEco.renda_presumida).toLocaleString('pt-BR', {minimumFractionDigits:2})}`, y, 12); }
        y += 2;

        // Nivel de endividamento calculado
        let nivelEndividamento = 'Baixo';
        let corEndiv = COR.verde;
        if (pendencias > 0 && renda > 0) {
          const razao = pendencias / (renda * 12);
          if (razao > 5) { nivelEndividamento = 'Critico (divida > 5x renda anual)'; corEndiv = COR.vermelho; }
          else if (razao > 2) { nivelEndividamento = 'Alto (divida > 2x renda anual)'; corEndiv = COR.vermelho; }
          else if (razao > 0.5) { nivelEndividamento = 'Moderado (divida > 50% renda anual)'; corEndiv = COR.laranja; }
          else { nivelEndividamento = 'Baixo (divida < 50% renda anual)'; corEndiv = COR.verde; }
        } else if (pendencias > 0) {
          nivelEndividamento = 'Possui pendencias (renda nao informada)';
          corEndiv = COR.laranja;
        } else {
          nivelEndividamento = 'Sem pendencias financeiras';
          corEndiv = COR.verde;
        }

        y += 2;
        doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('ANALISE DE CAPACIDADE FINANCEIRA', MARGEM, y); y += 14;

        doc.fillColor(corEndiv).fontSize(8).font('Helvetica-Bold').text(`Endividamento: ${nivelEndividamento}`, MARGEM + 6, y); y += 12;

        let capacidade = 'Indeterminada';
        let corCap = COR.cinza;
        if (scoreQ >= 700 && pendencias === 0) { capacidade = 'ALTA - bom pagador, sem restricoes'; corCap = COR.verde; }
        else if (scoreQ >= 500 && pendencias === 0) { capacidade = 'MEDIA - score moderado, sem restricoes'; corCap = COR.laranja; }
        else if (scoreQ >= 500) { capacidade = 'MEDIA COM RESSALVAS - score ok mas possui pendencias'; corCap = COR.laranja; }
        else if (scoreQ > 0) { capacidade = 'BAIXA - score ruim e/ou pendencias ativas'; corCap = COR.vermelho; }
        doc.fillColor(corCap).fontSize(8).font('Helvetica-Bold').text(`Capacidade de Pagamento: ${capacidade}`, MARGEM + 6, y); y += 12;

        // Contar apenas processos ativos
        const processosAtivos = (processos.processos || []).filter(p => p.status === 'Ativo').length;
        const risco = processosAtivos > 5 ? 'ALTO' : processosAtivos > 0 ? 'MODERADO' : 'BAIXO';
        const corRisco = processosAtivos > 5 ? COR.vermelho : processosAtivos > 0 ? COR.laranja : COR.verde;
        doc.fillColor(corRisco).fontSize(8).font('Helvetica-Bold').text(`Risco Judicial: ${risco} (${processosAtivos} processo(s) ativo(s) de ${totalProcessos} total)`, MARGEM + 6, y); y += 14;
      }

      // ════ VINCULOS SOCIETARIOS ════
      if (vinculos.total > 0) {
        y = secao(doc, 'VINCULOS SOCIETARIOS', y);
        doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(`${vinculos.total} empresa(s) vinculada(s)`, MARGEM, y); y += 14;
        (vinculos.empresas || []).slice(0, 10).forEach((emp, i) => {
          y = verificarPagina(doc, y, 24);
          doc.rect(MARGEM, y, LARGURA, 22).fill(i % 2 === 0 ? '#f9fafb' : '#ffffff');
          doc.fillColor(COR.azul).fontSize(7).font('Helvetica-Bold').text(emp.razao_social || 'N/D', MARGEM + 6, y + 3);
          const info = [emp.cnpj, emp.cargo, emp.situacao, emp.data_entrada ? `Desde: ${emp.data_entrada}` : ''].filter(Boolean).join('  |  ');
          doc.fillColor(COR.cinza).font('Helvetica').text(info, MARGEM + 6, y + 13, { width: LARGURA - 12 });
          y += 24;
        });
        doc.fillColor(COR.cinza).fontSize(6).font('Helvetica').text(`Fonte: ${vinculos.fonte || 'Direct Data'}`, MARGEM, y); y += 10;
      }

      // ════ CHECKLIST (compacto) ════
      if (checklist.length > 0) {
        y = secao(doc, 'VERIFICACOES COMPLEMENTARES', y);
        checklist.forEach(c => {
          y = verificarPagina(doc, y, 11);
          const prefixo = c.obrigatorio ? '[!]' : '[o]';
          const cor_item = c.obrigatorio ? COR.vermelho : COR.cinza;
          doc.fillColor(cor_item).fontSize(6).font('Helvetica-Bold').text(prefixo, MARGEM, y);
          doc.fillColor('#111827').font('Helvetica').fontSize(6.5).text(c.item, MARGEM + 20, y, { width: LARGURA - 20 });
          y += 11;
        });
        y += 2;
      }

      // ════ PARECER ════
      if (pedido.observacoes) {
        y = secao(doc, 'PARECER DO ANALISTA', y);
        doc.rect(MARGEM, y, LARGURA, 3).fill(COR.azul); y += 8;
        doc.fillColor('#111827').fontSize(9).font('Helvetica').text(pedido.observacoes, MARGEM, y, { width: LARGURA });
        y += doc.heightOfString(pedido.observacoes, { width: LARGURA }) + 10;
      }

      // ════ BLOCO FINAL: LGPD + FONTES + RODAPE (mantidos juntos) ════
      // Pre-calcular altura total do bloco final para evitar quebras no meio
      const fontes = [
        'Receita Federal do Brasil (CPF/CNPJ)',
        'Direct Data - Cadastro, Score QUOD, Protestos e Negativacoes',
        'Escavador - Processos Judiciais estruturados',
        'Datajud CNJ - Processos nos tribunais (TJGO, TRF1, STJ, TST)',
        'Portal da Transparencia (CGU) - Listas CEIS/CNEP',
        'CNPJa / CNPJ.ws - Dados empresariais'
      ];
      const fontesJoin = fontes.join('  |  ');
      const textoLgpd = 'Este documento contem dados pessoais protegidos pela Lei Geral de Protecao de Dados. E PROIBIDO compartilhar, reproduzir ou repassar este relatorio a terceiros sem autorizacao. O uso indevido sujeita o responsavel as sancoes previstas nos artigos 42 a 45 da LGPD, incluindo multa de ate 2% do faturamento. Uso exclusivo para a finalidade declarada no momento da contratacao.';
      const textoRessalva = 'Caso alguma informacao esteja incorreta ou desatualizada, solicitamos que o titular entre em contato diretamente com a base de dados de origem para solicitar a correcao. A Recobro Recuperacao de Credito nao se responsabiliza por inexatidoes ou desatualizacoes nas bases consultadas.';

      // Medir altura dos textos com wrap
      doc.font('Helvetica').fontSize(6);
      const hLgpdTexto = doc.heightOfString(textoLgpd, { width: LARGURA - 16 });
      doc.fontSize(5.5);
      const hFontes = doc.heightOfString(fontesJoin, { width: LARGURA });
      doc.font('Helvetica-Bold');
      const hRessalva = doc.heightOfString(textoRessalva, { width: LARGURA });

      const hLgpdBox = Math.max(36, hLgpdTexto + 22);
      const alturaBlocoFinal = 6 + hLgpdBox + 6 + 10 + 10 + hFontes + 6 + hRessalva + 10 + 12;

      y = verificarPagina(doc, y, alturaBlocoFinal);

      // LGPD
      y += 6;
      doc.rect(MARGEM, y, LARGURA, hLgpdBox).fill('#fef3c7').stroke('#f59e0b');
      doc.fillColor('#92400e').fontSize(7).font('Helvetica-Bold').text('AVISO LEGAL — LGPD (Lei 13.709/2018)', MARGEM + 8, y + 4);
      doc.fillColor('#92400e').fontSize(6).font('Helvetica')
        .text(textoLgpd, MARGEM + 8, y + 14, { width: LARGURA - 16 });
      y += hLgpdBox + 6;

      // FONTES
      doc.fillColor(COR.azul).fontSize(7).font('Helvetica-Bold').text('FONTES DE DADOS CONSULTADAS', MARGEM, y); y += 10;
      doc.fillColor(COR.cinza).fontSize(6).font('Helvetica')
        .text('As informacoes deste relatorio foram extraidas das seguintes bases de dados publicas e privadas:', MARGEM, y, { width: LARGURA });
      y += 10;
      doc.fillColor(COR.cinza).fontSize(5.5).font('Helvetica')
        .text(fontesJoin, MARGEM, y, { width: LARGURA });
      y += hFontes + 6;

      // RESSALVA
      doc.fillColor('#92400e').fontSize(5.5).font('Helvetica-Bold')
        .text(textoRessalva, MARGEM, y, { width: LARGURA });
      y += hRessalva + 6;

      // RODAPE DO DOCUMENTO
      doc.fillColor(COR.cinza).fontSize(5.5).font('Helvetica')
        .text('Documento gerado pelo sistema Rastreia. Nao substitui consulta juridica especializada. Recobro Recuperacao de Credito | Anapolis - GO', MARGEM, y, { align: 'center', width: LARGURA });

      doc.end();
      stream.on('finish', () => resolve({
        filename,
        filepath,
        url: `/relatorios/${filename}`,
        score: score && typeof score.valor !== 'undefined' ? {
          valor: score.valor,
          classificacao: score.classificacao || null
        } : null
      }));
      stream.on('error', reject);
    } catch (e) {
      console.error('[PDF] Erro ao gerar PDF:', e.message, e.stack);
      reject(e);
    }
  });
}

module.exports = { gerarDossie };
