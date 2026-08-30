# Tactia Core — Software Development Specification

**Versão:** 0.1
**Status:** Draft para implementação
**Produto:** Tactia
**Objetivo:** Construir o núcleo multi-tenant de dados, contexto, inteligência e execução da Tactia.

---

# 1. Visão

A Tactia é uma camada de inteligência operacional para empresas.

Seu objetivo é transformar dados dispersos em:

> **Entenda. Decida. Execute.**

O Core da Tactia deve fornecer as abstrações fundamentais para:

1. representar empresas e usuários;
2. armazenar dados empresariais normalizados;
3. conectar fontes de dados;
4. executar sincronizações;
5. gerar e armazenar insights;
6. registrar recomendações;
7. permitir conversações com a Tactia;
8. executar ações com rastreabilidade;
9. manter isolamento completo entre clientes.

O Core **não deve depender de um sistema específico** como ERP, CRM ou plataforma de marketing.

---

# 2. Objetivo da V0.1

Ao final desta versão deverá ser possível:

```text
Criar empresa
      ↓
Criar usuários
      ↓
Configurar uma fonte de dados
      ↓
Importar dados
      ↓
Normalizar dados
      ↓
Consultar informações empresariais
      ↓
Calcular métricas
      ↓
Gerar Insight
      ↓
Apresentar Insight ao usuário
      ↓
Solicitar uma ação
      ↓
Registrar a execução
```

A V0.1 deve permitir colocar pelo menos **um cliente real** dentro da plataforma.

---

# 3. Princípios arquiteturais

## 3.1 Multi-tenancy first

Toda informação pertencente a um cliente deve estar associada a um `tenant_id`.

Nenhum request autenticado pode acessar dados de outro tenant.

---

## 3.2 Canonical Data Model

A Tactia não deve estruturar sua inteligência em torno de sistemas externos.

Exemplo:

```text
ERP A ───────┐
ERP B ───────┤
CRM A ───────┼──→ Tactia Data Model
Excel ───────┤
API ─────────┘
```

O sistema externo é apenas uma fonte.

---

## 3.3 Raw + Normalized

Os dados importados devem poder ser preservados na forma original.

```text
Source
  ↓
RawRecord
  ↓
Normalizer
  ↓
Canonical Entity
```

Isso permite:

- debugging;
- reprocessamento;
- auditoria;
- evolução dos mapeamentos.

---

## 3.4 Deterministic before AI

A Tactia deve calcular números e métricas usando código.

LLMs devem ser utilizadas principalmente para:

- interpretação;
- explicação;
- síntese;
- geração de recomendações;
- interação conversacional.

Nunca depender de LLM para calcular métricas financeiras ou estatísticas básicas.

---

## 3.5 Human-in-the-loop

Ações que alterem dados ou interajam externamente devem poder exigir aprovação.

```text
Insight
   ↓
Recommendation
   ↓
Action Proposal
   ↓
User Approval
   ↓
Execution
```

---

# 4. Escopo da V0.1

## Incluído

### Identity

- Tenant
- User
- Membership
- Role

### Business Data

- Customer
- Lead
- Product
- Seller
- Sale
- SaleItem
- Activity

### Data Platform

- DataSource
- SyncJob
- RawRecord
- Import
- Mapping

### Intelligence

- Metric
- Insight
- Recommendation

### Conversation

- Conversation
- Message

### Execution

- Action
- ActionExecution
- Approval

### Security

- Credential
- AuditLog

---

# 5. Fora do escopo

Não implementar na V0.1:

- billing;
- subscription management;
- marketplace;
- mobile app;
- workflow builder;
- agent marketplace;
- autonomous agents;
- browser automation genérica;
- dezenas de connectors;
- fine-tuning;
- modelo de IA próprio;
- microservices;
- Kubernetes;
- event bus distribuído;
- sistema complexo de permissões.

---

# 6. Arquitetura

