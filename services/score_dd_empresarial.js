/**
 * RASTREIA — Score AGRESSIVO para Due Diligence Empresarial
 *
 * Reformulação completa: ponto de partida 100, sem limite inferior intermediário.
 * Score final é exibido entre 0 e 100, mas o cálculo pode ir negativo internamente.
 *
 * Dimensões avaliadas:
 *   1. QUOD da empresa
 *   2. Tempo de atividade
 *   3. Capital social vs porte (sinal de inconsistência)
 *   4. Processos da empresa (trabalhistas/fiscais/cíveis)
 *   5. Sócios (cruzamento PF) — score, processos, lista negra
 *   6. Cheques sem fundo
 *   7. Protestos com valor
 *   8. Negativações
 *   9. Listas negras (CEIS/CNEP/CEPIM)
 *  10. CND Federal (PGFN)
 *  11. CND Trabalhista (TST)
 *  12. FGTS
 *  13. CND Estadual
 *  14. CND Municipal
 *
 * Bandas:
 *  - 0-29  : RISCO CRÍTICO          → NÃO PROSSEGUIR
 *  - 30-49 : RISCO ALTO             → NÃO PROSSEGUIR sem garantias robustas
 *  - 50-69 : RISCO MODERADO         → PROSSEGUIR COM RESSALVAS
 *  - 70-84 : RISCO BAIXO-MODERADO   → PROSSEGUIR COM ATENÇÃO
 *  - 85-100: RISCO BAIXO            → PROSSEGUIR
 */

function diasDesde(dataStr) {
  if (!dataStr) return null;
  try {
    const d = new Date(dataStr);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  } catch { return null; }
}

function mesesEntre(dataStr) {
  const dias = diasDesde(dataStr);
  if (dias == null) return null;
  return Math.floor(dias / 30.44);
}

function isMicroEmpresa(porte) {
  const p = String(porte || '').toLowerCase();
  return /\bme\b|microempresa|micro\s+empresa/i.test(p);
}

function isClassEPP(porte) {
  const p = String(porte || '').toLowerCase();
  return /\bepp\b|pequen/i.test(p);
}

function classificarSituacao(situacao) {
  const t = String(situacao || '').toUpperCase();
  if (t.includes('NEGATIVA')) {
    if (t.includes('EFEITO') || t.includes('POSITIVA_COM_EFEITOS_DE_NEGATIVA')) return 'POSITIVA_COM_EFEITOS_DE_NEGATIVA';
    return 'NEGATIVA';
  }
  if (t.includes('POSITIVA')) return 'POSITIVA';
  if (t.includes('REGULAR')) return 'REGULAR';
  if (t.includes('IRREGULAR')) return 'IRREGULAR';
  return null;
}

