-- Migration 002: Pagamento multi-método (link MP + Dinheiro + Plano)
--
-- 1) Adiciona forma_pagamento em pedidos: 'mercadopago' | 'dinheiro' | 'plano' (NULL = não definida).
-- 2) Adiciona cota mensal de consultas por usuário do sistema (operador) para o "Plano":
--    plano_cota_mensal      → 0 = sem plano, >0 = limite mensal
--    plano_consultas_usadas → contador do ciclo atual
--    plano_ciclo_inicio     → 1º dia do mês do ciclo atual; NULL antes do primeiro débito
--
-- Idempotente. Os mesmos ALTERs também estão em db/schema.sql para o boot do servidor.
--
-- Aplicação manual (caso necessário):
--   psql "$DATABASE_URL" -f db/migrations/002_pagamento_multimetodo.sql

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(20);

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plano_cota_mensal INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plano_consultas_usadas INTEGER DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plano_ciclo_inicio DATE;

CREATE INDEX IF NOT EXISTS idx_pedidos_forma_pagamento ON pedidos(forma_pagamento);
