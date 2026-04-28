// services/storage_paths.js
//
// Resolve diretórios de armazenamento de arquivos persistentes (uploads de
// documentos do imóvel e PDFs de relatórios).
//
// BUG #2: o filesystem do container Railway é efêmero — a cada deploy ele é
// recriado e tudo que estava em /app/uploads e /app/public/relatorios some.
// Em produção é necessário montar um Railway Volume (ex.: em /app/data) e
// apontar UPLOADS_DIR / RELATORIOS_DIR para subdiretórios desse volume.
//
// Em dev local mantemos os caminhos antigos como fallback para não exigir
// configuração de volume.

const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..');

function resolverDir(envVar, fallbackRelativo) {
  const valor = (process.env[envVar] || '').trim();
  if (valor) return path.isAbsolute(valor) ? valor : path.join(REPO_ROOT, valor);
  return path.join(REPO_ROOT, fallbackRelativo);
}

const UPLOADS_DIR = resolverDir('UPLOADS_DIR', path.join('uploads', 'imoveis'));
const RELATORIOS_DIR = resolverDir('RELATORIOS_DIR', path.join('public', 'relatorios'));
const DATA_DIR = resolverDir('DATA_DIR', 'data');

function garantirDiretorio(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

module.exports = {
  UPLOADS_DIR,
  RELATORIOS_DIR,
  DATA_DIR,
  garantirDiretorio
};
