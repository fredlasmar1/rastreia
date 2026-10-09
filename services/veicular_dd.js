/**
 * RASTREIA — Consultas veiculares pela Direct Data (substitui a Credify).
 *
 * Formatos tirados do swagger oficial:
 *   https://apiv3.directd.com.br/swagger/v3-scalar/swagger.json
 * Toda resposta vem em { metaDados: {resultado, mensagem, ...}, retorno: {...} }.
 *
 * Pacotes (services/consultas.js executarConsultaCompleta):
 *   Simples  = nacional + gravame
 *   Mediana  = Simples + estadual (débitos IPVA/licenciamento/multas) + FIPE
 *   Completa = Mediana + leilão + roubo/furto + RENAJUD + histórico de donos + recall
 *
 * A Nacional já devolve indicadores (leilão, roubo/furto, renajud, renainf,
 * recall, comunicado de venda...) — o veredito usa isso mesmo nos pacotes
 * que não detalham, e manda para a Completa quando algo acusa.
 */
const axios = require('axios');

const BASE = 'https://apiv3.directd.com.br/api';

function normalizarPlaca(p) { return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function placaValida(p) { return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(normalizarPlaca(p)); }

const t = (x) => (x == null ? '' : String(x).trim());
function num(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^\d,.-]/g, '');
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) ? n : 0;
}

async function chamar(endpoint, params, fonte) {
  if (!process.env.DIRECTD_TOKEN) return { disponivel: false, erro: 'DIRECTD_TOKEN ausente', fonte };
  try {
    const res = await axios.get(`${BASE}/${endpoint}`, {
      params: { ...params, Token: process.env.DIRECTD_TOKEN },
      timeout: 45000
    });
    const meta = res.data?.metaDados || {};
    const retorno = res.data?.retorno;
    if (!retorno || (typeof retorno === 'object' && !Object.keys(retorno).length)) {
      return { disponivel: false, erro: meta.mensagem || 'Sem dados para esta placa', fonte };
    }
    return { ok: true, retorno, meta };
  } catch (e) {
    const status = e.response?.status;
    const msg = e.response?.data?.metaDados?.mensagem || e.response?.data?.mensagem || e.message;
    console.warn(`[FALHA API] ${fonte} | status=${status || '-'} | msg=${msg}`);
    return { disponivel: false, erro: msg, status, fonte };
  }
}

// ── Nacional: dados do veículo + indicadores de risco ─────────────────────
async function consultarNacional(placa) {
  const fonte = 'Direct Data Consulta Veicular Nacional';
  const r = await chamar('ConsultaVeicular', { Placa: normalizarPlaca(placa) }, fonte);
  if (!r.ok) return r;
  const ret = r.retorno; const v = ret.veiculo || {};
  const ind = v.indicadores || {};
  return {
    disponivel: true,
    placa: t(v.placa) || normalizarPlaca(placa),
    marca: t(v.marca), modelo: t(v.modelo),
    marca_modelo: [t(v.marca), t(v.modelo)].filter(Boolean).join(' '),
    ano_fabricacao: t(v.anoFabricacao), ano_modelo: t(v.anoModelo),
    cor: t(v.cor), combustivel: t(v.combustivel), chassi: t(v.chassi), renavam: t(v.renavam),
    municipio: t(v.municipio), uf: t(v.uf), tipo: t(v.tipo), especie: t(v.especie), categoria: t(v.categoria),
    situacao: t(v.situacaoVeiculo), procedencia: t(v.procedenciaVeiculo),
    chassi_remarcado: !!v.indicadorRemarcacaoChassi, descricao_remarcacao: t(v.descricaoRemarcacaoChassi),
    proprietario: t(ret.proprietario), proprietario_documento: t(ret.documento), ano_exercicio: t(ret.anoExercicio),
    restricoes: (Array.isArray(v.restricoes) ? v.restricoes : []).map(t).filter(x => x && !/^(sem restri|nada consta|nenhuma)/i.test(x)),
    indicadores: {
      leilao: !!ind.leilao, roubo_furto: !!ind.rouboFurto, renajud: !!ind.renajud, renainf: !!ind.renainf,
      recall: !!ind.recall, comunicado_venda: !!ind.comunicadoVenda, pendencia_emissao: !!ind.pendenciaEmissao,
      rfb: !!ind.rfb, alarme: !!ind.alarme
    },
    fonte, consultado_em: new Date().toISOString()
  };
}