A arquitetura inicial deve ser um **modular monolith**.

```text
                    ┌──────────────────┐
                    │    Tactia Web    │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │    Tactia API    │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
     Identity            Business           Intelligence
     Module              Data Module         Module
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                             ▼
                       Data Platform
                             │
                  ┌──────────┴──────────┐
                  │                     │
                  ▼                     ▼
             PostgreSQL             Object Storage
```

---

# 7. Stack inicial

## Application

- TypeScript
- Node.js
- Next.js
- Fastify ou API Routes/Route Handlers

## Database

- PostgreSQL
- Prisma ORM

## Storage

- S3-compatible storage

Pode ser:

- Supabase Storage;
- AWS S3;
- outro provider compatível.

## Authentication

A implementação pode utilizar um provider externo inicialmente.

A camada de domínio não deve ficar acoplada ao provider.

---

# 8. Estrutura do projeto

Sugestão:

```text
tactia/
│
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── database/
│   ├── domain/
│   ├── connectors/
│   ├── intelligence/
│   ├── execution/
│   └── shared/
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
└── docker/
```

Caso a complexidade inicial seja baixa, `apps/api` e os packages podem começar dentro de um único projeto.

O princípio arquitetural é mais importante que a estrutura física.

---

# 9. Domain Model

## 9.1 Tenant

Representa uma empresa cliente.

```text
Tenant
- id
- name
- slug
- status
- timezone
- currency
- created_at
- updated_at
```

Status:

```text
active
suspended
deleted
```

---

# 10. User

Representa uma pessoa que utiliza a Tactia.

```text
User
- id
- external_auth_id
- name
- email
- avatar_url
- created_at
- updated_at
```

---

# 11. Membership

Relaciona usuário e empresa.

```text
Membership
- id
- tenant_id
- user_id
- role
- status
- created_at
```

Roles iniciais:

```text
owner
admin
member
viewer
```

---

# 12. Customer

Representa um cliente da empresa.

```text
Customer
- id
- tenant_id
- external_id
- name
- email
- phone
- document
- status
- metadata
- created_at
- updated_at
```

`external_id` identifica o registro no sistema de origem.

---

# 13. Lead

```text
Lead
- id
- tenant_id
- external_id
- customer_id
- name
- email
- phone
- source
- status
- score
- created_at
- updated_at
```

Status:

```text
new
contacted
qualified
proposal
won
lost
```

---

# 14. Product

```text
Product
- id
- tenant_id
- external_id
- name
- sku
- category
- cost
- price
- status
- metadata
- created_at
- updated_at
```

---

# 15. Seller

```text
Seller
- id
- tenant_id
- external_id
- user_id
- name
- email
- status
- created_at
- updated_at
```

---

# 16. Sale

```text
Sale
- id
- tenant_id
- external_id
- customer_id
- seller_id
- total_amount
- discount_amount
- currency
- status
- sold_at
- metadata
- created_at
- updated_at
```

Status:

```text
pending
confirmed
cancelled
refunded
```

---

# 17. SaleItem

```text
SaleItem
- id
- tenant_id
- sale_id
- product_id
- quantity
- unit_price
- discount_amount
- total_amount
```

---

# 18. Activity

Representa eventos operacionais.

```text
Activity
- id
- tenant_id
- type
- customer_id
- lead_id
- seller_id
- occurred_at
- metadata
- created_at
```

Tipos:

```text
call
email
meeting
message
note
task
proposal
status_change
```

---

# 19. DataSource

Representa uma origem de dados.

```text
DataSource
- id
- tenant_id
- type
- name
- status
- configuration
- credential_id
- last_sync_at
- created_at
- updated_at
```

Tipos iniciais:

```text
csv
xlsx
postgres
rest
google_sheets
```

---

# 20. Credential

Nunca armazenar credenciais em texto puro.

