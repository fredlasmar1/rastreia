-- Análise rápida de contrato (aba Revisão de Contratos, 13/10/2026):
-- sobe o contrato → IA lê → o código calcula → veredito PRELIMINAR na tela.
-- Se valer a pena, vira revisão completa (pedido_id) aproveitando a leitura.
CREATE TABLE IF NOT EXISTS revisao_analises (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'lendo',   -- lendo | pronto | erro
  arquivos JSONB NOT NULL DEFAULT '[]',   -- [{ filename, filepath, mime_type, size_bytes }]
  dados_extraidos JSONB,                  -- saída bruta da IA
  dados JSONB,                            -- dados usados no cálculo (editáveis na tela)
  taxa_media_bacen JSONB,
  calculo JSONB,
  teses JSONB,
  veredito TEXT,
  economia_estimada NUMERIC(14,2),
  erro TEXT,
  custo_ia JSONB,
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  criado_por UUID REFERENCES usuarios(id),
  consentimento_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_revisao_analises_criado ON revisao_analises(criado_em DESC);
