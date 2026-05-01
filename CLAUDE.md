# 🔍 RASTREIA
## Sistema de Consultas e Dossiês de Inteligência de Dados
### Recobro Recuperação de Crédito | Anápolis - GO

---

## VISÃO GERAL

O **Rastreia** é um sistema B2B de consultas e dossiês de dados, desenvolvido para a **Recobro Recuperação de Crédito**, em parceria com o **Balladão Advogados**. Permite que operadores gerem relatórios pagos sobre pessoas físicas e jurídicas, integrando múltiplas APIs de dados públicos brasileiros.

**Diferenciais do produto:**
- Relatório PDF gerado automaticamente com score de risco 0–100
- Parecer jurídico do Balladão Advogados incluso nos produtos premium
- Integração simultânea de múltiplas fontes oficiais
- Entrega via WhatsApp em até 2 horas
- Operação simples: qualquer estagiário consegue operar

---

## STACK TECNOLÓGICA

```
Backend:     Node.js 18+ + Express
Banco:       PostgreSQL (Railway)
Frontend:    HTML/CSS/JS puro (sem framework)
PDF:         PDFKit
Pagamentos:  Mercado Pago (Checkout Pro + Pix + webhook)
WhatsApp:    Evolution API
Deploy:      Railway (auto-deploy via GitHub)
```

---

## ESTRUTURA DE PASTAS

```
rastreia/
├── server.js                    # Entry point Express + rotas + webhook MP
├── db.js                        # Alias para db/index.js
├── railway.toml                 # Configuração de deploy Railway
├── package.json
├── .env.example                 # Template de variáveis de ambiente
│
├── db/
│   ├── index.js                 # Pool PostgreSQL com SSL Railway
│   └── schema.sql               # Schema completo — rodar no Railway após deploy
│
├── routes/
│   ├── auth.js                  # Login JWT, criar usuários, trocar senha
│   └── pedidos.js               # CRUD pedidos, consultas, PDF, dashboard stats
│
├── services/
│   ├── consultas.js             # Todas as integrações com APIs externas
│   ├── produtos.js              # Definição dos 5 produtos, score de risco, checklist
│   ├── pdf.js                   # Gerador de PDF por produto (PDFKit)
│   └── whatsapp.js              # Notificações via Evolution API
│
└── public/
    ├── index.html               # Login
    ├── dashboard.html           # Painel de pedidos com stats
    ├── novo-pedido.html         # Criar pedido com seletor de produto
    ├── pedido.html              # Detalhe e operação do pedido
    ├── privacidade.html         # Política de Privacidade (LGPD)
    ├── termos.html              # Termos de Uso
    └── css/
        └── style.css            # CSS global
```

---

## OS 5 PRODUTOS

| Produto | Chave | Preço | Prazo | APIs usadas |
|---|---|---|---|---|
| Dossiê Pessoa Física | `dossie_pf` | R$197 | 2h | Direct Data, Escavador, Datajud |
| Dossiê Pessoa Jurídica | `dossie_pj` | R$397 | 2h | CNPJá, Escavador, Datajud, Transparência |
| Due Diligence Empresarial | `due_diligence` | R$997 | 24h | Todas |
| Análise de Devedor | `analise_devedor` | R$250 | 2h | Direct Data, Escavador, Datajud |
| Investigação Patrimonial | `investigacao_patrimonial` | R$497 | 4h | Direct Data, Escavador, ONR, Infosimples |

---

## APIS INTEGRADAS

### Gratuitas (já funcionam sem configuração)
| API | Finalidade | Variável |
|---|---|---|
| CNPJ.ws | Fallback dados CNPJ | — |
| Datajud CNJ | Processos judiciais | `DATAJUD_API_KEY` (opcional) |
| Portal da Transparência | Listas negras CEIS/CNEP | `TRANSPARENCIA_TOKEN` |