```text
Credential
- id
- tenant_id
- provider
- encrypted_data
- created_at
- updated_at
```

A aplicação deve descriptografar credenciais apenas no momento necessário.

---

# 21. SyncJob

Representa uma sincronização.

```text
SyncJob
- id
- tenant_id
- data_source_id
- status
- started_at
- finished_at
- records_read
- records_created
- records_updated
- records_failed
- error
```

Status:

```text
pending
running
completed
failed
cancelled
```

---

# 22. RawRecord

Armazena o dado original.

```text
RawRecord
- id
- tenant_id
- data_source_id
- sync_job_id
- external_id
- entity_type
- payload
- checksum
- created_at
```

Exemplo:

```json
{
  "codigo": "123",
  "cliente": "Empresa ABC",
  "valor": 4500,
  "vendedor": "João"
}
```

---

# 23. Mapping

Responsável por transformar dados externos em entidades Tactia.

```text
Mapping
- id
- tenant_id
- data_source_id
- source_entity
- target_entity
- configuration
- version
- active
- created_at
- updated_at
```

Exemplo:

```text
ERP.sales
      ↓
Tactia.Sale

ERP.client_id
      ↓
Sale.customer_id

ERP.total
      ↓
Sale.total_amount
```

---

# 24. Import

Representa uma operação de importação.

```text
Import
- id
- tenant_id
- data_source_id
- sync_job_id
- entity_type
- status
- total_records
- processed_records
- failed_records
```

---

# 25. Metric

Métricas devem ser definidas de maneira determinística.

```text
Metric
- id
- tenant_id
- key
- name
- description
- definition
- created_at
- updated_at
```

Exemplos:

```text
revenue
sales_count
average_ticket
conversion_rate
customer_count
active_customers
```

A definição pode ser representada por código ou configuração estruturada.

---

# 26. Insight

Representa algo relevante identificado pela Tactia.

```text
Insight
- id
- tenant_id
- type
- severity
- title
- description
- evidence
- status
- detected_at
- expires_at
- created_at
```

Tipos:

```text
performance
anomaly
problem
opportunity
trend
```

Severity:

```text
info
low
medium
high
critical
```

Exemplo:

```text
Type:
anomaly

Title:
Queda nas vendas

Description:
As vendas caíram 18% nas últimas três semanas.

Evidence:
- Revenue: -18%
- Product X: -32%
- Seller Y: -41%
```

---

# 27. Recommendation

Representa uma ação recomendada.

```text
Recommendation
- id
- tenant_id
- insight_id
- title
- description
- rationale
- priority
- status
- created_at
```

Status:

```text
pending
accepted
rejected
completed
dismissed
```

---

# 28. Conversation

Representa uma conversa entre usuário e Tactia.

```text
Conversation
- id
- tenant_id
- user_id
- title
- created_at
- updated_at
```

---

# 29. Message

```text
Message
- id
- conversation_id
- role
- content
- metadata
- created_at
```

Roles:

```text
user
assistant
system
tool
```

---

# 30. Action

Representa uma ação que a Tactia sabe executar.

```text
Action
- id
- tenant_id
- type
- name
- description
- configuration
- requires_approval
- enabled
```

Tipos iniciais:

```text
create_task
send_email
send_whatsapp
generate_report
```

---

# 31. ActionExecution

Registra cada execução.

```text
ActionExecution
- id
- tenant_id
- action_id
- requested_by
- status
- input
- output
- error
- started_at
- finished_at
```

Status:

```text
pending
awaiting_approval
approved
running
completed
failed
cancelled
```

---

# 32. Approval

```text
Approval
- id
- tenant_id
- action_execution_id
- requested_by
- approved_by
- status
- reason
- created_at
- resolved_at
```

Status:

```text
pending
approved
rejected
```

---

# 33. AuditLog

Toda operação relevante deve ser auditável.

