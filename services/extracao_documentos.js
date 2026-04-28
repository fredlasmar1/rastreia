// services/extracao_documentos.js
//
// Fallback de extração de CPF/CNPJ em texto bruto de documentos imobiliários.
// Usado quando a IA Claude não consegue identificar os proprietários estruturados.
//
// Fluxo:
//   1) `extrairTextoPdf(filepath)` lê o PDF com pdf-parse e devolve o texto bruto.
//   2) `extrairCpfCnpjDoTexto(texto)` aplica regex BR + valida DV e tenta
//      associar o nome do proprietário via heurística de proximidade.
//
// Validação dos DVs evita falsos positivos comuns em matrículas (números de
// matrícula, processos, CEPs etc.). Linhas inteiras zeradas/repetidas (ex.
// "00000000000") são rejeitadas pelo validador.
//
// IMPORTANTE: este módulo NÃO chama nenhuma API externa, é puramente local.

const fs = require('fs');

const REGEX_CPF = /(?<![\d.])(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2})(?![\d-])/g;
const REGEX_CNPJ = /(?<![\d.])(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})(?!\d)/g;

// Termos que costumam preceder um CPF/CNPJ em matrículas/escrituras brasileiras.
// Mantido apenas para documentação — a heurística de nome usa janela do texto.
const PADROES_CONTEXTO_CPF_CNPJ = [
  'CPF', 'CPF/MF', 'CPF nº', 'CPF n°', 'CPF:',
  'inscrito no CPF', 'inscrita no CPF', 'inscritos no CPF',
  'portador do CPF', 'portadora do CPF',
  'CNPJ', 'CNPJ/MF', 'CNPJ nº', 'CNPJ:'
];

function digSafe(s) { return String(s || '').replace(/\D/g, ''); }

// ─── Validação de DV ─────────────────────────────────────────────

function validarCpf(cpfRaw) {
  const cpf = digSafe(cpfRaw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
  let dv1 = (soma * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== parseInt(cpf[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
  let dv2 = (soma * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return dv2 === parseInt(cpf[10], 10);
}

function validarCnpj(cnpjRaw) {
  const cnpj = digSafe(cnpjRaw);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base, pesos) => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += parseInt(base[i], 10) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv1 = calc(cnpj.slice(0, 12), pesos1);
  if (dv1 !== parseInt(cnpj[12], 10)) return false;
  const dv2 = calc(cnpj.slice(0, 13), pesos2);
  return dv2 === parseInt(cnpj[13], 10);
}

// ─── Heurística de nome próximo ──────────────────────────────────

// Procura na janela de texto ANTES da posição do CPF/CNPJ um nome em
// MAIÚSCULAS típico de matrícula (ex: "JOÃO DA SILVA SANTOS"). Aceita
// acentos e nomes compostos. Limita a 6 palavras pra evitar capturar
// linhas de cabeçalho inteiras.
function nomeProximo(texto, posicao, janela = 200) {
  const inicio = Math.max(0, posicao - janela);
  const trecho = texto.slice(inicio, posicao);
  // Pega o último bloco contíguo de palavras MAIÚSCULAS (≥2 palavras) antes
  // do CPF/CNPJ. Aceita conectores "DA", "DE", "DO", "DOS", "DAS", "E"
  // entre as palavras maiúsculas. Parte da raiz (\b) para não capturar
  // metade de uma palavra cortada.
  const re = /\b([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{2,}(?:\s+(?:DA|DE|DO|DAS|DOS|E|[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{2,})){1,8})\b/g;
  let melhor = null;
  let m;
  while ((m = re.exec(trecho)) !== null) {
    melhor = m[1].trim().replace(/\s+/g, ' ');
  }
  if (!melhor) return null;
  // Rejeita linhas claramente não-pessoais (cabeçalhos comuns)
  const blacklist = /^(CARTORIO|CARTÓRIO|REGISTRO|REPÚBLICA|REPUBLICA|MATR[ÍI]CULA|CERTID[ÃA]O|OFICIAL|LIVRO|FOLHA|MUNIC[ÍI]PIO|ESTADO|COMARCA|JUSTI[ÇC]A|PODER|FAZENDA|RECEITA|FEDERAL|DETRAN|ANAPOLIS|GOI[ÁA]S|BRASIL|S[ÃA]O\s+PAULO|RIO\s+DE\s+JANEIRO|MINAS\s+GERAIS)/i;
  if (blacklist.test(melhor)) return null;
  // Exige pelo menos 2 palavras (descarta "JOÃO" sozinho)
  if (melhor.split(/\s+/).length < 2) return null;
  return melhor;
}

// ─── Extração principal ──────────────────────────────────────────

/**
 * Extrai CPFs e CNPJs (com DV válido) do texto bruto de um documento.
 * Para cada documento encontrado, tenta associar um nome próximo.
 *
 * @param {string} texto Texto extraído do PDF (pdf-parse).
 * @returns {Array<{documento: string, tipo: 'cpf'|'cnpj', nome: string|null, posicao: number}>}
 */
function extrairCpfCnpjDoTexto(texto) {
  if (!texto || typeof texto !== 'string') return [];
  const achados = [];
  const vistos = new Set(); // dedup por documento limpo

  // Normalizar quebras múltiplas em espaço — facilita a janela de nome
  // sem alterar a posição relativa das ocorrências em demasia.
  const txt = texto.replace(/\r\n/g, '\n');

  let m;
  REGEX_CPF.lastIndex = 0;
  while ((m = REGEX_CPF.exec(txt)) !== null) {
    const limpo = digSafe(m[1]);
    if (limpo.length !== 11) continue;
    if (!validarCpf(limpo)) continue;
    if (vistos.has(limpo)) continue;
    vistos.add(limpo);
    achados.push({
      documento: limpo,
      tipo: 'cpf',
      nome: nomeProximo(txt, m.index),
      posicao: m.index
    });
  }

  REGEX_CNPJ.lastIndex = 0;
  while ((m = REGEX_CNPJ.exec(txt)) !== null) {
    const limpo = digSafe(m[1]);
    if (limpo.length !== 14) continue;
    if (!validarCnpj(limpo)) continue;
    if (vistos.has(limpo)) continue;
    vistos.add(limpo);
    achados.push({
      documento: limpo,
      tipo: 'cnpj',
      nome: nomeProximo(txt, m.index),
      posicao: m.index
    });
  }

  // Ordena por posição no texto (preserva ordem natural — proprietário
  // costuma aparecer antes de credor/cônjuge).
  achados.sort((a, b) => a.posicao - b.posicao);
  return achados;
}

/**
 * Lê um PDF e devolve o texto bruto. Falha graciosa: se pdf-parse não
 * conseguir, retorna string vazia (não derruba o pipeline da IA).
 */
async function extrairTextoPdf(filepath) {
  try {
    const pdfParse = require('pdf-parse');
    const buf = fs.readFileSync(filepath);
    const data = await pdfParse(buf);
    return (data && typeof data.text === 'string') ? data.text : '';
  } catch (e) {
    console.warn('[extracao] falha ao ler PDF', filepath, ':', e.message);
    return '';
  }
}

module.exports = {
  validarCpf,
  validarCnpj,
  extrairCpfCnpjDoTexto,
  extrairTextoPdf,
  // exportados pra testes
  _nomeProximo: nomeProximo,
  _PADROES_CONTEXTO_CPF_CNPJ: PADROES_CONTEXTO_CPF_CNPJ
};