// ── Gravame (financiamento / alienação fiduciária) ────────────────────────
async function consultarGravame(placa) {
  const fonte = 'Direct Data Gravame';
  const r = await chamar('ConsultaVeicularGravame', { Placa: normalizarPlaca(placa) }, fonte);
  if (!r.ok) return r;
  const ret = r.retorno; const g = ret.gravame || {};
  const status = t(ret.descricaoStatus || ret.statusDoVeiculo);
  const tem = !!(t(g.numeroContrato) || t(g.financeiraNome)) && !/inativ|baixad|quitad|sem gravame|nada consta/i.test(status);
  return {
    disponivel: true,
    tem_gravame: tem,
    status: tem ? 'COM GRAVAME' : 'LIVRE',
    status_api: status,
    financeira: t(g.financeiraNome), contrato: t(g.numeroContrato), financiado: t(g.nomeFinanciado),
    data_inclusao: t(g.dataGravame), uf: t(g.ufGravame),
    fonte, consultado_em: new Date().toISOString()
  };
}

// ── Estadual: débitos (IPVA, licenciamento, multas) ───────────────────────
async function consultarEstadual(placa) {
  const fonte = 'Direct Data Consulta Veicular Estadual';
  const r = await chamar('ConsultaVeicularEstadual', { Placa: normalizarPlaca(placa) }, fonte);
  if (!r.ok) return r;
  const ret = r.retorno; const d = ret.debitos || {};
  const itens = [
    ['IPVA', d.valorIpva, d.situacaoIpva], ['Licenciamento', d.valorLicenciamento, d.situacaoLicenciamento],
    ['Multas', d.valorMulta, d.situacaoMulta], ['DPVAT', d.valorDpvat, d.situacaoDpvat],
    ['Multas RENAINF', d.valorRenainf], ['Multas municipais', d.valorMunicipais],
    ['Multas PRF', d.valorPoliciaRodoviariaFederal], ['DETRAN', d.valorDetran], ['DER', d.valorDer], ['DERSA', d.valorDersa]
  ].map(([nome, valor, situacao]) => ({ nome, valor: num(valor), situacao: t(situacao) })).filter(x => x.valor > 0);
  return {
    disponivel: true,
    situacao: t(ret.situacao), licenciamento_data: t(ret.licenciamentoData),
    comunicacao_venda: t(ret.comunicacaoVenda),
    restricoes: (Array.isArray(ret.restricoes) ? ret.restricoes : []).map(x => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean),
    debitos: itens,
    total_debitos: Math.round(itens.reduce((s, x) => s + x.valor, 0) * 100) / 100,
    fonte, consultado_em: new Date().toISOString()
  };
}

// ── FIPE ──────────────────────────────────────────────────────────────────
async function consultarFipe(placa) {
  const fonte = 'Direct Data FIPE';
  const r = await chamar('ConsultaVeicularFipe', { Placa: normalizarPlaca(placa) }, fonte);
  if (!r.ok) return r;
  const f = (r.retorno.veiculo || {}).fipe || {};
  const valor = num(f.valor);
  if (!valor) return { disponivel: false, erro: 'FIPE não encontrada para este veículo', fonte };
  return { disponivel: true, valor, mes_referencia: [t(f.mes), t(f.ano)].filter(Boolean).join('/'), fonte, consultado_em: new Date().toISOString() };
}

// ── Leilão ────────────────────────────────────────────────────────────────
async function consultarLeilao(placa) {
  const fonte = 'Direct Data Leilão Veicular';
  const r = await chamar('ConsultaLeilaoVeicular', { Placa: normalizarPlaca(placa) }, fonte);
  if (!r.ok) return r;
  const ret = r.retorno;
  const registros = (Array.isArray(ret.registros) ? ret.registros : []).map(x => ({
    data: t(x.dataLeilao), leiloeiro: t(x.leiloeiro), lote: t(x.lote), patio: t(x.patio),
    comitente: t(x.comitente), classificacao: t(x.classificacao)
  }));
  return {
    disponivel: true,
    tem_registro: !!ret.possuiRegistro || registros.length > 0,
    total: Number(ret.totalRegistros || registros.length || 0),
    analise_risco: t(ret.analiseRisco),
    registros,
    fonte, consultado_em: new Date().toISOString()
  };
}