### Pagas (essenciais para o produto completo)
| API | Finalidade | Variável | URL cadastro |
|---|---|---|---|
| CNPJá | CNPJ enriquecido + Simples Nacional | `CNPJA_API_KEY` | cnpja.com |
| Direct Data | CPF: endereço, telefone, renda, WhatsApp | `DIRECTD_TOKEN` | app.directd.com.br |
| Escavador | Processos judiciais estruturados | `ESCAVADOR_API_KEY` | api.escavador.com |
| ONR RI Digital | Matrícula de imóvel, pesquisa de bens | `ONR_API_KEY` | integracao.registrodeimoveis.org.br |
| Infosimples | DETRAN-GO, veículos | `INFOSIMPLES_TOKEN` | infosimples.com |
| Serasa | Score de crédito (fase 2) | `SERASA_API_KEY` | serasaexperian.com.br |

### Pagamentos e Comunicação
| Serviço | Variável | URL |
|---|---|---|
| Mercado Pago | `MP_ACCESS_TOKEN` | mercadopago.com.br/developers |
| Evolution API (WhatsApp) | `EVOLUTION_API_KEY` | — |

---

## FLUXO OPERACIONAL COMPLETO

```
1. PEDIDO CRIADO
   Operador preenche: tipo de produto + dados do alvo + dados do cliente
   Status: aguardando_pagamento

2. PAGAMENTO
   Automático: webhook MP detecta pagamento → status = pago
   Manual: operador clica "Confirmar Pagamento" → status = pago
   Sistema notifica operador via WhatsApp

3. ANÁLISE INICIADA
   Operador clica "Iniciar Análise" → status = em_andamento

4. CONSULTAS AUTOMÁTICAS
   Operador clica "Executar Consultas"
   → executarConsultaCompleta() em services/consultas.js
   → Todas as APIs rodam em paralelo (Promise.all)
   → Dados salvos como JSONB na tabela dados_consulta (por fonte)

5. REVISÃO E OBSERVAÇÕES
   Operador verifica dados, adiciona observações/parecer no campo de texto

6. GERAÇÃO DO RELATÓRIO
   Operador clica "Gerar PDF e Concluir"
   → gerarDossie() em services/pdf.js
   → PDF gerado com score de risco + checklist + dados de todas as fontes
   → Status = concluido
   → Cliente notificado via WhatsApp com link do PDF
```

---

## BANCO DE DADOS — TABELAS PRINCIPAIS

```sql
usuarios          -- Operadores do sistema (admin/operador)
pedidos           -- Cada solicitação de consulta
dados_consulta    -- Dados de cada fonte por pedido (JSONB)
logs              -- Histórico de ações por pedido
configuracoes     -- Preços e parâmetros do sistema
```

**IMPORTANTE:** Os dados de cada fonte são salvos como JSONB separado na tabela `dados_consulta`, identificados pela coluna `fonte` (receita_federal, processos, transparencia, serasa). Nunca misture os dados em uma única coluna.

---

## AUTENTICAÇÃO

- JWT com expiração de 12 horas
- Dois perfis: `admin` e `operador`
- Token enviado no header: `Authorization: Bearer TOKEN`
- Login em `/api/auth/login` (POST)
- Criação de usuários apenas por admin em `/api/auth/usuarios` (POST)

---

## SCORE DE RISCO

Calculado pela função `calcularScore(tipo, dados)` em `services/produtos.js`.

**Regras do score (0 a 100, começa em 100):**
- Cada processo judicial como réu: -5 pontos (máximo -40)
- Constar em lista negra federal (CEIS/CNEP): -40 pontos
- Situação irregular na Receita Federal: -25 pontos
- Registro de óbito no CPF: -50 pontos
- Empresa com menos de 1 ano: -10 pontos
- Empresa com mais de 5 anos: +5 pontos

**Classificação final:**
- 75–100: BAIXO RISCO (verde)
- 50–74: RISCO MÉDIO (laranja)
- 25–49: ALTO RISCO (vermelho)
- 0–24: RISCO CRÍTICO (vermelho)

**NUNCA recalcule o score fora de `services/produtos.js`.**

