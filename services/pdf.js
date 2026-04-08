const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { PRODUTOS, calcularScore, gerarChecklist } = require('./produtos');

const COR = {
  azul: '#1a3a5c', azul_claro: '#2563eb', verde: '#16a34a',
  vermelho: '#dc2626', laranja: '#ea580c', cinza: '#6b7280',
  fundo: '#f9fafb', borda: '#e5e7eb', branco: '#ffffff'
};

function corScore(classificacao) {
  if (classificacao === 'BAIXO RISCO') return COR.verde;
  if (classificacao === 'RISCO MÉDIO') return COR.laranja;
  if (classificacao === 'INDISPONÍVEL') return COR.cinza;
  return COR.vermelho;
}

function gerarDossie(pedido, dadosDB) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `rastreia_${pedido.tipo}_${pedido.id.substring(0,8)}_${Date.now()}.pdf`;
    const dirRelatorios = path.join(__dirname, '../public/relatorios');
    if (!fs.existsSync(dirRelatorios)) fs.mkdirSync(dirRelatorios, { recursive: true });
    const filepath = path.join(dirRelatorios, filename);
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    // Montar objeto de dados por fonte
    const dados = {};
    dadosDB.forEach(d => { dados[d.fonte] = typeof d.dados === 'string' ? JSON.parse(d.dados) : d.dados; });

    const produto = PRODUTOS[pedido.tipo] || {};
    const score = calcularScore(pedido.tipo, dados);
    const checklist = gerarChecklist(pedido.tipo, dados);
    const cadastral = dados.receita_federal || {};
    const processos = dados.processos || {};
    const transparencia = dados.transparencia || {};
    const serasa = dados.serasa || {};

    // ── CABEÇALHO ──
    doc.rect(0, 0, 595, 95).fill(COR.azul);
    doc.fillColor('#ffffff').fontSize(24).font('Helvetica-Bold').text('🔍 RASTREIA', 50, 22);
    doc.fontSize(10).font('Helvetica').text('Sistema de Consultas e Dossiês | Recobro Recuperação de Crédito', 50, 52);
    doc.fontSize(9).text(`Emitido em: ${new Date().toLocaleString('pt-BR')}   |   Protocolo: #${pedido.numero || pedido.id.substring(0,8).toUpperCase()}`, 50, 68);

    // ── TIPO DO RELATÓRIO ──
    doc.rect(0, 95, 595, 38).fill('#f0f4f8');
    doc.fillColor(COR.azul).fontSize(15).font('Helvetica-Bold')
      .text(`${produto.icone || '📄'} ${(produto.nome || pedido.tipo).toUpperCase()}`, 50, 107);

    let y = 148;

    // ── ALVO DA CONSULTA ──
    y = secao(doc, 'ALVO DA CONSULTA', y);
    linha(doc, 'Nome / Razão Social', pedido.alvo_nome, y); y += 18;
    linha(doc, 'CPF / CNPJ', pedido.alvo_documento, y); y += 18;
    linha(doc, 'Tipo', pedido.alvo_tipo === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica', y); y += 18;
    linha(doc, 'Solicitante', pedido.cliente_nome, y); y += 18;
    y += 8; doc.moveTo(50, y).lineTo(545, y).strokeColor(COR.borda).lineWidth(1).stroke(); y += 14;

    // ── SCORE DE RISCO ──
    y = secao(doc, 'SCORE DE RISCO', y);
    const corS = corScore(score.classificacao);
    doc.rect(50, y, 495, 70).fill('#f8fafc').stroke(COR.borda);
    doc.fillColor(corS).fontSize(32).font('Helvetica-Bold').text(`${score.score}`, 70, y + 10, { width: 60, align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor(COR.cinza).text('/100', 130, y + 22);
    doc.fillColor(corS).fontSize(14).font('Helvetica-Bold').text(score.classificacao, 180, y + 14);
    doc.fillColor('#111827').fontSize(9).font('Helvetica').text(score.recomendacao, 180, y + 34, { width: 350 });
    y += 82;

    if (score.alertas.length > 0) {
      score.alertas.forEach(a => {
        doc.rect(50, y, 495, 18).fill('#fef3c7');
        doc.fillColor('#92400e').fontSize(9).font('Helvetica').text(`⚠ ${a}`, 58, y + 4);
        y += 22;
      });
      y += 6;
    }

    // ── DADOS CADASTRAIS ──
    if (pedido.alvo_tipo === 'PJ' && cadastral.razao_social) {
      y = verificarPagina(doc, y, 200);
      y = secao(doc, '🏢 DADOS CADASTRAIS — RECEITA FEDERAL', y);
      linha(doc, 'Razão Social', cadastral.razao_social, y); y += 18;
      if (cadastral.nome_fantasia) { linha(doc, 'Nome Fantasia', cadastral.nome_fantasia, y); y += 18; }
      linha(doc, 'CNPJ', cadastral.cnpj_formatado || cadastral.cnpj, y); y += 18;
      linha(doc, 'Situação na RF', cadastral.situacao, y); y += 18;
      linha(doc, 'Data de Abertura', cadastral.data_abertura, y); y += 18;
      linha(doc, 'Tempo de Existência', cadastral.data_abertura ? `${new Date().getFullYear() - new Date(cadastral.data_abertura).getFullYear()} anos` : '-', y); y += 18;
      linha(doc, 'Porte', cadastral.porte, y); y += 18;
      linha(doc, 'Natureza Jurídica', cadastral.natureza_juridica, y); y += 18;
      linha(doc, 'Capital Social', cadastral.capital_social ? `R$ ${Number(cadastral.capital_social).toLocaleString('pt-BR')}` : '-', y); y += 18;
      linha(doc, 'Atividade Principal', cadastral.atividade_principal, y); y += 18;
      if (cadastral.simples_nacional) { linha(doc, 'Simples Nacional', cadastral.simples_nacional, y); y += 18; }
      if (cadastral.regime_tributario) { linha(doc, 'Regime Tributário', cadastral.regime_tributario, y); y += 18; }
      linha(doc, 'Endereço', cadastral.endereco, y); y += 18;
      if (cadastral.email) { linha(doc, 'Email', cadastral.email, y); y += 18; }
      if (cadastral.telefone) { linha(doc, 'Telefone', cadastral.telefone, y); y += 18; }

      if (cadastral.socios?.length > 0) {
        y += 6;
        doc.fillColor(COR.azul).fontSize(10).font('Helvetica-Bold').text('QUADRO SOCIETÁRIO', 50, y); y += 16;
        cadastral.socios.forEach((s, i) => {
          y = verificarPagina(doc, y, 30);
          doc.rect(50, y, 495, 24).fill(i % 2 === 0 ? '#f9fafb' : '#ffffff').stroke(COR.borda);
          doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(s.nome, 58, y + 4);
          doc.font('Helvetica').fillColor(COR.cinza).text(`${s.qualificacao}  |  Desde: ${s.desde || 'N/D'}`, 58, y + 14);
          y += 28;
        });
      }
      y += 10;
    }

    if (pedido.alvo_tipo === 'PF' && (cadastral.nome || cadastral.aviso)) {
      y = verificarPagina(doc, y, 180);
      y = secao(doc, '👤 DADOS CADASTRAIS — PESSOA FÍSICA', y);

      if (cadastral.aviso) {
        doc.rect(50, y, 495, 36).fill('#fef3c7');
        doc.fillColor('#92400e').fontSize(9).font('Helvetica').text(`⚠ ${cadastral.aviso}`, 58, y + 6);
        doc.fillColor(COR.azul_claro).text(`→ ${cadastral.instrucao || ''}`, 58, y + 20);
        y += 46;
      } else {
        linha(doc, 'Nome', cadastral.nome, y); y += 18;
        linha(doc, 'CPF', cadastral.cpf_formatado || cadastral.cpf, y); y += 18;
        if (cadastral.data_nascimento) { linha(doc, 'Data de Nascimento', cadastral.data_nascimento, y); y += 18; }
        if (cadastral.idade) { linha(doc, 'Idade', `${cadastral.idade} anos`, y); y += 18; }
        if (cadastral.sexo) { linha(doc, 'Sexo', cadastral.sexo, y); y += 18; }
        if (cadastral.nome_mae) { linha(doc, 'Nome da Mãe', cadastral.nome_mae, y); y += 18; }
        if (cadastral.nome_pai) { linha(doc, 'Nome do Pai', cadastral.nome_pai, y); y += 18; }
        linha(doc, 'Situação na RF', cadastral.situacao_rf || '-', y); y += 18;
        if (cadastral.obito) { doc.fillColor(COR.vermelho).fontSize(10).font('Helvetica-Bold').text('⚠️ REGISTRO DE ÓBITO ENCONTRADO', 50, y); y += 18; }
        if (cadastral.classe_social) { linha(doc, 'Classe Social', cadastral.classe_social, y); y += 18; }
        if (cadastral.renda_estimada) { linha(doc, 'Renda Estimada', cadastral.renda_estimada, y); y += 18; }

        if (cadastral.enderecos?.length > 0) {
          y += 6;
          doc.fillColor(COR.azul).fontSize(10).font('Helvetica-Bold').text('ENDEREÇOS', 50, y); y += 14;
          cadastral.enderecos.forEach((e, i) => {
            const end = `${e.logradouro}, ${e.numero} - ${e.bairro}, ${e.cidade}/${e.uf} - CEP: ${e.cep}`;
            doc.fillColor('#111827').fontSize(9).font('Helvetica').text(`${i + 1}. ${end}`, 58, y, { width: 480 }); y += 16;
          });
        }

        if (cadastral.telefones?.length > 0) {
          y += 6;
          doc.fillColor(COR.azul).fontSize(10).font('Helvetica-Bold').text('TELEFONES', 50, y); y += 14;
          cadastral.telefones.forEach(t => {
            const wpp = t.whatsapp ? ' ✓ WhatsApp' : '';
            doc.fillColor('#111827').fontSize(9).font('Helvetica').text(`• ${t.numero} — ${t.tipo} (${t.operadora})${wpp}`, 58, y); y += 14;
          });
        }

        if (cadastral.emails?.length > 0) {
          y += 4;
          doc.fillColor(COR.azul).fontSize(10).font('Helvetica-Bold').text('EMAILS', 50, y); y += 14;
          cadastral.emails.forEach(e => {
            doc.fillColor('#111827').fontSize(9).font('Helvetica').text(`• ${e}`, 58, y); y += 14;
          });
        }
        y += 8;
      }
    }

    // ── PROCESSOS JUDICIAIS ──
    y = verificarPagina(doc, y, 100);
    y = secao(doc, '⚖️ PROCESSOS JUDICIAIS', y);
    const totalP = processos.total || 0;
    const corP = totalP === 0 ? COR.verde : totalP < 5 ? COR.laranja : COR.vermelho;
    doc.fillColor(corP).fontSize(18).font('Helvetica-Bold').text(`${totalP}`, 50, y);
    doc.fillColor(COR.cinza).fontSize(10).font('Helvetica').text(' processos encontrados', 50 + (totalP > 9 ? 26 : 18), y + 4);
    doc.fillColor(COR.cinza).fontSize(9).text(`Fonte: ${processos.fonte || 'Datajud CNJ'}`, 50, y + 18);
    y += 36;

    if (processos.processos?.length > 0) {
      processos.processos.slice(0, 20).forEach((p, i) => {
        y = verificarPagina(doc, y, 65);
        doc.rect(50, y, 495, 58).fill(i % 2 === 0 ? '#f9fafb' : '#fff').stroke(COR.borda);
        doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text(`${p.numero}`, 58, y + 5);
        doc.fillColor(COR.cinza).font('Helvetica').text(`${p.tribunal}  |  ${p.classe || ''}  |  Início: ${p.data_inicio || 'N/D'}`, 58, y + 18);
        if (p.assunto) doc.fillColor('#111827').text(`Assunto: ${p.assunto}`, 58, y + 30);
        if (p.valor_causa) doc.fillColor(COR.verde).font('Helvetica-Bold').text(`Valor: ${p.valor_causa}`, 380, y + 30);
        if (p.polo_ativo) doc.fillColor('#111827').font('Helvetica').fontSize(8).text(`Polo ativo: ${p.polo_ativo.substring(0, 60)}`, 58, y + 42);
        y += 62;
      });
    } else {
      doc.rect(50, y, 495, 28).fill('#dcfce7');
      doc.fillColor('#14532d').fontSize(10).font('Helvetica').text('✓ Nenhum processo encontrado nas bases consultadas.', 58, y + 8);
      y += 36;
    }

    if (processos.link_jusbrasil) {
      doc.fillColor(COR.azul_claro).fontSize(9).font('Helvetica').text(`Verificar também no JusBrasil: ${processos.link_jusbrasil}`, 50, y);
      y += 18;
    }
    if (processos.nota) {
      doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text(`ℹ ${processos.nota}`, 50, y); y += 14;
    }
    y += 8;

    // ── PORTAL DA TRANSPARÊNCIA / LISTAS NEGRAS ──
    if (transparencia && (transparencia.em_lista_negra !== undefined)) {
      y = verificarPagina(doc, y, 80);
      y = secao(doc, '🏛 LISTAS NEGRAS FEDERAIS (CGU)', y);
      if (transparencia.em_lista_negra) {
        doc.rect(50, y, 495, 28).fill('#fee2e2');
        doc.fillColor(COR.vermelho).fontSize(11).font('Helvetica-Bold').text('⚠️ CONSTA EM LISTA NEGRA FEDERAL', 58, y + 8);
        y += 36;
        const todos = [...(transparencia.ceis || []), ...(transparencia.cnep || [])];
        todos.forEach(r => {
          y = verificarPagina(doc, y, 40);
          doc.rect(50, y, 495, 34).fill('#fff5f5').stroke(COR.borda);
          doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold').text(r.tipo, 58, y + 5);
          doc.fillColor('#111827').font('Helvetica').text(`Órgão: ${r.orgao}  |  Sanção: ${r.sancao}`, 58, y + 18);
          y += 38;
        });
      } else if (transparencia.disponivel === false) {
        doc.fillColor(COR.cinza).fontSize(9).font('Helvetica').text(`ℹ ${transparencia.nota || 'Não configurado.'}`, 50, y); y += 18;
      } else {
        doc.rect(50, y, 495, 24).fill('#dcfce7');
        doc.fillColor('#14532d').fontSize(10).font('Helvetica').text('✓ Não consta em nenhuma lista negra federal (CEIS/CNEP).', 58, y + 6);
        y += 30;
      }
      y += 8;
    }

    // ── SERASA ──
    y = verificarPagina(doc, y, 60);
    y = secao(doc, '📊 SERASA / PROTESTOS / NEGATIVAÇÕES', y);
    if (serasa?.disponivel === false) {
      doc.fillColor(COR.cinza).fontSize(9).font('Helvetica').text(serasa.nota || 'Consulta manual necessária.', 50, y); y += 14;
      if (serasa.instrucao) { doc.fillColor(COR.azul_claro).text(`→ ${serasa.instrucao}`, 50, y); y += 14; }
    }
    y += 10;

    // ── CHECKLIST DO ANALISTA ──
    if (checklist.length > 0) {
      y = verificarPagina(doc, y, 100);
      y = secao(doc, '📋 CHECKLIST — VERIFICAÇÕES COMPLEMENTARES', y);
      doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text('Itens a serem verificados manualmente pelo analista para complementar este relatório:', 50, y); y += 14;
      checklist.forEach(c => {
        y = verificarPagina(doc, y, 30);
        const cor_item = c.obrigatorio ? COR.vermelho : COR.cinza;
        const prefixo = c.obrigatorio ? '◉ OBRIGATÓRIO' : '○ Opcional';
        doc.fillColor(cor_item).fontSize(8).font('Helvetica-Bold').text(prefixo, 50, y);
        doc.fillColor('#111827').font('Helvetica').text(c.item, 130, y);
        if (c.link) { doc.fillColor(COR.azul_claro).text(c.link, 130, y + 10, { width: 400 }); y += 10; }
        y += 18;
      });
      y += 8;
    }

    // ── OBSERVAÇÕES DO ANALISTA ──
    if (pedido.observacoes) {
      y = verificarPagina(doc, y, 80);
      y = secao(doc, '📝 PARECER DO ANALISTA', y);
      doc.rect(50, y, 495, 4).fill(COR.azul);
      y += 10;
      doc.fillColor('#111827').fontSize(10).font('Helvetica').text(pedido.observacoes, 50, y, { width: 495 });
      y += doc.heightOfString(pedido.observacoes, { width: 495 }) + 16;
    }

    // ── DADOS DO PRODUTO (o que está incluso) ──
    if (produto.dados_entregues) {
      y = verificarPagina(doc, y, 80);
      y = secao(doc, '📦 O QUE ESTÁ INCLUSO NESTE PRODUTO', y);
      produto.dados_entregues.forEach(secItem => {
        y = verificarPagina(doc, y, 40);
        doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text(`▸ ${secItem.secao}`, 50, y); y += 14;
        doc.fillColor(COR.cinza).font('Helvetica').fontSize(8)
          .text(secItem.campos.join('  ·  '), 58, y, { width: 480 });
        y += doc.heightOfString(secItem.campos.join('  ·  '), { width: 480 }) + 10;
      });
    }

    // ── RODAPÉ ──
    const altPag = doc.page.height;
    doc.rect(0, altPag - 70, 595, 70).fill('#f3f4f6');
    doc.fillColor(COR.cinza).fontSize(7.5).font('Helvetica')
      .text('Este documento possui caráter informativo e foi gerado automaticamente pelo sistema Rastreia com base em fontes públicas oficiais.', 50, altPag - 60, { align: 'center', width: 495 })
      .text('As informações são obtidas de fontes como Receita Federal, Datajud CNJ, Escavador, Direct Data e Portal da Transparência.', 50, altPag - 48, { align: 'center', width: 495 })
      .text('Este relatório não substitui consulta jurídica especializada. Decisões comerciais são de exclusiva responsabilidade do contratante.', 50, altPag - 36, { align: 'center', width: 495 })
      .text('Recobro Recuperação de Crédito  |  Anápolis - GO  |  rastreia.recobro.com.br', 50, altPag - 20, { align: 'center', width: 495 });

    doc.end();
    stream.on('finish', () => resolve({ filename, filepath, url: `/relatorios/${filename}` }));
    stream.on('error', reject);
  });
}

// ── HELPERS ──
function secao(doc, titulo, y) {
  doc.fillColor('#1a3a5c').fontSize(11).font('Helvetica-Bold').text(titulo, 50, y);
  y += 16;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#2563eb').lineWidth(1.5).stroke();
  return y + 10;
}

function linha(doc, label, valor, y) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#6b7280').text(label + ':', 50, y, { width: 140 });
  doc.font('Helvetica').fillColor('#111827').text(valor || 'Não informado', 195, y, { width: 350 });
}

function verificarPagina(doc, y, espacoNecessario) {
  if (y + espacoNecessario > doc.page.height - 90) {
    doc.addPage();
    return 50;
  }
  return y;
}

module.exports = { gerarDossie };