```text
AuditLog
- id
- tenant_id
- user_id
- actor_type
- action
- entity_type
- entity_id
- metadata
- ip
- created_at
```

Exemplos:

```text
USER_CREATED
DATA_SOURCE_CREATED
SYNC_STARTED
SYNC_COMPLETED
INSIGHT_CREATED
RECOMMENDATION_ACCEPTED
ACTION_APPROVED
ACTION_EXECUTED
```

---

# 34. Tenant Isolation

Todo repository deve receber o tenant como contexto.

Evitar:

```ts
customerRepository.findById(id);
```

Preferir:

```ts
customerRepository.findById({
  tenantId,
  id,
});
```

Nunca confiar em `tenant_id` enviado pelo frontend.

O tenant deve ser derivado da sessão autenticada.

---

# 35. API

A API inicial deve ser organizada por domínio.

```text
/api/v1/auth

/api/v1/tenants
/api/v1/users
/api/v1/memberships

/api/v1/customers
/api/v1/leads
/api/v1/products
/api/v1/sales
/api/v1/sellers
/api/v1/activities

/api/v1/data-sources
/api/v1/sync-jobs
/api/v1/imports

/api/v1/metrics
/api/v1/insights
/api/v1/recommendations

/api/v1/conversations
/api/v1/messages

/api/v1/actions
/api/v1/action-executions
/api/v1/approvals

/api/v1/audit-logs
```

---

# 36. Connector Architecture

Connectors devem implementar uma interface comum.

```ts
interface Connector {
  testConnection(): Promise<ConnectionTestResult>;

  discover(): Promise<DiscoveryResult>;

  fetch(resource: string, options?: FetchOptions): Promise<RawRecord[]>;

  normalize(record: RawRecord, mapping: Mapping): Promise<NormalizedRecord>;

  sync(context: SyncContext): Promise<SyncResult>;
}
```

Exemplo:

```text
PostgresConnector
CSVConnector
RestConnector
GoogleSheetsConnector
```

---

# 37. Connector Lifecycle

```text
Create DataSource
       ↓
Test Connection
       ↓
Discover Resources
       ↓
Configure Mapping
       ↓
Preview Data
       ↓
Run Sync
       ↓
Store Raw Records
       ↓
Normalize
       ↓
Upsert Canonical Data
       ↓
Generate Metrics
       ↓
Generate Insights
```

---

# 38. Upsert Strategy

Entidades provenientes de sistemas externos devem utilizar:

```text
tenant_id
+
data_source_id
+
external_id
```

como referência de idempotência quando possível.

Uma sincronização executada duas vezes não deve criar registros duplicados.

---

# 39. Intelligence Pipeline

A primeira versão do pipeline:

```text
Normalized Data
       ↓
Metric Engine
       ↓
Metric Results
       ↓
Rule Engine
       ↓
Detected Events
       ↓
Insight Engine
       ↓
Insights
       ↓
Recommendation Engine
       ↓
Recommendations
```

---

# 40. Rule Engine

Inicialmente pode ser simples.

Exemplo:

```text
IF revenue_change < -15%
THEN create anomaly insight
```

Outro:

```text
IF lead.days_without_activity > 7
THEN create opportunity/problem insight
```

Outro:

```text
IF product.revenue_growth > 30%
THEN create performance insight
```

As regras devem ser determinísticas.

---

# 41. AI Layer

A IA recebe contexto estruturado.

Exemplo:

```json
{
  "company": {},
  "metrics": {},
  "insights": [],
  "evidence": []
}
```

A IA não deve receber acesso arbitrário ao banco.

O fluxo:

```text
User
 ↓
Orchestrator
 ↓
Context Builder
 ↓
Tools
 ↓
Structured Data
 ↓
LLM
 ↓
Validated Response
```

---

# 42. Tool Registry

Criar uma abstração para ferramentas:

```ts
interface Tool {
  name: string;
  description: string;
  inputSchema: unknown;

  execute(context: ToolContext, input: unknown): Promise<unknown>;
}
```