// ── Roubo e furto ─────────────────────────────────────────────────────────
async function consultarRouboFurto(placa) {
  const fonte = 'Direct Data Roubo e Furto';
  const r = await chamar('ConsultaVeicularRouboFurto', { Placa: normalizarPlaca(placa) }, fonte);
  if (!r.ok) return r;
  const ret = r.retorno; const ind = ret.indicadores || {};
  const ocorrencias = (Array.isArray(ret.ocorrencias) ? ret.ocorrencias : []).map(o => ({
    categoria: t(o.categoria), data: t(o.dataOcorrencia), ano: o.ano || null, orgao: t(o.orgaoSeguranca),
    boletim: t(o.boletim), tipo: t(o.tipoDeclaracao)
  }));
  const houve = !!ind.houveRouboFurto || ocorrencias.length > 0;
  const recuperado = !!ind.houveRecuperacao || !!ind.houveDevolucao;
  return {
    disponivel: true,
    tem_registro: houve,
    ativo: houve && !recuperado,          // roubado/furtado e não recuperado
    recuperado,
    situacao: t(ret.situacao), ocorrencia_atual: t(ret.ocorrenciaAtual),
    ocorrencias,
    fonte, consultado_em: new Date().toISOString()
  };
}

// ── RENAJUD (bloqueio judicial) ───────────────────────────────────────────
async function consultarRenajud(placa) {
  const fonte = 'Direct Data RENAJUD';
  const r = await chamar('ConsultaVeicularRenajud', { Placa: normalizarPlaca(placa) }, fonte);
  if (!r.ok) return r;
  const ret = r.retorno;
  const ocorrencias = (Array.isArray(ret.ocorrencias) ? ret.ocorrencias : []).map(o => ({
    status: t(o.status), tipo: t(o.tipoRestricao), processo: t(o.numeroProcesso), data: t(o.dataInclusao),
    tribunal: t(o.tribunal), orgao: t(o.orgaoJulgador), uf: t(o.orgaoJulgadorUf)
  }));
  const ativos = Number(ret.quantidadeBloqueioAtivo || ocorrencias.filter(o => /ativ/i.test(o.status)).length || 0);
  return {
    disponivel: true,
    bloqueios_ativos: ativos,
    tem_restricao: ativos > 0,
    total: Number(ret.quantidadeOcorrenciasTotal || ocorrencias.length || 0),
    ocorrencias,
    fonte, consultado_em: new Date().toISOString()
  };
}

// ── Recall ────────────────────────────────────────────────────────────────
async function consultarRecall(placa) {
  const fonte = 'Direct Data Recall';
  const r = await chamar('ConsultaVeicularRecall', { Placa: normalizarPlaca(placa) }, fonte);
  if (!r.ok) return r;
  const ret = r.retorno;
  const campanhas = (Array.isArray(ret.recallsPendentes) ? ret.recallsPendentes : []).map(c => ({
    nome: t(c.nomeRecall), descricao: t(c.descricaoRecall), montadora: t(c.montadora), data: t(c.dataRegistro || c.dataOcorrencia)
  }));
  return { disponivel: true, tem_recall: !!ret.possuiRecallPendente || campanhas.length > 0, campanhas, fonte, consultado_em: new Date().toISOString() };
}

// ── Histórico de proprietários ────────────────────────────────────────────
async function consultarHistoricoProprietarios(placa) {
  const fonte = 'Direct Data Histórico de Proprietários';
  const r = await chamar('ConsultaVeicularHistoricoProprietarios', { Placa: normalizarPlaca(placa) }, fonte);
  if (!r.ok) return r;
  const regs = (Array.isArray(r.retorno.registros) ? r.retorno.registros : []).map(x => {
    const doc = t(x.documento).replace(/\D/g, '');
    return {
      nome: t(x.nomeRazaoSocial), tipo_documento: t(x.tipoDocumento),
      documento_mascarado: doc ? (doc.length === 14 ? `**.***.***/****-${doc.slice(-2)}` : `***.***.***-${doc.slice(-2)}`) : '',
      ano: x.ano || null, data_transferencia: t(x.dataTransferencia), uf: t(x.uf), municipio: t(x.municipio)
    };
  }).sort((a, b) => (b.ano || 0) - (a.ano || 0));
  return { disponivel: true, total: regs.length, proprietarios: regs, fonte, consultado_em: new Date().toISOString() };
}

module.exports = {
  normalizarPlaca, placaValida,
  consultarNacional, consultarGravame, consultarEstadual, consultarFipe,
  consultarLeilao, consultarRouboFurto, consultarRenajud, consultarRecall, consultarHistoricoProprietarios
};
