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

  -- Score calculado no momento da geração do relatório (para histórico)
  score_calculado INT,
  score_classificacao VARCHAR(50),

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

-- Admin padrão é criado via variáveis de ambiente (ADMIN_EMAIL, ADMIN_SENHA)

-- ─────────────────────────────────────────────
-- COLUNAS NOVAS — Mercado Pago, LGPD, Imobiliário, Portal Público
-- ─────────────────────────────────────────────

-- Mercado Pago (P1)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mp_preference_id VARCHAR(255);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mp_init_point TEXT;

-- LGPD (P2)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS finalidade VARCHAR(100);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ip_solicitante VARCHAR(50);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS aceite_termos BOOLEAN DEFAULT false;

-- Due Diligence Imobiliária (P3)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS alvo2_nome VARCHAR(255);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS alvo2_documento VARCHAR(20);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS alvo2_tipo VARCHAR(10) DEFAULT 'PF';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS imovel_matricula VARCHAR(100);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS imovel_endereco TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS imovel_estado VARCHAR(2) DEFAULT 'GO';

-- Portal público do cliente (P5)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS token_publico VARCHAR(64) UNIQUE;

-- Consulta Veicular (standalone por placa)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS alvo_placa VARCHAR(10);
ALTER TABLE pedidos ALTER COLUMN alvo_nome DROP NOT NULL;
ALTER TABLE pedidos ALTER COLUMN alvo_documento DROP NOT NULL;
ALTER TABLE pedidos ALTER COLUMN alvo_tipo DROP NOT NULL;