function calcularScoreDDEmpresarial(dados) {
  if (!dados) dados = {};
  const alertas = [];
  const contribuicoes = [];

  let score = 100;
  const aplicar = (dim, delta, motivo) => {
    if (delta === 0) return;
    score += delta;
    contribuicoes.push({ dimensao: dim, delta, motivo });
  };
  const alertar = (texto, severidade) => alertas.push({ texto, severidade: severidade || 'observar' });

  const cadastral = dados.receita_federal || {};
  const processos = dados.processos || {};
  const transparencia = dados.transparencia || {};
  const scoreQuod = dados.score_credito || {};
  const negativacoes = dados.negativacoes || {};
  const protestos = dados.protestos || {};
  const socios = Array.isArray(dados.socios_enriquecidos) ? dados.socios_enriquecidos : [];
  const pgfn = dados.pgfn || {};
  const cndt = dados.cndt || {};
  const fgts = dados.fgts || {};
  const debitosEstaduais = dados.debitos_estaduais || {};
  const cndMunicipal = dados.cnd_municipal || {};

  // 1. QUOD da empresa ────────────────────────────────────────────
  if (scoreQuod.score) {
    const sq = Number(scoreQuod.score);
    let penal = 0;
    if (sq <= 300) penal = 50;
    else if (sq <= 500) penal = 40;
    else if (sq <= 700) penal = 15;
    if (penal > 0) {
      aplicar('QUOD empresa', -penal, `Score QUOD ${sq}/1000 (${scoreQuod.faixa || 'baixo'})`);
      const sev = sq <= 300 ? 'critico' : sq <= 500 ? 'critico' : 'atencao';
      alertar(`Score QUOD da empresa: ${sq}/1000 — ${scoreQuod.faixa || ''}`, sev);
    } else if (sq > 700) {
      alertar(`Score QUOD da empresa: ${sq}/1000 (saudável)`, 'positivo');
    }
    const motivos = Array.isArray(scoreQuod.motivos) ? scoreQuod.motivos : [];
    let penalAlertas = 0;
    motivos.forEach(() => { penalAlertas += 8; });
    if (penalAlertas > 25) penalAlertas = 25;
    if (penalAlertas > 0) {
      aplicar('Alertas QUOD', -penalAlertas, `${motivos.length} alerta(s) QUOD adicional(is)`);
      motivos.slice(0, 4).forEach(m => alertar(`QUOD: ${m}`, 'atencao'));
    }
  }

  // 2. Tempo de atividade ────────────────────────────────────────
  if (cadastral.data_abertura) {
    const meses = mesesEntre(cadastral.data_abertura);
    if (meses != null) {
      if (meses < 6) {
        aplicar('Tempo de atividade', -15, `Empresa com ${meses} mês(es) — alto risco de ser fachada`);
        alertar(`Empresa muito recente: ${meses} mês(es) de atividade`, 'critico');
      } else if (meses < 12) {
        aplicar('Tempo de atividade', -10, `Empresa com ${meses} meses (menos de 1 ano)`);
        alertar(`Empresa nova: ${meses} meses de atividade`, 'atencao');
      } else if (meses < 24) {
        aplicar('Tempo de atividade', -5, `Empresa com ${Math.floor(meses/12)} ano(s) — ainda jovem`);
        alertar(`Empresa em consolidação: ${Math.floor(meses/12)} ano(s) de atividade`, 'observar');
      } else {
        const anos = Math.floor(meses / 12);
        alertar(`Empresa estabelecida (${anos} ano(s) de atividade)`, 'positivo');
      }
    }
  }

  // 3. Capital social vs porte ───────────────────────────────────
  const capital = Number(cadastral.capital_social || 0);
  const porte = cadastral.porte || '';
  if (capital > 0) {
    if (isMicroEmpresa(porte)) {
      if (capital > 500000) {
        aplicar('Capital vs porte', -15, `ME com capital R$ ${capital.toLocaleString('pt-BR')} — sinal forte de maquiagem`);
        alertar(`Capital social inconsistente: ME com R$ ${capital.toLocaleString('pt-BR')}`, 'critico');
      } else if (capital > 100000) {
        aplicar('Capital vs porte', -8, `ME com capital R$ ${capital.toLocaleString('pt-BR')} — possível inconsistência`);
        alertar(`Capital social acima do esperado para ME: R$ ${capital.toLocaleString('pt-BR')}`, 'atencao');
      }
    } else if (isClassEPP(porte) && capital > 1000000) {
      aplicar('Capital vs porte', -5, `EPP com capital R$ ${capital.toLocaleString('pt-BR')} — verificar consistência`);
      alertar(`Capital social elevado para EPP: R$ ${capital.toLocaleString('pt-BR')}`, 'observar');
    }
  }

  // 4. Processos da empresa ──────────────────────────────────────
  const lista = Array.isArray(processos.processos) ? processos.processos : [];
  const trabalhistas = lista.filter(p => /trabalh/i.test(p.classe || '') || /CLT/i.test(p.classe || ''));
  const execFiscais = lista.filter(p => /execu.{0,3}o\s+fiscal/i.test(p.classe || ''));
  const civeis = lista.filter(p => !trabalhistas.includes(p) && !execFiscais.includes(p));

  if (trabalhistas.length) {
    const penal = Math.min(trabalhistas.length * 5, 25);
    aplicar('Processos trabalhistas', -penal, `${trabalhistas.length} processo(s) trabalhista(s)`);
    alertar(`${trabalhistas.length} processo(s) trabalhista(s) identificado(s)`, trabalhistas.length >= 3 ? 'critico' : 'atencao');
  }
  if (execFiscais.length) {
    const penal = Math.min(execFiscais.length * 8, 30);
    aplicar('Execuções fiscais', -penal, `${execFiscais.length} execução(ões) fiscal(is)`);
    alertar(`${execFiscais.length} execução(ões) fiscal(is) ativa(s)`, 'critico');
  }
  if (civeis.length) {
    const ativos = civeis.filter(p => p.status === 'Ativo' || /ativ/i.test(p.status || '')).length || civeis.length;
    const penal = Math.min(ativos * 3, 20);
    aplicar('Processos cíveis', -penal, `${ativos} processo(s) cível(eis) ativo(s)`);
    if (ativos >= 5) alertar(`${ativos} processo(s) cível(eis) ativo(s)`, 'atencao');
    else if (ativos > 0) alertar(`${ativos} processo(s) cível(eis)`, 'observar');
  }

  // 5. Sócios — cruzamento PF ────────────────────────────────────
  socios.forEach((s, idx) => {
    const nome = s.nome || `Sócio ${idx + 1}`;
    if (s.score_quod && Number(s.score_quod) < 500) {
      aplicar('Sócios — score baixo', -10, `${nome}: score QUOD ${s.score_quod}/1000`);
      alertar(`Sócio ${nome} com score QUOD baixo (${s.score_quod}/1000)`, 'atencao');
    }
    if (typeof s.qtd_processos === 'number' && s.qtd_processos > 5) {
      const excesso = s.qtd_processos - 5;
      const penal = Math.min(excesso * 3, 20);
      aplicar('Sócios — processos', -penal, `${nome}: ${s.qtd_processos} processos (${excesso} acima do limiar)`);
      alertar(`Sócio ${nome}: ${s.qtd_processos} processo(s) judicial(is)`, s.qtd_processos >= 10 ? 'critico' : 'atencao');
    } else if (typeof s.qtd_processos === 'number' && s.qtd_processos > 0) {
      alertar(`Sócio ${nome}: ${s.qtd_processos} processo(s) judicial(is)`, 'observar');
    }
    if (s.lista_negra) {
      aplicar('Sócios — lista negra', -25, `${nome}: consta em CEIS/CNEP`);
      alertar(`Sócio ${nome} consta em lista negra federal (CEIS/CNEP)`, 'critico');
    }
    if (s.obito) {
      aplicar('Sócios — óbito', -20, `${nome}: registro de óbito no CPF`);
      alertar(`Sócio ${nome}: óbito registrado no CPF`, 'critico');
    }
  });

  // 6. Cheques sem fundo ────────────────────────────────────────
  const cheques = Array.isArray(negativacoes.cheques_sem_fundo) ? negativacoes.cheques_sem_fundo : [];
  if (cheques.length) {
    aplicar('Cheques sem fundo', -25, `${cheques.length} ocorrência(s) de cheque sem fundo`);
    alertar(`${cheques.length} cheque(s) sem fundo detectado(s)`, 'critico');
  }

  // 7. Protestos com valor ──────────────────────────────────────
  const totalProtestos = Number(protestos.total || 0)
    + (Array.isArray(negativacoes.protestos) ? negativacoes.protestos.reduce((s, p) => s + (Number(p.valor_total_protesto) || 0), 0) : 0);
  // Se houver lista de protestos com valores, somar
  let valorProtestos = 0;
  (Array.isArray(protestos.protestos) ? protestos.protestos : []).forEach(p => {
    valorProtestos += Number(p.valor || 0);
  });
  (Array.isArray(negativacoes.protestos) ? negativacoes.protestos : []).forEach(p => {
    valorProtestos += Number(p.valor_total_protesto || 0);
  });
  if (valorProtestos > 0) {
    const penal = Math.min(Math.floor(valorProtestos / 1000) * 2, 30);
    aplicar('Protestos', -penal, `Protestos somam R$ ${valorProtestos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    alertar(`Protestos: R$ ${valorProtestos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, valorProtestos >= 50000 ? 'critico' : 'atencao');
  } else if (totalProtestos > 0) {
    aplicar('Protestos', -10, `${totalProtestos} protesto(s) sem valor agregado`);
    alertar(`${totalProtestos} protesto(s) em cartório`, 'atencao');
  }

  // 8. Negativações ─────────────────────────────────────────────
  const credores = new Set();
  (Array.isArray(negativacoes.pendencias) ? negativacoes.pendencias : []).forEach(p => {
    const c = p.credor || p.nomeCredor || p.nome || '';
    if (c) credores.add(String(c).trim().toUpperCase());
  });
  if (credores.size > 0) {
    const penal = Math.min(credores.size * 5, 20);
    aplicar('Negativações', -penal, `${credores.size} credor(es) distinto(s) com pendência`);
    alertar(`${credores.size} credor(es) distinto(s) negativando a empresa`, 'atencao');
  } else if (Number(negativacoes.total_pendencias || 0) > 0) {
    aplicar('Negativações', -8, `Pendências R$ ${Number(negativacoes.total_pendencias).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    alertar(`Pendências financeiras: R$ ${Number(negativacoes.total_pendencias).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'atencao');
  }

  // 9. Listas negras da empresa ─────────────────────────────────
  if (transparencia.em_lista_negra) {
    aplicar('Lista negra empresa', -40, 'Empresa consta em CEIS/CNEP/CEPIM');
    alertar('Empresa consta em lista negra federal (CEIS/CNEP/CEPIM)', 'critico');
  }

  // 10. CND Federal (PGFN) ──────────────────────────────────────
  const sitPgfn = classificarSituacao(pgfn.situacao);
  if (sitPgfn === 'POSITIVA') {
    aplicar('CND Federal', -20, 'CND Federal POSITIVA (débitos federais)');
    alertar('CND Federal POSITIVA — débitos federais ativos', 'critico');
  } else if (sitPgfn === 'POSITIVA_COM_EFEITOS_DE_NEGATIVA') {
    aplicar('CND Federal', -10, 'CND Federal positiva com efeitos de negativa');
    alertar('CND Federal positiva com efeitos de negativa — débitos suspensos/parcelados', 'atencao');
  } else if (sitPgfn === 'NEGATIVA') {
    alertar('CND Federal NEGATIVA — sem débitos', 'positivo');
  }

  // 11. CND Trabalhista (TST/CNDT) ──────────────────────────────
  const sitCndt = classificarSituacao(cndt.situacao);
  if (sitCndt === 'POSITIVA') {
    aplicar('CND Trabalhista', -15, 'CND Trabalhista POSITIVA (débitos na JT)');
    alertar('CND Trabalhista POSITIVA — débitos na Justiça do Trabalho', 'critico');
  } else if (sitCndt === 'POSITIVA_COM_EFEITOS_DE_NEGATIVA') {
    aplicar('CND Trabalhista', -8, 'CND Trabalhista positiva com efeitos de negativa');
    alertar('CND Trabalhista com efeitos de negativa', 'atencao');
  } else if (sitCndt === 'NEGATIVA') {
    alertar('CND Trabalhista NEGATIVA — sem débitos na JT', 'positivo');
  }

  // 12. FGTS ────────────────────────────────────────────────────
  const sitFgts = classificarSituacao(fgts.situacao);
  if (sitFgts === 'IRREGULAR' || sitFgts === 'POSITIVA') {
    aplicar('FGTS', -15, 'FGTS irregular');
    alertar('FGTS irregular — empresa em débito com a Caixa', 'critico');
  } else if (sitFgts === 'REGULAR' || sitFgts === 'NEGATIVA') {
    alertar('FGTS regular', 'positivo');
  }

  // 13. CND Estadual ────────────────────────────────────────────
  const sitEst = classificarSituacao(debitosEstaduais.situacao);
  if (sitEst === 'POSITIVA') {
    aplicar('CND Estadual', -10, 'CND Estadual POSITIVA');
    alertar(`CND Estadual${debitosEstaduais.uf ? ` (SEFAZ-${debitosEstaduais.uf})` : ''} POSITIVA — débitos estaduais`, 'atencao');
  } else if (sitEst === 'POSITIVA_COM_EFEITOS_DE_NEGATIVA') {
    aplicar('CND Estadual', -5, 'CND Estadual positiva com efeitos de negativa');
  }

  // 14. CND Municipal ───────────────────────────────────────────
  const sitMun = classificarSituacao(cndMunicipal.situacao);
  if (sitMun === 'POSITIVA') {
    aplicar('CND Municipal', -8, 'CND Municipal POSITIVA');
    alertar(`CND Municipal${cndMunicipal.municipio ? ` (${cndMunicipal.municipio})` : ''} POSITIVA — débitos municipais`, 'atencao');
  } else if (sitMun === 'POSITIVA_COM_EFEITOS_DE_NEGATIVA') {
    aplicar('CND Municipal', -4, 'CND Municipal positiva com efeitos de negativa');
  }

  // Situação RF irregular ────────────────────────────────────────
  const situacaoRF = (cadastral.situacao || cadastral.situacao_rf || '').toLowerCase();
  if (situacaoRF && !situacaoRF.includes('ativ') && !situacaoRF.includes('regular')) {
    aplicar('Situação RF', -25, `Situação RF: ${situacaoRF}`);
    alertar(`Situação irregular na Receita Federal: ${situacaoRF}`, 'critico');
  }

  // Score final — pode ir negativo internamente, mas exibe min 0
  const scoreFinal = Math.max(0, Math.min(100, Math.round(score)));

  // Bandas
  let classificacao, cor, recomendacao;
  if (scoreFinal <= 29) {
    classificacao = 'RISCO CRÍTICO';
    cor = 'vermelho_escuro';
    recomendacao = 'NÃO PROSSEGUIR — risco crítico inviabiliza a operação. Múltiplos sinais graves de inadimplência, fraude ou falência iminente.';
  } else if (scoreFinal <= 49) {
    classificacao = 'ALTO RISCO';
    cor = 'vermelho';
    recomendacao = 'NÃO PROSSEGUIR sem garantias robustas. Exigir avalista, garantia real e saneamento integral antes do closing.';
  } else if (scoreFinal <= 69) {
    classificacao = 'RISCO MODERADO';
    cor = 'laranja';
    recomendacao = 'PROSSEGUIR COM RESSALVAS — exigir avalista, garantia real, escrow e cláusula de indenização específica para passivos identificados.';
  } else if (scoreFinal <= 84) {
    classificacao = 'RISCO BAIXO-MODERADO';
    cor = 'amarelo';
    recomendacao = 'PROSSEGUIR COM ATENÇÃO — riscos pontuais identificados. Documentar ressalvas no contrato e exigir certidões atualizadas no closing.';
  } else {
    classificacao = 'RISCO BAIXO';
    cor = 'verde';
    recomendacao = 'PROSSEGUIR — perfil de baixo risco nas dimensões analisadas.';
  }

  return {
    score: scoreFinal,
    classificacao,
    cor,
    recomendacao,
    alertas,
    contribuicoes,
    versao: 'dd_empresarial_v3'
  };
}

module.exports = { calcularScoreDDEmpresarial };
