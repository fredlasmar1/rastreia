-- Migration 003: Revisão de Contrato Bancário (produto revisao_contrato_bancario)
--
-- Idempotente. Os mesmos comandos estão em db/schema.sql para o boot do servidor.
-- Aplicação manual (caso necessário):
--   psql "$DATABASE_URL" -f db/migrations/003_revisao_bancaria.sql
--
-- Diferença do prompt original: pedidos.id e usuarios.id são UUID neste banco.

CREATE TABLE IF NOT EXISTS revisao_bancaria (
  id SERIAL PRIMARY KEY,
  pedido_id UUID UNIQUE NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  etapa TEXT NOT NULL DEFAULT 'aguardando_documentos',
  -- aguardando_documentos | extraindo | conferencia_operador | calculando
  -- | revisao_juridica | aprovado | reprovado_juridico
  dados_informados JSONB,       -- o que o operador digitou no pedido (antes da IA)
  dados_extraidos JSONB,        -- saída bruta da IA
  dados_conferidos JSONB,       -- versão editada/confirmada pelo operador (é a que vale)
  taxa_media_bacen JSONB,       -- série, mês de referência, valor a.m. e a.a., data da consulta, origem
  calculo JSONB,                -- saída do motor de cálculo
  teses JSONB,                  -- checklist aplicado
  veredito TEXT,                -- forte | moderada | fraca | inviavel
  economia_estimada NUMERIC(14,2),
  parecer_ia TEXT,              -- texto explicativo gerado pela IA a partir do cálculo
  parecer_juridico TEXT,        -- texto do advogado revisor (obrigatório para liberar)
  revisor_id UUID REFERENCES usuarios(id),
  revisado_em TIMESTAMPTZ,
  versao_calculo TEXT,          -- versão do motor, para auditoria
  consentimento_lgpd_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_revisao_bancaria_etapa ON revisao_bancaria(etapa);

-- Quem pode assinar a revisão jurídica (ativado pelo admin)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pode_revisar_juridico BOOLEAN DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS oab VARCHAR(30);

-- Parâmetros editáveis pelo admin (sem deploy)
INSERT INTO configuracoes (chave, valor) VALUES
  ('revisao_bancaria_modo', 'fixo'),                 -- fixo | percentual
  ('revisao_bancaria_preco_fixo', '1500'),
  ('revisao_bancaria_percentual', '1'),              -- % do valor financiado no modo percentual
  ('revisao_bancaria_preco_minimo', '1500'),
  ('revisao_bancaria_razao_forte', '1.5'),           -- taxa contratada ÷ média BACEN
  ('revisao_bancaria_razao_moderada', '1.2'),
  ('revisao_bancaria_economia_forte_pct', '15'),     -- % do valor financiado
  ('revisao_bancaria_economia_moderada_pct', '5'),
  ('revisao_bancaria_prescricao_anos', '10'),        -- após a quitação
  ('balladao_whatsapp', '')
ON CONFLICT (chave) DO NOTHING;
