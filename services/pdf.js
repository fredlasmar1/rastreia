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
const RODAPE_H = 35;

function formatarDoc(doc) {
  if (!doc) return '';
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

function corScore(classificacao) {
  if (classificacao === 'BAIXO RISCO') return COR.verde;
  if (classificacao === 'RISCO MEDIO') return COR.laranja;
  if (classificacao === 'INDISPONIVEL') return COR.cinza;
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
  y = verificarPagina(doc, y, 40);
  doc.fillColor(COR.azul).fontSize(11).font('Helvetica-Bold').text(titulo, MARGEM, y);
  y += 16;
  doc.moveTo(MARGEM, y).lineTo(MARGEM + LARGURA, y).strokeColor(COR.azul_claro).lineWidth(1.5).stroke();
  return y + 10;
}

function linha(doc, label, valor, y) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COR.cinza).text(label + ':', MARGEM, y, { width: 140 });
  doc.font('Helvetica').fillColor('#111827').text(String(valor || '-'), 195, y, { width: 350 });
}

function avisoBox(doc, y, msg, cor) {
  y = verificarPagina(doc, y, 28);
  doc.rect(MARGEM, y, LARGURA, 22).fill(cor || '#fef3c7');
  doc.fillColor('#92400e').fontSize(8).font('Helvetica').text(msg, MARGEM + 8, y + 5, { width: LARGURA - 16 });
  return y + 28;
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
      const doc = new PDFDocument({ margin: MARGEM, size: 'A4', autoFirstPage: true, bufferPages: true });
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
      const vinculos = dados.vinculos || {};
      const serasa = dados.serasa || {};

      // ════ CABECALHO ════
      doc.rect(0, 0, 595, 90).fill(COR.azul);
      doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('RASTREIA', MARGEM, 20);
      doc.fontSize(9).font('Helvetica').text('Sistema de Consultas e Dossies | Recobro Recuperacao de Credito', MARGEM, 46);
      doc.fontSize(8).text(`Emitido em: ${new Date().toLocaleString('pt-BR')}  |  Protocolo: #${pedido.numero || pedido.id.substring(0,8).toUpperCase()}`, MARGEM, 60);

      doc.rect(0, 90, 595, 32).fill('#f0f4f8');
      doc.fillColor(COR.azul).fontSize(13).font('Helvetica-Bold').text((produto.nome || pedido.tipo).toUpperCase(), MARGEM, 98);

      let y = 136;

      // ════ ALVO ════
      y = secao(doc, 'ALVO DA CONSULTA', y);
      linha(doc, 'Nome', pedido.alvo_nome, y); y += 16;
      linha(doc, 'CPF / CNPJ', formatarDoc(pedido.alvo_documento), y); y += 16;
      linha(doc, 'Tipo', pedido.alvo_tipo === 'PF' ? 'Pessoa Fisica' : 'Pessoa Juridica', y); y += 16;
      linha(doc, 'Solicitante', pedido.cliente_nome, y); y += 20;

      // ════ SCORE ════
      y = secao(doc, 'SCORE DE RISCO', y);
      const corS = corScore(score.classificacao);
      doc.rect(MARGEM, y, LARGURA, 60).fill('#f8fafc').stroke(COR.borda);
      const scoreText = score.score === '-' ? '?' : `${score.score}`;
      doc.fillColor(corS).fontSize(28).font('Helvetica-Bold').text(scoreText, 70, y + 8, { width: 50, align: 'center' });
      doc.fontSize(9).font('Helvetica').fillColor(COR.cinza).text('/100', 122, y + 18);
      doc.fillColor(corS).fontSize(13).font('Helvetica-Bold').text(score.classificacao, 170, y + 10);
      doc.fillColor('#111827').fontSize(8).font('Helvetica').text(score.recomendacao, 170, y + 28, { width: 360 });
      y += 68;

      if (score.alertas.length > 0) {
        score.alertas.forEach(a => {
          y = verificarPagina(doc, y, 18);
          doc.rect(MARGEM, y, LARGURA, 15).fill('#fef3c7');
          doc.fillColor('#92400e').fontSize(7.5).font('Helvetica').text(`! ${a}`, MARGEM + 6, y + 3, { width: LARGURA - 12 });
          y += 18;
        });
        y += 4;
      }

      // ════ DADOS CADASTRAIS — PJ ════
      if (pedido.alvo_tipo === 'PJ') {
        y = secao(doc, 'DADOS CADASTRAIS - RECEITA FEDERAL', y);
        if (cadastral.razao_social) {
          linha(doc, 'Razao Social', cadastral.razao_social, y); y += 15;
          if (cadastral.nome_fantasia) { linha(doc, 'Nome Fantasia', cadastral.nome_fantasia, y); y += 15; }
          linha(doc, 'CNPJ', cadastral.cnpj_formatado || cadastral.cnpj, y); y += 15;
          linha(doc, 'Situacao RF', cadastral.situacao || '-', y); y += 15;
          linha(doc, 'Abertura', cadastral.data_abertura || '-', y); y += 15;
          linha(doc, 'Porte', cadastral.porte || '-', y); y += 15;
          linha(doc, 'Capital Social', cadastral.capital_social ? `R$ ${Number(cadastral.capital_social).toLocaleString('pt-BR')}` : '-', y); y += 15;
          linha(doc, 'Atividade', cadastral.atividade_principal || '-', y); y += 15;
          if (cadastral.simples_nacional) { linha(doc, 'Simples Nacional', cadastral.simples_nacional, y); y += 15; }
          linha(doc, 'Endereco', cadastral.endereco || '-', y); y += 15;
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
          y = avisoBox(doc, y, 'Dados cadastrais nao retornados pela API. Verifique CNPJA_API_KEY.');
        }
      }

      // ════ DADOS CADASTRAIS — PF ════
      if (pedido.alvo_tipo === 'PF') {
        y = secao(doc, 'DADOS CADASTRAIS - PESSOA FISICA', y);

        if (cadastral.aviso) {
          y = avisoBox(doc, y, `${cadastral.aviso} ${cadastral.instrucao || ''}`);
        } else if (cadastral.nome) {
          linha(doc, 'Nome', cadastral.nome, y); y += 15;
          linha(doc, 'CPF', cadastral.cpf_formatado || formatarDoc(cadastral.cpf), y); y += 15;
          if (cadastral.data_nascimento) { linha(doc, 'Nascimento', cadastral.data_nascimento, y); y += 15; }
          if (cadastral.idade) { linha(doc, 'Idade', `${cadastral.idade} anos`, y); y += 15; }
          if (cadastral.sexo) { linha(doc, 'Sexo', cadastral.sexo, y); y += 15; }
          if (cadastral.nome_mae) { linha(doc, 'Mae', cadastral.nome_mae, y); y += 15; }
          if (cadastral.nome_pai) { linha(doc, 'Pai', cadastral.nome_pai, y); y += 15; }
          linha(doc, 'Situacao RF', cadastral.situacao_rf || '-', y); y += 15;
          if (cadastral.obito) {
            y = verificarPagina(doc, y, 18);
            doc.rect(MARGEM, y, LARGURA, 16).fill('#fee2e2');
            doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold').text('REGISTRO DE OBITO ENCONTRADO', MARGEM + 6, y + 3);
            y += 20;
          }
          if (cadastral.classe_social) { linha(doc, 'Classe Social', cadastral.classe_social, y); y += 15; }
          if (cadastral.renda_estimada) { linha(doc, 'Renda Estimada', cadastral.renda_estimada, y); y += 15; }

          if (cadastral.enderecos?.length > 0) {
            y += 4;
            doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('ENDERECOS', MARGEM, y); y += 12;
            cadastral.enderecos.forEach((e, i) => {
              y = verificarPagina(doc, y, 14);
              const end = [e.logradouro, e.numero, e.bairro, e.cidade, e.uf, e.cep].filter(Boolean).join(', ');
              doc.fillColor('#111827').fontSize(8).font('Helvetica').text(`${i + 1}. ${end}`, MARGEM + 6, y, { width: LARGURA - 12 });
              y += 13;
            });
          }
          if (cadastral.telefones?.length > 0) {
            y += 4;
            doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('TELEFONES', MARGEM, y); y += 12;
            cadastral.telefones.forEach(t => {
              y = verificarPagina(doc, y, 12);
              const wpp = t.whatsapp ? ' [WhatsApp]' : '';
              const info = [t.numero, t.tipo, t.operadora].filter(Boolean).join(' - ');
              doc.fillColor('#111827').fontSize(8).font('Helvetica').text(`- ${info}${wpp}`, MARGEM + 6, y);
              y += 12;
            });
          }
          if (cadastral.emails?.length > 0) {
            y += 4;
            doc.fillColor(COR.azul).fontSize(9).font('Helvetica-Bold').text('EMAILS', MARGEM, y); y += 12;
            cadastral.emails.forEach(e => {
              doc.fillColor('#111827').fontSize(8).font('Helvetica').text(`- ${e}`, MARGEM + 6, y); y += 12;
            });
          }
          y += 6;
        } else if (cadastral.erro) {
          y = avisoBox(doc, y, 'Dados cadastrais indisponiveis. API retornou erro. Verifique DIRECTD_TOKEN.');
        } else {
          y = avisoBox(doc, y, 'Dados cadastrais nao retornados. Configure DIRECTD_TOKEN.');
        }
      }

      // ════ PROCESSOS JUDICIAIS ════
      y = secao(doc, 'PROCESSOS JUDICIAIS', y);
      const totalP = processos.total || 0;
      if (totalP === 0) {
        doc.rect(MARGEM, y, LARGURA, 24).fill('#dcfce7');
        doc.fillColor('#14532d').fontSize(9).font('Helvetica').text('Nenhum processo encontrado nas bases consultadas.', MARGEM + 8, y + 6);
        y += 30;
      } else {
        doc.rect(MARGEM, y, LARGURA, 24).fill('#fef3c7');
        doc.fillColor('#92400e').fontSize(10).font('Helvetica-Bold').text(`${totalP} processo(s) encontrado(s)`, MARGEM + 8, y + 5);
        doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(`Fonte: ${processos.fonte || 'Datajud CNJ'}`, MARGEM + LARGURA - 150, y + 8);
        y += 30;

        (processos.processos || []).slice(0, 15).forEach((proc, i) => {
          y = verificarPagina(doc, y, 40);
          doc.rect(MARGEM, y, LARGURA, 36).fill(i % 2 === 0 ? '#f9fafb' : '#fff').stroke(COR.borda);
          doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text(proc.numero || 'S/N', MARGEM + 6, y + 4);
          doc.fillColor(COR.cinza).font('Helvetica').fontSize(7)
            .text(`${proc.tribunal || ''}  |  ${proc.classe || ''}  |  Inicio: ${proc.data_inicio || 'N/D'}${proc.valor_causa ? '  |  ' + proc.valor_causa : ''}`, MARGEM + 6, y + 15);
          if (proc.assunto) doc.fillColor('#111827').text(`Assunto: ${proc.assunto}`, MARGEM + 6, y + 25, { width: LARGURA - 12 });
          y += 40;
        });
      }

      if (processos.link_jusbrasil) {
        doc.fillColor(COR.azul_claro).fontSize(7).font('Helvetica').text(`Verificar no JusBrasil: ${processos.link_jusbrasil}`, MARGEM, y);
        y += 12;
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

      // ════ RESTRICOES FINANCEIRAS ════
      y = secao(doc, 'RESTRICOES FINANCEIRAS', y);
      if (negativacoes.status && negativacoes.status !== 'Nao consultado') {
        const temPendencia = negativacoes.total_pendencias > 0 || negativacoes.status === 'Consta Pendencia';
        if (!temPendencia) {
          doc.rect(MARGEM, y, LARGURA, 20).fill('#dcfce7');
          doc.fillColor('#14532d').fontSize(9).font('Helvetica').text('Nada consta - nenhuma pendencia financeira encontrada.', MARGEM + 8, y + 4);
          y += 26;
        } else {
          const valorTotal = Number(negativacoes.total_pendencias || 0);
          doc.rect(MARGEM, y, LARGURA, 20).fill('#fee2e2');
          doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold')
            .text(`${negativacoes.status} | Valor total: R$ ${valorTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}`, MARGEM + 8, y + 4);
          y += 26;

          if (negativacoes.protestos?.length > 0) {
            doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('PROTESTOS:', MARGEM, y); y += 12;
            negativacoes.protestos.slice(0, 5).forEach(p => {
              y = verificarPagina(doc, y, 20);
              doc.fillColor('#111827').fontSize(7).font('Helvetica-Bold')
                .text(`${p.nome_cartorio}`, MARGEM + 8, y);
              doc.fillColor(COR.cinza).font('Helvetica')
                .text(`${p.situacao} | Total: R$ ${Number(p.valor_total_protesto || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}`, MARGEM + 8, y + 9);
              y += 22;
            });
            y += 4;
          }
        }
        doc.fillColor(COR.cinza).fontSize(6).font('Helvetica').text(`Fonte: ${negativacoes.fonte || 'Direct Data'}`, MARGEM, y); y += 10;
      } else {
        doc.fillColor(COR.cinza).fontSize(8).font('Helvetica').text('Consulta de negativacoes nao realizada.', MARGEM, y);
        y += 12;
      }
      y += 6;

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

      // ════ CHECKLIST ════
      if (checklist.length > 0) {
        y = secao(doc, 'VERIFICACOES COMPLEMENTARES', y);
        checklist.forEach(c => {
          y = verificarPagina(doc, y, 22);
          const prefixo = c.obrigatorio ? '[OBRIG.]' : '[Opc.]';
          const cor_item = c.obrigatorio ? COR.vermelho : COR.cinza;
          doc.fillColor(cor_item).fontSize(7).font('Helvetica-Bold').text(prefixo, MARGEM, y);
          doc.fillColor('#111827').font('Helvetica').text(c.item, MARGEM + 50, y, { width: LARGURA - 50 });
          if (c.link && c.link !== '#') { doc.fillColor(COR.azul_claro).fontSize(6.5).text(c.link, MARGEM + 50, y + 9, { width: LARGURA - 50 }); y += 9; }
          y += 14;
        });
        y += 4;
      }

      // ════ PARECER ════
      if (pedido.observacoes) {
        y = secao(doc, 'PARECER DO ANALISTA', y);
        doc.rect(MARGEM, y, LARGURA, 3).fill(COR.azul); y += 8;
        doc.fillColor('#111827').fontSize(9).font('Helvetica').text(pedido.observacoes, MARGEM, y, { width: LARGURA });
        y += doc.heightOfString(pedido.observacoes, { width: LARGURA }) + 10;
      }

      // ════ O QUE ESTA INCLUSO ════
      if (produto.dados_entregues) {
        y = secao(doc, 'O QUE ESTA INCLUSO NESTE PRODUTO', y);
        produto.dados_entregues.forEach(secItem => {
          y = verificarPagina(doc, y, 30);
          doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text(`> ${secItem.secao}`, MARGEM, y); y += 12;
          const txt = secItem.campos.join('  |  ');
          doc.fillColor(COR.cinza).font('Helvetica').fontSize(7).text(txt, MARGEM + 8, y, { width: LARGURA - 16 });
          y += doc.heightOfString(txt, { width: LARGURA - 16 }) + 6;
        });
      }

      // ════ RODAPE em todas as paginas ════
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        rodape(doc);
      }
      // Voltar para a ultima pagina antes de finalizar
      doc.switchToPage(range.count - 1);
      doc.end();
      stream.on('finish', () => resolve({ filename, filepath, url: `/relatorios/${filename}` }));
      stream.on('error', reject);
    } catch (e) {
      console.error('[PDF] Erro ao gerar PDF:', e.message, e.stack);
      reject(e);
    }
  });
}

module.exports = { gerarDossie };
