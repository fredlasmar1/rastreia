// ATENÇÃO: senhas iniciais provisórias. Usuários devem trocar no primeiro login.
// Após rodar este script com sucesso em produção, considere remover este arquivo
// ou substituir as senhas por placeholders.

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const USERS = [
  { email: 'matheus@recobro.com', senha: 'admin123', nome: 'Matheus', perfil: 'admin' },
  { email: 'pedro@recobro.com',   senha: 'admin123', nome: 'Pedro',   perfil: 'admin' },
];

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('erro: DATABASE_URL não definido');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  let criados = 0, existentes = 0;

  try {
    for (const u of USERS) {
      const { rows } = await pool.query(
        'SELECT id FROM usuarios WHERE email = $1',
        [u.email]
      );
      if (rows.length) {
        console.log('[skip] já existe:', u.email);
        existentes++;
        continue;
      }
      const hash = await bcrypt.hash(u.senha, 10);
      await pool.query(
        'INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo) VALUES ($1, $2, $3, $4, true)',
        [u.nome, u.email, hash, u.perfil]
      );
      console.log('[ok] criado:', u.email);
      criados++;
    }
    console.log(`\n${USERS.length} usuários processados (${criados} criados, ${existentes} já existentes)`);
  } finally {
    await pool.end();
  }
  process.exit(0);
})().catch(e => { console.error('erro:', e); process.exit(1); });