-- Tabela de assinaturas (P4)
CREATE TABLE IF NOT EXISTS assinaturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_nome VARCHAR(255) NOT NULL,
  cliente_cnpj VARCHAR(20),
  cliente_email VARCHAR(255),
  cliente_whatsapp VARCHAR(20),
  nicho VARCHAR(100),
  plano VARCHAR(50) NOT NULL,
  valor_mensal DECIMAL(10,2) NOT NULL,
  consultas_inclusas INT DEFAULT 0,
  consultas_utilizadas INT DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  mp_subscription_id VARCHAR(255),
  renovacao_em DATE,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_criado ON pedidos(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_documento ON pedidos(alvo_documento);
CREATE INDEX IF NOT EXISTS idx_pedidos_mp ON pedidos(mp_payment_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_token ON pedidos(token_publico);
CREATE INDEX IF NOT EXISTS idx_dados_pedido ON dados_consulta(pedido_id);
CREATE INDEX IF NOT EXISTS idx_assinaturas_ativo ON assinaturas(ativo);

-- Clientes (CRM)
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  whatsapp VARCHAR(20),
  cnpj VARCHAR(20),
  empresa VARCHAR(255),
  nicho VARCHAR(100),
  endereco TEXT,
  observacoes TEXT,
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome);
CREATE INDEX IF NOT EXISTS idx_clientes_cnpj ON clientes(cnpj);

-- ─────────────────────────────────────────────
-- Custos de API (valor que a Recobro paga por consulta)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_custos (
  chave VARCHAR(100) PRIMARY KEY,       -- ex: 'escavador_processos', 'directd_pf_plus'
  rotulo VARCHAR(255) NOT NULL,         -- texto exibido na UI
  valor_brl DECIMAL(10,4) NOT NULL,     -- custo por consulta (4 decimais para centavos finos)
  fonte VARCHAR(255),                   -- referencia/origem do valor
  confianca VARCHAR(20) DEFAULT 'estimado', -- oficial | estimado
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Seed com valores OFICIAIS do Cardapio DirectData V4.3 (2026)
-- Revisado em Abr/2026: todos os precos V4.3 conferem com V4.1 (sem alteracao)
-- Atualize manualmente em /custos-api.html quando os precos mudarem
INSERT INTO api_custos (chave, rotulo, valor_brl, fonte, confianca) VALUES
  ('escavador_processos',    'Escavador — Processos por CPF/CNPJ',        4.5000, 'Tabela publica Escavador',                              'oficial'),
  ('datajud',                'Datajud CNJ (TJGO/TRF1/STJ/TST)',           0.0000, 'API publica gratuita',                                  'oficial'),
  ('cnpja',                  'CNPJa — Receita Federal CNPJ',              0.0000, 'Plano gratuito',                                        'oficial'),
  ('directd_pf_plus',        'DirectData — Cadastro PF Plus',             0.3600, 'Cardapio DirectData V4.3 (Cadastral)',                  'oficial'),
  ('directd_cnpj',           'DirectData — Cadastro PJ Plus',             0.3600, 'Cardapio DirectData V4.3 (Cadastral)',                  'oficial'),
  ('directd_score_quod',     'DirectData — Score QUOD',                   1.9800, 'Cardapio DirectData V4.3 (Credito)',                    'oficial'),
  ('directd_negativacoes',   'DirectData — Detalhamento Negativo',        2.3800, 'Cardapio DirectData V4.3 (Credito)',                    'oficial'),
  ('directd_perfil_economico','DirectData — Nivel Socioeconomico e Renda', 0.3600, 'Cardapio DirectData V4.3 (Credito)',                   'oficial'),
  ('directd_vinculos',       'DirectData — Vinculos Societarios',         1.8400, 'Cardapio DirectData V4.3 (Cadastral)',                  'oficial'),
  ('directd_veiculos',       'DirectData — Consulta Veicular (placa)',    5.4000, 'Cardapio DirectData V4.3 (Veicular)',                   'oficial'),
  ('credify_historico_proprietario','Credify — Historico de Proprietarios (por placa)', 0.9000, 'Credify (credifyapis.readme.io) — valor referencia, acertar via contato comercial', 'estimado'),
  ('directd_historico_veiculos','DirectData — Historico de Veiculos (PF/PJ)', 0.3600, 'Cardapio DirectData V4.3 (Veicular)',                  'oficial'),
  ('directd_protestos',      'DirectData — Protestos Nacional',           0.7200, 'Cardapio DirectData V4.3 (Credito)',                    'oficial'),
  ('directd_obito',          'DirectData — Obito (PF)',                   0.3600, 'Cardapio DirectData V4.3 (Cadastral)',                  'oficial'),
  ('directd_beneficiario_final','DirectData — Beneficiario Final (UBO)',  1.4400, 'Cardapio DirectData V4.3 (Societario)',                 'oficial'),
  ('transparencia',          'Portal da Transparencia (CGU)',             0.0000, 'API publica gratuita',                                  'oficial'),
  ('infosimples_detran_go',  'InfoSimples DETRAN-GO',                     0.2600, 'Tabela publica InfoSimples',                            'oficial'),
  ('onr_matricula',          'ONR — Matricula de imovel',                 0.0000, 'Depende do cartorio, variavel',                         'estimado')
ON CONFLICT (chave) DO UPDATE SET
  rotulo = EXCLUDED.rotulo,
  valor_brl = EXCLUDED.valor_brl,
  fonte = EXCLUDED.fonte,
  confianca = EXCLUDED.confianca,
  atualizado_em = NOW()
WHERE api_custos.confianca != 'manual';  -- preserva edicoes manuais feitas em /custos-api.html

-- ==========================================================================
-- MIGRATIONS IDEMPOTENTES (ALTER TABLE) - rodam a cada boot, seguras
-- ==========================================================================

-- Fase 3: armazenar score calculado no momento da geração do PDF, permite
-- histórico por CPF/CNPJ e tendência de risco entre consultas.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS score_calculado INT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS score_classificacao VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_pedidos_alvo_doc_data ON pedidos(alvo_documento, criado_em DESC);

-- ==========================================================================
-- Fase 5: tiers comerciais da Consulta Veicular (Básico / Completo / Premium)
-- ==========================================================================
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tier_veicular VARCHAR(20);      -- basico | completo | premium
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS addons_veicular TEXT;            -- CSV: leilao,cnh_proprietario,veiculos_por_cpf
