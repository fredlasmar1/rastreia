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
  y = verificarPagina(doc, y, 30);
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
        linha(doc, 'Placa', pedido.alvo_placa || v.placa || '-', y); y += 16;
        linha(doc, 'Solicitante', pedido.cliente_nome, y); y += 20;

        if (!v.disponivel) {
          y = avisoBox(doc, y, `Consulta indisponível: ${v.erro || 'sem retorno da API'}${v.detalhes ? ' - ' + v.detalhes : ''}`);
        } else {
          y = secao(doc, 'IDENTIFICACAO DO VEICULO', y);
          linha(doc, 'Marca / Modelo', v.marca_modelo || [v.marca, v.modelo].filter(Boolean).join(' ') || '-', y); y += 15;
          if (v.ano_modelo || v.ano_fabricacao) {
            linha(doc, 'Ano', `${v.ano_fabricacao || '?'}/${v.ano_modelo || '?'}`, y); y += 15;
          }
          if (v.cor) { linha(doc, 'Cor', v.cor, y); y += 15; }
          if (v.combustivel) { linha(doc, 'Combustivel', v.combustivel, y); y += 15; }
          if (v.chassi) { linha(doc, 'Chassi', v.chassi, y); y += 15; }
          if (v.renavam) { linha(doc, 'Renavam', v.renavam, y); y += 15; }
          if (v.municipio || v.uf) { linha(doc, 'Registro', [v.municipio, v.uf].filter(Boolean).join(' / '), y); y += 15; }
          y += 6;

          y = secao(doc, 'SITUACAO E RESTRICOES', y);
          linha(doc, 'Situacao', v.situacao || 'Sem informacao', y); y += 15;
          if (v.restricoes && v.restricoes.length > 0) {
            y += 2;
            doc.fillColor(COR.vermelho).fontSize(9).font('Helvetica-Bold').text('RESTRICOES ENCONTRADAS', MARGEM, y); y += 14;
            v.restricoes.forEach((r, i) => {
              y = verificarPagina(doc, y, 18);
              doc.rect(MARGEM, y, LARGURA, 16).fill('#fee2e2');
              doc.fillColor(COR.vermelho).fontSize(8).font('Helvetica').text(`${i + 1}. ${String(r)}`, MARGEM + 6, y + 4, { width: LARGURA - 12 });
              y += 18;
            });
          } else {
            y = verificarPagina(doc, y, 18);
            doc.rect(MARGEM, y, LARGURA, 16).fill('#d1fae5');
            doc.fillColor('#065f46').fontSize(8).font('Helvetica-Bold').text('Nenhuma restricao identificada', MARGEM + 6, y + 4);
            y += 20;
          }
          y += 6;

          if (v.fipe_valor || v.fipe_codigo) {
            y = secao(doc, 'AVALIACAO FIPE', y);
            if (v.fipe_valor) { linha(doc, 'Valor FIPE', typeof v.fipe_valor === 'number' ? `R$ ${Number(v.fipe_valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}` : String(v.fipe_valor), y); y += 15; }
            if (v.fipe_codigo) { linha(doc, 'Codigo FIPE', v.fipe_codigo, y); y += 15; }
            if (v.fipe_mes_referencia) { linha(doc, 'Mes referencia', v.fipe_mes_referencia, y); y += 15; }
            y += 6;
          }
        }

        // Pular o resto do pipeline PF/PJ
        doc.end();
        stream.on('finish', () => resolve({ path: filepath, url: `/relatorios/${filename}` }));
        return;
      }

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
          if (cadastral.profissao) { linha(doc, 'Profissao (CBO)', cadastral.profissao, y); y += 15; }
          if (cadastral.classe_social) { linha(doc, 'Classe Social', cadastral.classe_social, y); y += 15; }
          if (cadastral.renda_estimada) { linha(doc, 'Renda Estimada', cadastral.renda_estimada, y); y += 15; }

          // Parentescos (inline)
          if (cadastral.parentescos?.length > 0) {
            const nomes = cadastral.parentescos.map(p => p.nome + (p.tipo ? ` (${p.tipo})` : '')).join('  |  ');
            y += 2;
            doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('VINCULOS FAMILIARES', MARGEM, y); y += 10;
            doc.fillColor('#111827').fontSize(7).font('Helvetica').text(nomes, MARGEM + 6, y, { width: LARGURA - 12 });
            y += doc.heightOfString(nomes, { width: LARGURA - 12 }) + 4;
          }
          // Enderecos (inline)
          if (cadastral.enderecos?.length > 0) {
            doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('ENDERECOS', MARGEM, y); y += 10;
            cadastral.enderecos.forEach((e, i) => {
              const end = [e.logradouro, e.numero, e.bairro, e.cidade, e.uf, e.cep].filter(Boolean).join(', ');
              doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`${i + 1}. ${end}`, MARGEM + 6, y, { width: LARGURA - 12 });
              y += 10;
            });
            y += 2;
          }
          // Telefones (inline, separados por |)
          if (cadastral.telefones?.length > 0) {
            doc.fillColor(COR.azul).fontSize(8).font('Helvetica-Bold').text('TELEFONES', MARGEM, y); y += 10;
            cadastral.telefones.forEach(t => {
              const wpp = t.whatsapp ? ' [WPP]' : '';
              const info = [t.numero, t.tipo, t.operadora].filter(Boolean).join(' - ');
              doc.fillColor('#111827').fontSize(7).font('Helvetica').text(`- ${info}${wpp}`, MARGEM + 6, y);
              y += 9;
            });
            y += 2;
          }
          // Emails (inline)
          if (cadastral.emails?.length > 0) {
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
        // Escavador falhou, fallback Datajud tambem vazio -> nao e NADA CONSTA, e indisponibilidade
        doc.rect(MARGEM, y, LARGURA, 30).fill('#fef3c7');
        doc.fillColor('#92400e').fontSize(9).font('Helvetica-Bold').text('Consulta de processos indisponivel.', MARGEM + 8, y + 4);
        doc.fillColor('#92400e').fontSize(7).font('Helvetica').text(`Escavador retornou ${processos.escavador_status_http || 'erro'}: ${processos.escavador_detalhes || 'falha na autenticacao/token'}. Datajud (TJGO/TRF1/STJ/TST) tambem vazio. Recomenda-se reexecutar a consulta apos corrigir o token do Escavador.`, MARGEM + 8, y + 16, { width: LARGURA - 16 });
        y += 40;
      } else if (totalP === 0) {
        doc.rect(MARGEM, y, LARGURA, 24).fill('#dcfce7');
        doc.fillColor('#14532d').fontSize(9).font('Helvetica').text('Nenhum processo encontrado nas bases consultadas.', MARGEM + 8, y + 6);
        y += 30;
      } else {
        doc.rect(MARGEM, y, LARGURA, 24).fill('#fef3c7');
        doc.fillColor('#92400e').fontSize(10).font('Helvetica-Bold').text(`${totalP} processo(s) encontrado(s)`, MARGEM + 8, y + 5);
        doc.fillColor(COR.cinza).fontSize(7).font('Helvetica').text(`Fonte: ${processos.fonte || 'Datajud CNJ'}`, MARGEM + LARGURA - 150, y + 8);
        y += 30;

        const ativos = (processos.processos || []).filter(p => p.status === 'Ativo');
        const inativos = (processos.processos || []).filter(p => p.status !== 'Ativo');
        const excluidos = processos.excluidos_advogado || 0;
        let resumo = `${ativos.length} ativo(s) | ${inativos.length} baixado(s)/inativo(s)`;
        if (excluidos > 0) resumo += ` | ${excluidos} excluido(s) (como advogado)`;
        doc.fillColor(COR.cinza).fontSize(6.5).font('Helvetica')
          .text(resumo, MARGEM + 8, y - 16);
        y += 4;

        (processos.processos || []).slice(0, 15).forEach((proc, i) => {
          y = verificarPagina(doc, y, 16);
          const corStatus = proc.status === 'Ativo' ? COR.vermelho : COR.verde;
          doc.rect(MARGEM, y, 3, 14).fill(corStatus);
          doc.fillColor(COR.azul).fontSize(6.5).font('Helvetica-Bold').text(proc.numero || 'S/N', MARGEM + 8, y + 2);
          doc.fillColor(COR.cinza).font('Helvetica').fontSize(6)
            .text(`${proc.tribunal || ''} | ${proc.data_inicio || 'N/D'}`, MARGEM + 170, y + 2);
          doc.fillColor(corStatus).fontSize(6).font('Helvetica-Bold')
            .text(proc.status === 'Ativo' ? 'ATIVO' : 'BAIXADO', MARGEM + LARGURA - 45, y + 2);
          y += 16;
        });
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
        const renda = parseFloat(String(cadastral.renda_estimada || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
        const pendencias = Number(negativacoes.total_pendencias || 0);
        const scoreQ = Number(scoreCredito.score || 0);
        const totalProcessos = processos.total || 0;

        // Tabela de perfil
        if (cadastral.renda_estimada) { linha(doc, 'Renda Estimada', cadastral.renda_estimada, y); y += 12; }
        if (cadastral.faixa_salarial) { linha(doc, 'Faixa Salarial', cadastral.faixa_salarial, y); y += 12; }
        if (perfilEco.nivel_socioeconomico) { linha(doc, 'Nivel Socioeconomico', perfilEco.nivel_socioeconomico, y); y += 12; }
        if (perfilEco.poder_aquisitivo) { linha(doc, 'Poder Aquisitivo', perfilEco.poder_aquisitivo, y); y += 12; }
        if (perfilEco.renda_presumida) { linha(doc, 'Renda Presumida', `R$ ${Number(perfilEco.renda_presumida).toLocaleString('pt-BR', {minimumFractionDigits:2})}`, y); y += 12; }
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

      // ════ ALERTA LGPD ════
      y = verificarPagina(doc, y, 40);
      y += 6;
      doc.rect(MARGEM, y, LARGURA, 36).fill('#fef3c7').stroke('#f59e0b');
      doc.fillColor('#92400e').fontSize(7).font('Helvetica-Bold').text('AVISO LEGAL — LGPD (Lei 13.709/2018)', MARGEM + 8, y + 4);
      doc.fillColor('#92400e').fontSize(6).font('Helvetica')
        .text('Este documento contem dados pessoais protegidos pela Lei Geral de Protecao de Dados. E PROIBIDO compartilhar, reproduzir ou repassar este relatorio a terceiros sem autorizacao. O uso indevido sujeita o responsavel as sancoes previstas nos artigos 42 a 45 da LGPD, incluindo multa de ate 2% do faturamento. Uso exclusivo para a finalidade declarada no momento da contratacao.', MARGEM + 8, y + 14, { width: LARGURA - 16 });
      y += 42;

      // ════ FONTES DE DADOS + RODAPE ════
      y += 6;
      doc.fillColor(COR.azul).fontSize(7).font('Helvetica-Bold').text('FONTES DE DADOS CONSULTADAS', MARGEM, y); y += 10;
      doc.fillColor(COR.cinza).fontSize(6).font('Helvetica')
        .text('As informacoes deste relatorio foram extraidas das seguintes bases de dados publicas e privadas:', MARGEM, y, { width: LARGURA });
      y += 10;
      const fontes = [
        'Receita Federal do Brasil (CPF/CNPJ)',
        'Direct Data - Cadastro, Score QUOD, Protestos e Negativacoes',
        'Escavador - Processos Judiciais estruturados',
        'Datajud CNJ - Processos nos tribunais (TJGO, TRF1, STJ, TST)',
        'Portal da Transparencia (CGU) - Listas CEIS/CNEP',
        'CNPJa / CNPJ.ws - Dados empresariais'
      ];
      doc.fillColor(COR.cinza).fontSize(5.5).font('Helvetica')
        .text(fontes.join('  |  '), MARGEM, y, { width: LARGURA });
      y += doc.heightOfString(fontes.join('  |  '), { width: LARGURA }) + 6;

      doc.fillColor('#92400e').fontSize(5.5).font('Helvetica-Bold')
        .text('Caso alguma informacao esteja incorreta ou desatualizada, solicitamos que o titular entre em contato diretamente com a base de dados de origem para solicitar a correcao. A Recobro Recuperacao de Credito nao se responsabiliza por inexatidoes ou desatualizacoes nas bases consultadas.', MARGEM, y, { width: LARGURA });
      y += doc.heightOfString('placeholder', { width: LARGURA }) + 10;

      doc.fillColor(COR.cinza).fontSize(5.5).font('Helvetica')
        .text('Documento gerado pelo sistema Rastreia. Nao substitui consulta juridica especializada. Recobro Recuperacao de Credito | Anapolis - GO', MARGEM, y, { align: 'center', width: LARGURA });

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
