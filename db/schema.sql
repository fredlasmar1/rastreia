-- RASTREIA - Schema PostgreSQL
-- Executar no Railway após criar o banco

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Usuários do sistema
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  perfil VARCHAR(50) DEFAULT 'operador', -- admin, operador
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMP DEFAULT NOW()
);

-- Pedidos de consulta
CREATE TABLE IF NOT EXISTS pedidos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero SERIAL,
  tipo VARCHAR(100) NOT NULL, -- dossie_pf, dossie_pj, due_diligence, analise_devedor, investigacao_patrimonial
  status VARCHAR(50) DEFAULT 'aguardando', -- aguardando_pagamento, pago, em_andamento, concluido, cancelado
  
  -- Dados do solicitante
  cliente_nome VARCHAR(255) NOT NULL,
  cliente_email VARCHAR(255),
  cliente_whatsapp VARCHAR(20),
  
  -- Alvo da consulta
  alvo_nome VARCHAR(255) NOT NULL,
  alvo_documento VARCHAR(20) NOT NULL, -- CPF ou CNPJ
  alvo_tipo VARCHAR(10) NOT NULL, -- PF ou PJ
  
  -- Financeiro
  valor DECIMAL(10,2) NOT NULL,
  mp_payment_id VARCHAR(100),
  pago_em TIMESTAMP,
  
  -- Operação
  operador_id UUID REFERENCES usuarios(id),
  iniciado_em TIMESTAMP,
  concluido_em TIMESTAMP,
  prazo_entrega TIMESTAMP,
  
  -- Resultado
  relatorio_url TEXT,
  observacoes TEXT,
  
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Dados coletados por pedido (JSON flexível)
CREATE TABLE IF NOT EXISTS dados_consulta (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id UUID REFERENCES pedidos(id) ON DELETE CASCADE,
  fonte VARCHAR(100) NOT NULL, -- receita_federal, jusbrasil, escavador, serasa, cnpj_ws
  dados JSONB,
  coletado_em TIMESTAMP DEFAULT NOW()
);

-- Log de atividades
CREATE TABLE IF NOT EXISTS logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id UUID REFERENCES pedidos(id),
  usuario_id UUID REFERENCES usuarios(id),
  acao VARCHAR(255) NOT NULL,
  detalhes TEXT,
  criado_em TIMESTAMP DEFAULT NOW()
);

-- Configurações do sistema
CREATE TABLE IF NOT EXISTS configuracoes (
  chave VARCHAR(100) PRIMARY KEY,
  valor TEXT,
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Preços dos produtos
INSERT INTO configuracoes VALUES 
  ('preco_dossie_pf', '197', NOW()),
  ('preco_dossie_pj', '397', NOW()),
  ('preco_due_diligence', '997', NOW()),
  ('preco_analise_devedor', '250', NOW()),
  ('preco_investigacao_patrimonial', '497', NOW()),
  ('prazo_dossie_horas', '2', NOW()),
  ('prazo_due_diligence_horas', '24', NOW()),
  ('whatsapp_operador', '', NOW()),
  ('email_operador', '', NOW())
ON CONFLICT (chave) DO NOTHING;

-- Admin padrão (senha: rastreia2024 - TROCAR NO PRIMEIRO ACESSO)
INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (
  'Administrador',
  'admin@recobro.com.br',
  '$2a$10$rqTgTqv9K5K5K5K5K5K5KO1234567890abcdefghijklmnop',
  'admin'
) ON CONFLICT (email) DO NOTHING;

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_criado ON pedidos(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_documento ON pedidos(alvo_documento);
CREATE INDEX IF NOT EXISTS idx_dados_pedido ON dados_consulta(pedido_id);
