const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { PRODUTOS, calcularScore, gerarChecklist } = require('./produtos');

const COR = {
  azul: '#1a3a5c', azul_claro: '#2563eb', verde: '#16a34a',
  vermelho: '#dc2626', laranja: '#ea580c', cinza: '#6b7280',
  fundo: '#f9fafb', borda: '#e5e7eb', branco: '#ffffff'
};

const MARGEM = 50;
const LARGURA = 495;
const RODAPE_ALTURA = 60;

function corScore(classificacao) {
  if (classificacao === 'BAIXO RISCO') return COR.verde;
  if (classificacao === 'RISCO MÉDIO') return COR.laranja;
  if (classificacao === 'INDISPONÍVEL') return COR.cinza;
  return COR.vermelho;
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

    const dados = {};
    dadosDB.forEach(d => { dados[d.fonte] = typeof d.dados === 'string' ? JSON.parse(d.dados) : d.dados; });

    const produto = PRODUTOS[pedido.tipo] || {};
    const score = calcularScore(pedido.tipo, dados);
    const checklist = gerarChecklist(pedido.tipo, dados);
    const cadastral = dados.receita_federal || {};
    const processos = dados.processos || {};
    const transparencia = dados.transparencia || {};
    const serasa = dados.serasa || {};

    // ════════════════════════════════════════════
    // CABEÇALHO
    // ════════════════════════════════════════════
    doc.rect(0, 0, 595, 85).fill(COR.azul);
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('RASTREIA', MARGEM, 18);
    doc.fontSize(9).font('Helvetica').text('Sistema de Consultas e Dossiês | Recobro Recuperacao de Credito', MARGEM, 44);
    doc.fontSize(8).text(`Emitido em: ${new Date().toLocaleString('pt-BR')}  |  Protocolo: #${pedido.numero || pedido.id.substring(0,8).toUpperCase()}`, MARGEM, 58);

    // Tipo do relatório
    doc.rect(0, 85, 595, 30).fill('#e8eef5');
    doc.fillColor(COR.azul).fontSize(12).font('Helvetica-Bold')
      .text(`${(produto.nome || pedido.tipo).toUpperCase()}`, MARGEM, 93);

    let y = 128;

    // ════════════════════════════════════════════
    // ALVO DA CONSULTA (compacto)
    // ════════════════════════════════════════════
    y = secao(doc, 'DADOS DO PEDIDO', y);
    const docFormatado = pedido.alvo_documento.length === 11
      ? pedido.alvo_documento.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
      : pedido.alvo_documento.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    linha(doc, 'Alvo', `${pedido.alvo_nome}  |  ${docFormatado}  |  ${pedido.alvo_tipo === 'PF' ? 'Pessoa Fisica' : 'Pessoa Juridica'}`, y); y += 16;
    linha(doc, 'Solicitante', pedido.cliente_nome, y); y += 20;

    // ════════════════════════════════════════════
    // SCORE DE RISCO
    // ════════════════════════════════════════════
    y = secao(doc, 'SCORE DE RISCO', y);
    const corS = corScore(score.classificacao);
    doc.rect(MARGEM, y, LARGURA, 55).fill('#f8fafc').stroke(COR.borda);

    // Círculo do score
    doc.circle(95, y + 27, 22).fill(corS);
    const scoreText = score.score === '-' ? '?' : `${score.score}`;
    doc.fillColor('#ffffff').fontSize(scoreText.length > 2 ? 14 : 18).font('Helvetica-Bold').text(scoreText, 73, y + 17, { width: 44, align: 'center' });

    // Classificação e recomendação
    doc.fillColor(corS).fontSize(13).font('Helvetica-Bold').text(score.classificacao, 130, y + 8);
    doc.fillColor('#374151').fontSize(8).font('Helvetica').text(score.recomendacao, 130, y + 26, { width: 400 });
    y += 62;

    // Alertas (compactos)
    if (score.alertas.length > 0) {
      score.alertas.forEach(a => {
        y = verificarPagina(doc, y);
        doc.rect(MARGEM, y, LARGURA, 15).fill('#fef3c7');
        doc.fillColor('#92400e').fontSize(7.5).font('Helvetica').text(`! ${a}`, MARGEM + 6, y + 3, { width: LARGURA - 12 });
        y += 18;
      });
      y += 4;
    }

    // ════════════════════════════════════════════
    // DADOS CADASTRAIS — PJ
    // ════════════════════════════════════════════
    if (pedido.alvo_tipo === 'PJ') {
      y = verificarPagina(doc, y, 120);
      y = secao(doc, 'DADOS CADASTRAIS — RECEITA FEDERAL', y);

      if (cadastral.razao_social) {
        linha(doc, 'Razao Social', cadastral.razao_social, y); y += 15;
        if (cadastral.nome_fantasia) { linha(doc, 'Nome Fantasia', cadastral.nome_fantasia, y); y += 15; }
        linha(doc, 'CNPJ', cadastral.cnpj_formatado || cadastral.cnpj, y); y += 15;
        linha(doc, 'Situacao RF', cadastral.situacao || 'Nao informado', y); y += 15;
        linha(doc, 'Abertura', cadastral.data_abertura ? `${cadastral.data_abertura} (${new Date().getFullYear() - new Date(cadastral.data_abertura).getFullYear()} anos)` : '-', y); y += 15;
        linha(doc, 'Porte', cadastral.porte || '-', y); y += 15;
        linha(doc, 'Natureza Juridica', cadastral.natureza_juridica || '-', y); y += 15;
        linha(doc, 'Capital Social', cadastral.capital_social ? `R$ ${Number(cadastral.capital_social).toLocaleString('pt-BR')}` : '-', y); y += 15;
        linha(doc, 'Atividade', cadastral.atividade_principal || '-', y); y += 15;
        if (cadastral.simples_nacional) { linha(doc, 'Simples Nacional', cadastral.simples_nacional, y); y += 15; }
        linha(doc, 'Endereco', cadastral.endereco || 'Nao informado', y); y += 15;
        if (cadastral.email) { linha(doc, 'Email', cadastral.email, y); y += 15; }
        if (cadastral.telefone) { linha(doc, 'Telefone', cadastral.telefone, y); y += 15; }

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
        avisoSemDados(doc, y, 'Dados cadastrais nao disponiveis. Configure CNPJA_API_KEY ou CPFCNPJ_API_KEY.');
        y += 30;
      }
    }

    // ════════════════════════════════════════════
    // DADOS CADASTRAIS — PF
    // ════════════════════════════════════════════
    if (pedido.alvo_tipo === 'PF') {
      y = verificarPagina(doc, y, 120);
      y = secao(doc, 'DADOS CADASTRAIS — PESSOA FISICA', y);

      if (cadastral.nome) {
        linha(doc, 'Nome', cadastral.nome, y); y += 15;
        linha(doc, 'CPF', cadastral.cpf_formatado || cadastral.cpf, y); y += 15;
        if (cadastral.data_nascimento) { linha(doc, 'Nascimento', cadastral.data_nascimento, y); y += 15; }
        if (cadastral.idade) { linha(doc, 'Idade', `${cadastral.idade} anos`, y); y += 15; }
        if (cadastral.sexo) { linha(doc, 'Sexo', cadastral.sexo, y); y += 15; }
        if (cadastral.nome_mae) { linha(doc, 'Mae', cadastral.nome_mae, y); y += 15; }
        if (cadastral.nome_pai) { linha(doc, 'Pai', cadastral.nome_pai, y); y += 15; }
        linha(doc, 'Situacao RF', cadastral.situacao_rf || '-', y); y += 15;

        if (cadastral.obito) {
          y = verificarPagina(doc, y);
          doc.rect(MARGEM, y, LARGURA, 18).fill('#fee2e2');
          doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold').text('REGISTRO DE OBITO ENCONTRADO', MARGEM + 6, y + 4);
          y += 22;
        }

        if (cadastral.classe_social) { linha(doc, 'Classe Social', cadastral.classe_social, y); y += 15; }
        if (cadastral.renda_estimada) { linha(doc, 'Renda Estimada', cadastral.renda_estimada, y); y += 15; }

        // Endereços
        if (cadastral.enderecos?.length > 0) {
          y += 4;
          doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('ENDERECOS', MARGEM, y); y += 12;
          cadastral.enderecos.forEach((e, i) => {
            y = verificarPagina(doc, y);
            const end = [e.logradouro, e.numero, e.bairro, e.cidade, e.uf, e.cep].filter(Boolean).join(', ');
            doc.fillColor('#111827').fontSize(8).font('Helvetica').text(`${i + 1}. ${end}`, MARGEM + 6, y, { width: LARGURA - 12 });
            y += 13;
          });
        }

        // Telefones
        if (cadastral.telefones?.length > 0) {
          y += 4;
          doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('TELEFONES', MARGEM, y); y += 12;
          cadastral.telefones.forEach(t => {
            y = verificarPagina(doc, y);
            const wpp = t.whatsapp ? ' [WhatsApp]' : '';
            const info = [t.numero, t.tipo, t.operadora].filter(Boolean).join(' - ');
            doc.fillColor('#111827').fontSize(8).font('Helvetica').text(`• ${info}${wpp}`, MARGEM + 6, y);
            y += 12;
          });
        }

        // Emails
        if (cadastral.emails?.length > 0) {
          y += 4;
          doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('EMAILS', MARGEM, y); y += 12;
          cadastral.emails.forEach(e => {
            doc.fillColor('#111827').fontSize(8).font('Helvetica').text(`• ${e}`, MARGEM + 6, y);
            y += 12;
          });
        }
        y += 6;

      } else if (cadastral.erro) {
        avisoSemDados(doc, y, `Falha na consulta: ${cadastral.detalhes || cadastral.erro}`);
        y += 30;
      } else if (cadastral.aviso) {
        avisoSemDados(doc, y, `${cadastral.aviso} ${cadastral.instrucao || ''}`);
        y += 30;
      } else {
        avisoSemDados(doc, y, 'Dados cadastrais nao disponiveis. Configure DIRECTD_TOKEN ou CPFCNPJ_API_KEY.');
        y += 30;
      }
    }

    // ════════════════════════════════════════════
    // PROCESSOS JUDICIAIS
    // ════════════════════════════════════════════
    y = verificarPagina(doc, y, 60);
    y = secao(doc, 'PROCESSOS JUDICIAIS', y);
    const totalP = processos.total || 0;
    const corP = totalP === 0 ? COR.verde : totalP < 5 ? COR.laranja : COR.vermelho;

    // Resumo em uma linha
    doc.rect(MARGEM, y, LARGURA, 24).fill(totalP === 0 ? '#dcfce7' : '#fef3c7');
    doc.fillColor(totalP === 0 ? '#14532d' : '#92400e').fontSize(10).font('Helvetica-Bold')
      .text(totalP === 0 ? 'Nenhum processo encontrado' : `${totalP} processo(s) encontrado(s)`, MARGEM + 8, y + 6);
    doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(`Fonte: ${processos.fonte || 'Datajud CNJ'}`, MARGEM + LARGURA - 150, y + 8);
    y += 30;

    if (processos.processos?.length > 0) {
      processos.processos.slice(0, 15).forEach((p, i) => {
        y = verificarPagina(doc, y, 45);
        doc.rect(MARGEM, y, LARGURA, 40).fill(i % 2 === 0 ? '#f9fafb' : '#fff').stroke(COR.borda);
        doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text(p.numero || 'S/N', MARGEM + 6, y + 4);
        doc.fillColor(COR.cinza).font('Helvetica').fontSize(7)
          .text(`${p.tribunal || ''}  |  ${p.classe || ''}  |  Inicio: ${p.data_inicio || 'N/D'}${p.valor_causa ? '  |  ' + p.valor_causa : ''}`, MARGEM + 6, y + 16);
        if (p.assunto) doc.fillColor('#111827').text(`Assunto: ${p.assunto}`, MARGEM + 6, y + 27, { width: LARGURA - 12 });
        y += 44;
      });
    }

    if (processos.link_jusbrasil) {
      doc.fillColor(COR.azul_claro).fontSize(7).font('Helvetica').text(`Verificar tambem: ${processos.link_jusbrasil}`, MARGEM, y);
      y += 12;
    }
    y += 6;

    // ════════════════════════════════════════════
    // LISTAS NEGRAS FEDERAIS
    // ════════════════════════════════════════════
    if (transparencia && transparencia.em_lista_negra !== undefined) {
      y = verificarPagina(doc, y, 40);
      y = secao(doc, 'LISTAS NEGRAS FEDERAIS (CGU)', y);
      if (transparencia.em_lista_negra) {
        doc.rect(MARGEM, y, LARGURA, 22).fill('#fee2e2');
        doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold').text('CONSTA EM LISTA NEGRA FEDERAL', MARGEM + 8, y + 5);
        y += 28;
        const todos = [...(transparencia.ceis || []), ...(transparencia.cnep || [])];
        todos.forEach(r => {
          y = verificarPagina(doc, y, 18);
          doc.fillColor(COR.vermelho).fontSize(7).font('Helvetica-Bold').text(`${r.tipo}: ${r.sancao}`, MARGEM + 6, y);
          doc.fillColor(COR.cinza).font('Helvetica').text(`Orgao: ${r.orgao}`, MARGEM + 6, y + 9);
          y += 20;
        });
      } else {
        doc.rect(MARGEM, y, LARGURA, 22).fill('#dcfce7');
        doc.fillColor('#14532d').fontSize(9).font('Helvetica').text('Nao consta em lista negra federal (CEIS/CNEP)', MARGEM + 8, y + 5);
        y += 28;
      }
    } else if (pedido.alvo_tipo === 'PJ') {
      y = verificarPagina(doc, y, 40);
      y = secao(doc, 'LISTAS NEGRAS FEDERAIS (CGU)', y);
      avisoSemDados(doc, y, 'Configure TRANSPARENCIA_TOKEN para consultar CEIS/CNEP automaticamente.');
      y += 30;
    }

    // ════════════════════════════════════════════
    // SERASA / NEGATIVAÇÕES
    // ════════════════════════════════════════════
    y = verificarPagina(doc, y, 40);
    y = secao(doc, 'RESTRICOES FINANCEIRAS', y);
    if (serasa?.disponivel === false) {
      doc.rect(MARGEM, y, LARGURA, 20).fill('#f3f4f6');
      doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text(serasa.nota || 'Consulta Serasa requer contrato empresarial.', MARGEM + 8, y + 5);
      y += 24;
    }

    // ════════════════════════════════════════════
    // CHECKLIST DO ANALISTA (compacto)
    // ════════════════════════════════════════════
    if (checklist.length > 0) {
      y = verificarPagina(doc, y, 50);
      y = secao(doc, 'VERIFICACOES COMPLEMENTARES', y);
      checklist.forEach(c => {
        y = verificarPagina(doc, y, 14);
        const prefixo = c.obrigatorio ? '[OBRIG.]' : '[Opc.]';
        const cor_item = c.obrigatorio ? COR.vermelho : COR.cinza;
        const textoCompleto = `${prefixo} ${c.item}${c.link ? ' — ' + c.link : ''}`;
        doc.fillColor(cor_item).fontSize(6.5).font('Helvetica').text(textoCompleto, MARGEM, y, { width: LARGURA });
        y += 11;
      });
      y += 6;
    }

    // ════════════════════════════════════════════
    // PARECER DO ANALISTA
    // ════════════════════════════════════════════
    if (pedido.observacoes) {
      y = verificarPagina(doc, y, 50);
      y = secao(doc, 'PARECER DO ANALISTA', y);
      doc.rect(MARGEM, y, LARGURA, 3).fill(COR.azul); y += 8;
      doc.fillColor('#111827').fontSize(9).font('Helvetica').text(pedido.observacoes, MARGEM, y, { width: LARGURA });
      y += doc.heightOfString(pedido.observacoes, { width: LARGURA }) + 10;
    }

    // Rodapé na última página
    rodape(doc);

    doc.end();
    stream.on('finish', () => resolve({ filename, filepath, url: `/relatorios/${filename}` }));
    stream.on('error', reject);
    } catch (e) {
      console.error('[PDF] Erro ao gerar PDF:', e.message, e.stack);
      reject(e);
    }
  });
}