Ferramentas iniciais:

```text
get_revenue
get_sales
get_customers
get_leads
get_products
get_sellers
get_metrics
get_insights
```

---

# 43. AI Safety

Toda resposta da IA que apresentar números deve possuir uma fonte interna.

Exemplo:

```json
{
  "claim": "Revenue dropped 18%",
  "source": {
    "metric": "revenue",
    "period": "2026-08-01/2026-08-25"
  }
}
```

A UI poderá posteriormente apresentar:

> Receita caiu 18%
> Fonte: vendas registradas entre 01/08 e 25/08.

---

# 44. Execution Architecture

A Tactia não deve executar ações diretamente a partir de texto gerado pelo LLM.

Errado:

```text
LLM
 ↓
"Envie WhatsApp para João"
 ↓
WhatsApp
```

Correto:

```text
LLM
 ↓
Structured Action
 ↓
Validation
 ↓
Approval
 ↓
Execution Engine
 ↓
Connector
```

---

# 45. Action Contract

Exemplo:

```json
{
  "action": "create_task",
  "input": {
    "title": "Entrar em contato com cliente ABC",
    "assignee": "seller_123",
    "due_date": "2026-08-27"
  }
}
```

A Action Engine valida o schema antes de executar.

---

# 46. Background Jobs

Operações longas não devem bloquear requests HTTP.

Executar em background:

- sincronizações;
- importações;
- processamento de arquivos;
- geração de insights;
- geração de relatórios;
- ações externas.

Inicialmente pode ser utilizada uma fila simples baseada em PostgreSQL.

Redis/BullMQ pode ser introduzido quando houver necessidade real.

---

# 47. Observability

Toda operação importante deve possuir:

```text
request_id
tenant_id
user_id
operation
duration
status
error
```

Logs estruturados.

Exemplo:

```json
{
  "level": "info",
  "operation": "sync",
  "tenant_id": "tenant_123",
  "data_source_id": "source_456",
  "records": 1842,
  "duration_ms": 3821
}
```

---

# 48. Error Handling

Erros devem ser classificados.

```text
VALIDATION_ERROR
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
NOT_FOUND
CONFLICT
CONNECTOR_ERROR
SYNC_ERROR
AI_ERROR
ACTION_ERROR
INTERNAL_ERROR
```

Não expor stack traces ao usuário.

---

# 49. Security Requirements

Obrigatório:

- passwords nunca armazenadas pela aplicação em plaintext;
- credentials criptografadas;
- isolamento por tenant;
- validação de input;
- autorização server-side;
- audit log;
- rate limiting básico;
- secrets exclusivamente em environment variables/secrets manager;
- nenhuma API key hardcoded.

---

# 50. Database Requirements

Todas as tabelas devem possuir:

```text
id
created_at
updated_at
```

quando aplicável.

IDs preferencialmente:

```text
UUID
```

Índices obrigatórios para:

```text
tenant_id
external_id
created_at
status
```

e combinações utilizadas frequentemente.

---

# 51. Soft Delete

Entidades importantes podem utilizar:

```text
deleted_at
```

em vez de hard delete.

Especialmente:

- Customer
- Product
- Seller
- DataSource
- User/Membership

Logs e dados históricos não devem ser removidos automaticamente.

---

# 52. API Idempotency

Operações externas e potencialmente duplicáveis devem suportar:

```text
Idempotency-Key
```

Principalmente:

- actions;
- imports;
- syncs;
- webhooks.

---

# 53. Webhooks

Criar infraestrutura básica para receber eventos externos:

```text
POST /api/v1/webhooks/:provider/:source
```

Fluxo:

```text
Webhook
 ↓
Validate
 ↓
Store Raw Event
 ↓
Queue
 ↓
Process
 ↓
Update Canonical Model
```

---

# 54. Admin / Internal Operations

