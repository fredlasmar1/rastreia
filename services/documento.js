/**
 * RASTREIA — CPF e CNPJ (inclusive o CNPJ ALFANUMÉRICO).
 *
 * Desde 1º/07/2026 (IN RFB nº 2.229/2024) as inscrições novas de CNPJ têm
 * letras maiúsculas e números nas 12 primeiras posições; os 2 dígitos
 * verificadores continuam numéricos. No cálculo do DV cada caractere vale
 * (código ASCII − 48): '0'..'9' = 0..9, 'A' = 17, 'B' = 18 … 'Z' = 42.
 * Os CNPJs antigos (só números) continuam válidos — a mesma conta serve.
 *
 * Regra do projeto: documento NUNCA passa por replace(/\D/g, '') — isso
 * apaga as letras do CNPJ novo. Use limparDoc().
 */

// Mantém só 0-9 e A-Z (maiúsculas). "12.ABC.345/01DE-35" → "12ABC34501DE35".
// Tolerante a rótulo: "CPF: 123.456.789-00" daria "CPF12345678900" (14 posições,
// cara de CNPJ) — letras só ficam quando formam um CNPJ com DV válido; senão
// vale o que já valia antes: só os números.
function limparDoc(v) {
  const bruto = String(v == null ? '' : v).toUpperCase();
  const alfa = bruto.replace(/[^0-9A-Z]/g, '');
  if (/[A-Z]/.test(alfa)) {
    if (ehCNPJ(alfa) && validarCNPJ(alfa)) return alfa;
    return bruto.replace(/\D/g, '');
  }
  return alfa;
}

const ehCPF = (d) => /^\d{11}$/.test(d);
const ehCNPJ = (d) => /^[0-9A-Z]{12}\d{2}$/.test(d);

function validarCPF(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (!ehCPF(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function validarCNPJ(v) {
  const d = String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!ehCNPJ(d) || /^(.)\1{13}$/.test(d)) return false;
  const val = (c) => c.charCodeAt(0) - 48;
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < n; i++) soma += val(d[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

// 'PF' | 'PJ' | null pelo formato (sem validar DV)
function tipoDoc(v) {
  const d = limparDoc(v);
  return ehCPF(d) ? 'PF' : ehCNPJ(d) ? 'PJ' : null;
}

function formatarDoc(v) {
  const d = limparDoc(v);
  if (ehCPF(d)) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (ehCNPJ(d)) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return v == null ? '' : String(v);
}

// Raiz do CNPJ (8 primeiras posições) — identifica a empresa/instituição
const raizCNPJ = (v) => limparDoc(v).slice(0, 8);

module.exports = { limparDoc, ehCPF, ehCNPJ, validarCPF, validarCNPJ, tipoDoc, formatarDoc, raizCNPJ };