---

## MERCADO PAGO — INTEGRAÇÃO COMPLETA

### O que precisa ser implementado:

**1. Gerar link de pagamento ao criar pedido**
```javascript
// Em routes/pedidos.js — ao criar pedido, gerar preferência MP
const mpResponse = await axios.post(
  'https://api.mercadopago.com/checkout/preferences',
  {
    items: [{
      title: produto.nome,
      quantity: 1,
      unit_price: produto.preco,
      currency_id: 'BRL'
    }],
    external_reference: pedido.id,
    back_urls: {
      success: `${BASE_URL}/pedido.html?id=${pedido.id}&status=success`,
      failure: `${BASE_URL}/pedido.html?id=${pedido.id}&status=failure`
    },
    auto_return: 'approved',
    notification_url: `${BASE_URL}/webhook/mp`
  },
  { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
);
// Salvar mp_preference_id e retornar init_point (link de pagamento)
```

**2. Webhook já implementado em server.js**
```javascript
// POST /webhook/mp — já existe, processa notificações de pagamento
```

**3. Botão de pagamento no frontend**
```javascript
// Em pedido.html — mostrar botão quando status = aguardando_pagamento
// <a href="${pedido.mp_init_point}" class="btn btn-primary">Pagar Agora</a>
```

**4. Adicionar colunas no schema**
```sql
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mp_preference_id VARCHAR(100);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mp_init_point TEXT;
```

### Configuração no painel MP:
- Habilitar Pix, Cartão de Crédito e Boleto
- Configurar webhook URL: `https://SEU-DOMINIO.up.railway.app/webhook/mp`
- Modo de recebimento: D+14 (menor taxa)
- Desabilitar parcelamento (produtos de ticket único)

---

## PAGAMENTO MULTI-MÉTODO (Fase 9)

O operador escolhe a forma de cobrança ao criar o pedido. Não há redirect
automático para o checkout do MP — quando o operador escolhe "Mercado Pago",
o sistema **gera um link** (init_point) que ele envia ao cliente final via
WhatsApp ou email.

### Formas de pagamento (campo `pedidos.forma_pagamento`)

| Forma         | O que faz                                                     | Webhook MP? |
|---------------|---------------------------------------------------------------|-------------|
| `mercadopago` | Cria preference, mostra link copiável + WA + email            | Sim         |
| `dinheiro`    | Marca como pago imediatamente, dispara pipeline               | Não         |
| `plano`       | Debita 1 da cota mensal do operador, marca pago, pipeline     | Não         |
| (NULL)        | "Apenas registrar" — pedido fica aguardando_pagamento         | —           |

### Plano (cota mensal por usuário)

Cada usuário do sistema (operador) tem uma cota mensal configurada por um admin
em `/usuarios.html` → botão "Plano". Colunas em `usuarios`:

- `plano_cota_mensal` — 0 = sem plano, >0 = limite mensal de consultas
- `plano_consultas_usadas` — contador do ciclo atual
- `plano_ciclo_inicio` — 1º dia do mês do ciclo. Reset preguiçoso: ao virar o
  mês, no primeiro acesso à API o contador zera automaticamente.

Quando o operador cobra "do plano", `services/planos_usuario.debitarPlano()`
faz um UPDATE atômico condicional (`plano_consultas_usadas < plano_cota_mensal`)
para evitar passar do limite sob concorrência.

### Endpoints novos
- `POST /api/pedidos/:id/pagamento-alternativo` — body `{forma: 'dinheiro'|'plano'}`
- `POST /api/pedidos/:id/enviar-email-pagamento` — body `{email}` (envia link MP)
- `GET  /api/me/plano` — status do plano do usuário logado
- `GET  /api/admin/usuarios/:id/plano` — admin
- `PATCH /api/admin/usuarios/:id/plano` — admin, body `{cota_mensal}`
- `POST /api/admin/usuarios/:id/plano/resetar` — admin

