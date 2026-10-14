-- Cobranças pelo Mercado Pago (13/10/2026): parcela de pedido (dividido em meses),
-- cobrança em lote e mensalidade de plano. Cada link leva external_reference
-- 'cob:<id>'; o webhook baixa a cobrança e aplica o efeito (libera o pedido na
-- 1ª parcela, renova a cota do plano na mensalidade).
CREATE TABLE IF NOT EXISTS cobrancas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origem VARCHAR(20) NOT NULL,              -- parcela | lote | plano
  pedido_id UUID REFERENCES pedidos(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES clientes(id),
  descricao TEXT,
  numero INTEGER,                           -- parcela n de total
  total INTEGER,
  valor NUMERIC(12,2) NOT NULL,
  vencimento DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'aberta',   -- aberta | paga | cancelada
  mp_preference_id VARCHAR(100),
  mp_init_point TEXT,
  mp_payment_id VARCHAR(50),
  forma_baixa VARCHAR(20),                  -- mercadopago | manual
  pago_em TIMESTAMPTZ,
  criado_por UUID REFERENCES usuarios(id),
  criado_em TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cobrancas_status ON cobrancas(status, vencimento);
CREATE INDEX IF NOT EXISTS idx_cobrancas_pedido ON cobrancas(pedido_id);
CREATE INDEX IF NOT EXISTS idx_cobrancas_cliente ON cobrancas(cliente_id);

-- Assinatura mensal no cartão (Mercado Pago preapproval) por cliente de plano
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS mp_preapproval_id VARCHAR(100);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS assinatura_status VARCHAR(20);      -- pending | authorized | paused | cancelled
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS assinatura_link TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS assinatura_ultimo_pagamento TIMESTAMPTZ;