A Tactia precisa de uma interface interna mínima para o founder/operator.

Deve permitir:

```text
Listar tenants
Ver tenant
Ver usuários
Ver data sources
Executar sync
Ver erros
Ver logs
Ver insights
Reprocessar import
```

Essa interface é extremamente importante durante a fase inicial.

---

# 55. Customer Onboarding

O onboarding inicial:

```text
1. Criar empresa

2. Criar usuário owner

3. Configurar fonte de dados

4. Testar conexão

5. Descobrir entidades

6. Configurar mapping

7. Importar dados

8. Validar dados

9. Calcular métricas

10. Gerar primeiros insights
```

O onboarding deve apresentar claramente:

```text
✓ 1.842 clientes importados
✓ 8.421 vendas importadas
✓ 42 vendedores encontrados
✓ R$ 1.284.000 em vendas analisadas
```

---

# 56. Data Quality

Após cada importação, executar validações.

Exemplos:

```text
Customers without name
Sales without customer
Sales with negative amount
Products without price
Duplicated external IDs
Invalid dates
Missing seller
```

Gerar:

```text
DataQualityReport
```

com:

```text
total_records
valid_records
invalid_records
warnings
errors
```

---

# 57. First Dashboard

O dashboard V0.1 deve conter apenas:

### Overview

```text
Revenue
Sales
Customers
Average Ticket
```

### Trends

```text
Revenue over time
Sales over time
```

### Insights

```text
Critical
High
Medium
```

### Recommendations

```text
Pending recommendations
```

Não construir um BI completo.

---

# 58. First Chat

O chat deve suportar perguntas como:

```text
Quanto vendemos este mês?

Qual foi nosso melhor produto?

Quem mais vendeu?

Por que nossas vendas caíram?

Quais clientes estão comprando menos?

O que devo priorizar hoje?
```

O sistema deve responder utilizando ferramentas internas.

---

# 59. Definition of Done

A V0.1 será considerada pronta quando:

### Tenant

- [ ] É possível criar uma empresa.
- [ ] É possível criar usuários.
- [ ] Dados são isolados por tenant.

### Data

- [ ] É possível importar CSV.
- [ ] É possível conectar PostgreSQL.
- [ ] Dados raw são preservados.
- [ ] Dados são normalizados.
- [ ] Sync é idempotente.

### Intelligence

- [ ] Métricas básicas funcionam.
- [ ] Regras detectam anomalias.
- [ ] Insights são persistidos.
- [ ] Recomendações são persistidas.

### AI

- [ ] Chat consulta dados reais.
- [ ] IA não acessa banco diretamente.
- [ ] Números possuem evidência.
- [ ] Respostas são contextualizadas por tenant.

### Execution

- [ ] É possível criar uma ação.
- [ ] Ação pode exigir aprovação.
- [ ] Execução é registrada.
- [ ] Falhas são registradas.

### Operations

- [ ] Existem audit logs.
- [ ] Existem logs estruturados.
- [ ] Existe painel administrativo.
- [ ] Erros podem ser diagnosticados.

---

# 60. Ordem de implementação

A implementação deve seguir esta ordem.

## Sprint 1 — Foundation

```text
Repository
Docker
PostgreSQL
Prisma
Authentication
Tenant
User
Membership
Authorization
AuditLog
```

---

## Sprint 2 — Canonical Data Model

```text
Customer
Lead
Product
Seller
Sale
SaleItem
Activity
```

Implementar:

- repositories;
- services;
- CRUD;
- indexes;
- tenant isolation.

---

## Sprint 3 — Data Platform

```text
DataSource
Credential
SyncJob
RawRecord
Import
Mapping
```

Implementar:

- connector interface;
- CSV connector;
- PostgreSQL connector;
- sync engine;
- normalization;
- idempotency.

---

## Sprint 4 — Analytics

Implementar:

```text
Metric Engine
```

