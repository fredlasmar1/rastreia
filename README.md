# 🔍 RASTREIA
### Sistema de Consultas e Dossiês | Recobro Recuperação de Crédito

---

## DEPLOY NO RAILWAY — PASSO A PASSO

### 1. Criar o projeto no Railway
1. Acesse https://railway.app
2. New Project → Deploy from GitHub Repo
3. Selecione o repositório `rastreia`
4. Railway detecta Node.js automaticamente

### 2. Adicionar PostgreSQL
1. No projeto Railway, clique em "+ New"
2. Selecione "Database" → "PostgreSQL"
3. O Railway vincula automaticamente a `DATABASE_URL`

### 3. Configurar variáveis de ambiente
No Railway, vá em "Variables" e adicione:

```
JWT_SECRET=coloque_uma_chave_secreta_longa_aqui
MP_ACCESS_TOKEN=seu_token_mercado_pago
EVOLUTION_API_URL=https://sua-evolution-api.com
EVOLUTION_API_KEY=sua_api_key
EVOLUTION_INSTANCE=rastreia
ESCAVADOR_API_KEY=sua_key_escavador
WHATSAPP_OPERADOR=5562999999999
BASE_URL=https://rastreia-production.up.railway.app
NODE_ENV=production
```

### 4. Criar o banco de dados
1. No Railway, clique no serviço PostgreSQL
2. Vá em "Data" → "Query"
3. Cole o conteúdo de `db/schema.sql` e execute

### 5. Trocar a senha do admin
Após o deploy, acesse o sistema e troque a senha padrão:
- Email: `admin@recobro.com.br`
- Senha padrão: `rastreia2024`

Para criar via SQL:
```sql
UPDATE usuarios 
SET senha_hash = '$2a$10$SEU_HASH_AQUI'
WHERE email = 'admin@recobro.com.br';
```

Ou use a API:
```bash
curl -X POST https://SEU-DOMINIO/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@recobro.com.br","senha":"rastreia2024"}'
```

---

## PRODUTOS DISPONÍVEIS

| Produto | Ticket | Prazo |
|---|---|---|
| Dossiê PF | R$ 197 | 2h |
| Dossiê PJ | R$ 397 | 2h |
| Due Diligence | R$ 997 | 24h |
| Análise de Devedor | R$ 250 | 2h |
| Investigação Patrimonial | R$ 497 | 4h |

---

## FLUXO OPERACIONAL (ESTAGIÁRIO)

1. Cliente solicita e paga via link do Mercado Pago
2. Sistema notifica WhatsApp do operador
3. Operador abre o pedido no sistema
4. Clica "Iniciar Análise"
5. Clica "Executar Consultas Automáticas" (puxa Receita Federal + Escavador)
6. Verifica JusBrasil pelo link gerado automaticamente
7. Adiciona observações
8. Clica "Gerar PDF e Concluir"
9. Sistema envia PDF por WhatsApp para o cliente automaticamente

---

## INTEGRAÇÕES

| Integração | Status | Notas |
|---|---|---|
| Receita Federal (CNPJ.ws) | ✅ Grátis | Sem API key necessária |
| Escavador | ⚙️ Requer API key | Contratar em escavador.com.br |
| JusBrasil | ✅ Link automático | Consulta manual |
| Serasa | ⚙️ Requer contrato | Placeholder implementado |
| Mercado Pago | ⚙️ Requer config | Webhook `/webhook/mp` |
| WhatsApp (Evolution) | ⚙️ Requer Evolution API | Notificações automáticas |

---

## STACK TÉCNICA
- **Backend:** Node.js + Express
- **Banco:** PostgreSQL
- **Frontend:** HTML/CSS/JS puro (sem framework)
- **PDF:** PDFKit
- **Deploy:** Railway