### Email (SMTP)
`services/email.js` usa nodemailer. Configure `SMTP_HOST`, `SMTP_USER`,
`SMTP_PASS` (e opcionalmente `SMTP_PORT`, `SMTP_FROM`, `SMTP_SECURE`). Se não
configurado, `POST /enviar-email-pagamento` retorna 503 com mensagem clara.

---

## MÓDULO IMOBILIÁRIO — A IMPLEMENTAR

### Novo produto: Due Diligence Imobiliária (R$997)
Analisa: comprador + vendedor + imóvel em 24h com parecer do Balladão.

**APIs adicionais necessárias:**
```javascript
// services/consultas.js — adicionar:

async function consultarONR(cpf, estado) {
  // ONR RI Digital — pesquisa bens imóveis por CPF
  // Docs: integracao.registrodeimoveis.org.br
  // Retorna: matrículas vinculadas ao CPF no estado
}

async function consultarInfosimples(placa) {
  // Infosimples DETRAN-GO — dados do veículo
  // Retorna: proprietário, restrições, gravames
}
```

**Novo produto em services/produtos.js:**
```javascript
due_diligence_imobiliaria: {
  nome: 'Due Diligence Imobiliária',
  preco: 997,
  prazo_horas: 24,
  // Consulta 3 alvos: comprador + vendedor + imóvel
  alvos_multiplos: true
}
```

---

## MÓDULOS A IMPLEMENTAR (backlog)

### 1. Consulta gratuita / demonstração
- Versão limitada do Dossiê PF (sem endereço, sem telefone, sem score completo)
- Limite: 1 por empresa (identificar por CNPJ do solicitante)
- Status especial: `demonstracao`
- Follow-up automático via WhatsApp em 24h

### 2. Planos de assinatura
```sql
-- Nova tabela
CREATE TABLE assinaturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_nome VARCHAR(255),
  cliente_cnpj VARCHAR(20),
  plano VARCHAR(50), -- essencial, profissional, premium
  valor_mensal DECIMAL(10,2),
  consultas_incluidas INT,
  consultas_utilizadas INT DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  renovacao_em DATE,
  criado_em TIMESTAMP DEFAULT NOW()
);
```

### 3. Portal do cliente
- Página pública onde cliente acompanha status do pedido
- Acesso via link único (token no pedido)
- URL: `/acompanhar?token=TOKEN_UNICO`

### 4. Política de Privacidade e Termos de Uso
- Arquivos: `public/privacidade.html` e `public/termos.html`
- Aceite obrigatório no campo "finalidade da consulta" em cada pedido
- Registrar IP + timestamp do aceite na tabela `logs`

### 5. Relatório mensal automático
- Gerado via cron job (`node-cron` já instalado)
- Enviado por email e WhatsApp para o admin
- Conteúdo: faturamento, consultas realizadas, produtos mais vendidos

---

## LGPD — CONFORMIDADE OBRIGATÓRIA

O sistema trata dados pessoais com base nas seguintes hipóteses legais (Art. 7º LGPD):
- **Proteção do crédito** — análise de risco antes de contrato
- **Prevenção à fraude** — verificação de idoneidade
- **Exercício regular de direitos** — instrução de processos judiciais

**O que o sistema DEVE fazer para conformidade:**
1. Exigir declaração de finalidade em cada pedido (campo obrigatório)
2. Registrar IP e timestamp de cada consulta nos logs
3. Ter Política de Privacidade e Termos de Uso acessíveis
4. Não armazenar dados além do necessário (política de retenção)
5. Usar apenas fontes públicas oficiais (Receita Federal, CNJ, etc.)

**O que o sistema NÃO DEVE fazer:**
- Aceitar pedidos sem finalidade declarada
- Armazenar senhas ou dados sensíveis em texto puro
- Compartilhar dados entre clientes diferentes
- Permitir consultas por curiosidade ou fins privados não comerciais

---

## VARIÁVEIS DE AMBIENTE — COMPLETO