// ── HELPERS ──
function secao(doc, titulo, y) {
  doc.moveTo(MARGEM, y).lineTo(MARGEM + LARGURA, y).strokeColor(COR.azul_claro).lineWidth(1).stroke();
  y += 4;
  doc.fillColor(COR.azul).fontSize(10).font('Helvetica-Bold').text(titulo, MARGEM, y);
  y += 16;
  return y;
}

function linha(doc, label, valor, y) {
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COR.cinza).text(label + ':', MARGEM, y, { width: 120 });
  doc.font('Helvetica').fillColor('#111827').text(valor || '-', MARGEM + 125, y, { width: LARGURA - 125 });
}

function avisoSemDados(doc, y, msg) {
  doc.rect(MARGEM, y, LARGURA, 22).fill('#fef3c7');
  doc.fillColor('#92400e').fontSize(8).font('Helvetica').text(msg, MARGEM + 8, y + 5, { width: LARGURA - 16 });
}

function rodape(doc) {
  const altPag = doc.page.height;
  doc.rect(0, altPag - RODAPE_ALTURA, 595, RODAPE_ALTURA).fill('#f3f4f6');
  doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica')
    .text('Documento informativo gerado pelo sistema Rastreia. Nao substitui consulta juridica especializada.', MARGEM, altPag - 48, { align: 'center', width: LARGURA })
    .text('Recobro Recuperacao de Credito  |  Anapolis - GO', MARGEM, altPag - 34, { align: 'center', width: LARGURA });
}

function verificarPagina(doc, y, espacoNecessario) {
  const espaco = espacoNecessario || 20;
  if (y + espaco > doc.page.height - RODAPE_ALTURA - 20) {
    rodape(doc);
    doc.addPage();
    return MARGEM;
  }
  return y;
}

module.exports = { gerarDossie };
