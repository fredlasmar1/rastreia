-- Migration 001: Soft delete em pedidos
--
-- Adiciona coluna deletado_em (TIMESTAMP NULLABLE). Pedidos com
-- deletado_em IS NOT NULL ficam ocultos das listagens padrão, mas
-- permanecem no banco para fins de auditoria.
--
-- Idempotente: pode rodar várias vezes sem efeito colateral. O
-- mesmo ALTER já está em db/schema.sql para aplicação automática
-- no boot do servidor (ver server.js -> iniciar()), de modo que
-- o Railway aplica a migration sem ação manual.
--
-- Caso você prefira rodar via psql:
--   psql "$DATABASE_URL" -f db/migrations/001_pedidos_soft_delete.sql

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS deletado_em TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_pedidos_deletado_em ON pedidos(deletado_em);