```env
# BANCO (Railway fornece automaticamente)
DATABASE_URL=postgresql://user:pass@host:5432/rastreia

# AUTENTICAÇÃO
JWT_SECRET=chave_longa_e_aleatoria_minimo_32_caracteres

# AMBIENTE
NODE_ENV=production
PORT=3000
BASE_URL=https://rastreia-production.up.railway.app

# APIs DE DADOS — GRATUITAS
DATAJUD_API_KEY=                    # Opcional — sem ela usa chave pública
TRANSPARENCIA_TOKEN=                # Gratuito: portaldatransparencia.gov.br/api-de-dados/cadastrar-email

# APIs DE DADOS — PAGAS
DIRECTD_TOKEN=                      # app.directd.com.br (R$50 grátis para testar)
ESCAVADOR_API_KEY=                  # api.escavador.com
CNPJA_API_KEY=                      # cnpja.com
ONR_API_KEY=                        # integracao.registrodeimoveis.org.br (módulo imobiliário)
INFOSIMPLES_TOKEN=                  # infosimples.com (veículos/DETRAN)
SERASA_API_KEY=                     # Fase 2 — requer contrato empresarial

# PAGAMENTOS
MP_ACCESS_TOKEN=                    # Mercado Pago: mercadopago.com.br/developers
MP_WEBHOOK_SECRET=                  # Validar autenticidade dos webhooks MP

# EMAIL (SMTP) — usado para enviar link de pagamento ao cliente
SMTP_HOST=                          # ex: smtp.gmail.com / smtp.office365.com / smtp.zoho.com
SMTP_PORT=587                       # 465 (SSL), 587 (STARTTLS), 25 (sem TLS)
SMTP_USER=                          # login (geralmente o email remetente)
SMTP_PASS=                          # senha de app (NÃO use a senha normal da conta)
SMTP_FROM=                          # remetente exibido — opcional. Default: SMTP_USER
SMTP_SECURE=                        # "true" força TLS implícito (porta 465). Inferido pela porta se vazio

# WHATSAPP
EVOLUTION_API_URL=                  # URL da sua instância Evolution API
EVOLUTION_API_KEY=                  # API key da instância
EVOLUTION_INSTANCE=rastreia         # Nome da instância
WHATSAPP_OPERADOR=5562XXXXXXXXX     # Número do operador para alertas
```

---

## DEPLOY NO RAILWAY

### Passo a passo completo:

```bash
# 1. Subir para GitHub
git init
git add .
git commit -m "Rastreia v1"
git branch -M main
git remote add origin https://github.com/fredlasmar1/rastreia.git
git push -u origin main

# 2. Railway
# → railway.app → New Project → Deploy from GitHub → rastreia
# → + New → Database → PostgreSQL
# → Variables → adicionar todas do .env.example

# 3. Rodar schema no banco
# → Railway → PostgreSQL → Data → Query → colar db/schema.sql

# 4. Criar admin
node -e "const b=require('bcryptjs'); b.hash('senha123',10).then(h=>console.log(h));"
# Copiar hash e rodar no banco:
# UPDATE usuarios SET senha_hash='HASH' WHERE email='admin@recobro.com.br';
```

---

## REGRAS ABSOLUTAS — NÃO QUEBRAR

1. **Frontend é HTML/CSS/JS puro** — não introduzir React, Vue ou qualquer framework
2. **Não criar arquivos CSS ou JS separados** — manter tudo inline nos HTMLs
3. **Score de risco só em `services/produtos.js`** — nunca recalcular em outro lugar
4. **PDF só em `services/pdf.js`** — nunca gerar PDF fora dessa função
5. **Dados por fonte em JSONB separados** — nunca misturar na mesma coluna
6. **SSL PostgreSQL** — `rejectUnauthorized: false` em produção (já em db/index.js)
7. **JWT de 12h** — não alterar o tempo de expiração
8. **Não hardcodar secrets** — sempre usar variáveis de ambiente
9. **Não aceitar pedido sem finalidade declarada** — campo obrigatório no formulário