Primeiras métricas:

```text
Revenue
Sales Count
Average Ticket
Customer Count
Sales Growth
Revenue Growth
```

---

## Sprint 5 — Intelligence

Implementar:

```text
Rule Engine
Insight Engine
Recommendation Engine
```

Primeiras regras:

```text
Revenue drop
Revenue growth
Product growth
Product decline
Inactive leads
Inactive customers
Seller performance deviation
```

---

## Sprint 6 — AI

Implementar:

```text
Tool Registry
Context Builder
LLM Adapter
Conversation
Message
Orchestrator
```

Primeiras tools:

```text
get_revenue
get_sales
get_customers
get_products
get_sellers
get_insights
```

---

## Sprint 7 — Execution

Implementar:

```text
Action
ActionExecution
Approval
Execution Engine
```

Primeira ação:

```text
create_task
```

Depois:

```text
send_email
```

---

## Sprint 8 — Customer Pilot

Colocar **1–3 clientes reais**.

Durante essa fase:

```text
Customer feedback
       ↓
Observe friction
       ↓
Identify repeated pattern
       ↓
Productize
       ↓
Automate
```

---

# 61. Critério estratégico para novas features

Antes de implementar qualquer funcionalidade, perguntar:

### 1.

Isso ajuda a Tactia a **entender**?

### 2.

Isso ajuda a Tactia a **decidir**?

### 3.

Isso ajuda a Tactia a **executar**?

Se a resposta for "não" para os três:

> **Não construir agora.**

---

# 62. Prioridade máxima

A prioridade técnica não é:

> construir a plataforma mais sofisticada.

É:

> **conseguir conectar uma empresa real e transformar seus dados em decisões úteis.**

Portanto a ordem de valor é:

```text
DATA
 ↓
CONTEXT
 ↓
INSIGHT
 ↓
RECOMMENDATION
 ↓
ACTION
```

Não inverter essa ordem.

---

# 63. Arquitetura futura

A V0.1 deve permitir evoluir posteriormente para:

```text
                    TACTIA
                       │
          ┌────────────┼────────────┐
          │            │            │
       DATA          BRAIN       ACTIONS
          │            │            │
     Connectors     Agents      Executors
          │            │            │
     ┌────┴────┐   ┌───┴────┐   ┌──┴─────┐
     │         │   │        │   │        │
    ERP      CRM  Analyst  Planner CRM  WhatsApp
```

Mas essa arquitetura **não deve ser implementada na V0.1**.

O Core deve apenas fornecer as interfaces necessárias para chegar nela.

---

# 64. Resultado esperado

Ao finalizar a V0.1, devemos conseguir demonstrar:

```text
Empresa ABC
     │
     ├── ERP
     │
     ▼
Tactia Connector
     │
     ▼
Canonical Data
     │
     ├── R$ 1.2M revenue
     ├── 8.421 sales
     ├── 1.842 customers
     └── 42 sellers
              │
              ▼
       Intelligence Engine
              │
              ├── 🔴 Revenue -18%
              ├── 🟡 27 inactive leads
              └── 🟢 Product X +32%
                       │
                       ▼
                 Recommendations
                       │
                       ▼
                    Actions
```

O usuário final não precisa conhecer essa arquitetura.

Para ele, a experiência deve ser simplesmente:

> **Tactia sabe o que está acontecendo na minha empresa, me explica por quê, me diz o que fazer e, quando autorizado, faz por mim.**

---

# 65. Princípio final

A primeira versão da Tactia não deve tentar ser um "AI employee".

Ela deve ser uma **camada de inteligência sobre os sistemas que a empresa já possui**.

O objetivo da primeira versão é criar o ciclo:

**Connect → Understand → Explain → Recommend → Execute → Learn**

Esse ciclo, repetido com clientes reais, será a base para transformar o Core em uma plataforma de agentes e automação empresarial no futuro.
