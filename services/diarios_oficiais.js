/**
 * RASTREIA — Diários oficiais municipais (Querido Diário / Open Knowledge Brasil).
 *
 * Busca o CNPJ (entre aspas, formatado como sai no diário) em todos os
 * municípios cobertos e separa o que aparece: contratos/licitações, sanções,
 * débitos com o município e outros. Gratuito, sem chave.
 *
 * API: https://api.queridodiario.org.br (o domínio antigo api.queridodiario.ok.org.br
 * está com falha de TLS desde 13/09/2026 — issue #110 do querido-diario-api).
 * É lenta (15–25 s) e às vezes devolve 520: tempo-limite largo, uma segunda
 * tentativa e, se falhar, { disponivel:false } — o dossiê segue sem travar.
 *
 * Cobertura (13/10/2026): 510 de 5.570 municípios; em Goiás só Goiânia (desde
 * 11/2020) e Aparecida de Goiânia (desde 10/2022) — Anápolis ainda não.
 * Busca por CPF não serve (o diário mascara) e por nome traz homônimos: só CNPJ.
 */
const axios = require('axios');
const { formatarDoc, limparDoc, ehCNPJ } = require('./documento');

const BASE = process.env.QUERIDO_DIARIO_URL || 'https://api.queridodiario.org.br';
const COBERTURA = 'Diários oficiais de 510 municípios (Querido Diário). Em Goiás: Goiânia e Aparecida de Goiânia — Anápolis ainda não é coberto.';

// Categoria pelo trecho (regra simples e explicável; na dúvida, "outros")
const CATEGORIAS = [
  // Procon publica reclamações e processos administrativos (CDC) no diário do município
  ['procon', 'Procon / defesa do consumidor', /(procon|fundamentada (n[aã]o )?atendida|consumidor\(a\)|fornecedor\(a\)|lei (n[ºo°.]* ?)?8\.?078|c[oó]digo de defesa do consumidor|reclama[çc][aã]o)/i],
  ['sancao', 'Sanção / penalidade', /(penalidade|san[çc][aã]o|multa|suspens[aã]o|impedimento|inid[oô]ne|rescis[aã]o unilateral|advert[eê]ncia|descredenciamento)/i],
  ['debito', 'Débito com o município', /(d[ií]vida ativa|execu[çc][aã]o fiscal|d[eé]bito|notifica[çc][aã]o de lan[çc]amento|auto de infra[çc][aã]o|inscri[çc][aã]o em d[ií]vida)/i],
  ['contrato', 'Contrato / licitação', /(contrat|licita[çc]|preg[aã]o|homolog|adjudic|ata de registro|dispensa|inexigibilidade|empenho|aditivo|credenciamento)/i]
];
function categorizar(trecho) {
  for (const [id, nome, re] of CATEGORIAS) if (re.test(trecho || '')) return { id, nome };
  return { id: 'outros', nome: 'Outras menções' };
}

async function getComRetry(params, tentativas = 2) {
  let ultimo;
  for (let t = 0; t < tentativas; t++) {
    try {
      return (await axios.get(`${BASE}/gazettes`, { params, timeout: 30000 })).data;
    } catch (e) {
      ultimo = e;
      if (t + 1 < tentativas) await new Promise(r => setTimeout(r, 1500));
    }
  }
  throw ultimo;
}

/**
 * buscarPorCNPJ('12.345.678/0001-90', { anos: 5, limite: 10 })
 * → { disponivel, fonte, cobertura, total, desde, publicacoes:[{data, cidade, uf, url, trecho, categoria}],
 *     por_categoria: { procon, contrato, sancao, debito, outros } }
 */
async function buscarPorCNPJ(cnpj, { anos = 5, limite = 10 } = {}) {
  const doc = limparDoc(cnpj);
  const fonte = 'Querido Diário (Open Knowledge Brasil)';
  if (!ehCNPJ(doc)) return { disponivel: false, erro: 'CNPJ inválido', fonte };
  const desde = new Date(Date.now() - anos * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    const d = await getComRetry({
      querystring: `"${formatarDoc(doc)}"`, published_since: desde, size: limite,
      excerpt_size: 320, number_of_excerpts: 2, sort_by: 'descending_date'
    });
    const publicacoes = [];
    for (const g of d.gazettes || []) {
      const trechos = (g.excerpts || []).map(x => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean);
      // o trecho que tem o CNPJ é o que interessa
      const trecho = trechos.find(x => limparDoc(x).includes(doc)) || trechos[0] || '';
      publicacoes.push({
        data: g.date, cidade: g.territory_name, uf: g.state_code, url: g.url || g.txt_url || null,
        edicao_extra: !!g.is_extra_edition, trecho: trecho.slice(0, 320), categoria: categorizar(trecho)
      });
    }
    const por_categoria = { procon: 0, contrato: 0, sancao: 0, debito: 0, outros: 0 };
    publicacoes.forEach(p => { por_categoria[p.categoria.id] += 1; });
    return { disponivel: true, fonte, cobertura: COBERTURA, total: Number(d.total_gazettes) || publicacoes.length, desde, publicacoes, por_categoria };
  } catch (e) {
    return { disponivel: false, fonte, cobertura: COBERTURA, erro: `Querido Diário indisponível (${e.response?.status || e.code || e.message})` };
  }
}

module.exports = { buscarPorCNPJ, categorizar, COBERTURA };
