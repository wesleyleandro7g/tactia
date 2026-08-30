# Etapa 4 — Metric Engine

**Status:** concluída  
**Data:** 2026-08-30  
**Depende de:** [Etapa 2](./etapa-2.md)

## Entregue

### Modelo e persistência

Migration `20260830100000_metric_engine` adiciona:

| Modelo | Descrição |
|---|---|
| `Metric` | Armazena definições de métricas por tenant (`key` único por tenant, `definition` JSON) |

Índice e constraint: `@@unique([tenantId, key])` + `@@index([tenantId])`.

### packages/intelligence

Novo pacote ativado com dependências `@tactia/database` e `@tactia/shared`.

| Arquivo | Descrição |
|---|---|
| `src/types.ts` | Tipos `MetricPeriod`, `MetricResult`, `MetricInput`, `MetricBreakdownItem`, `PeriodGranularity`, `METRIC_KEYS`, `METRIC_DEFINITIONS` |
| `src/metric-engine.ts` | `MetricEngine` — cálculo determinístico das 6 métricas + breakdowns |

#### Métricas implementadas (V0.1)

| Key | Fórmula |
|---|---|
| `revenue` | `SUM(totalAmount)` de vendas `confirmed` no período |
| `sales_count` | `COUNT(*)` de vendas `confirmed` no período |
| `average_ticket` | `revenue / sales_count` (0 se sem vendas) |
| `customer_count` | Clientes distintos com ao menos 1 venda `confirmed` no período |
| `sales_growth` | `(sales_count_atual − sales_count_anterior) / sales_count_anterior` |
| `revenue_growth` | `(revenue_atual − revenue_anterior) / revenue_anterior` |

Regras de exclusão: vendas com `status = 'cancelled'` ou `'refunded'` são **sempre** excluídas de todos os cálculos.

#### Breakdowns suportados

| Dimensão | Descrição |
|---|---|
| `product` | Receita agrupada por produto (via `SaleItem`) |
| `seller` | Receita agrupada por vendedor |
| `time` | Receita agrupada por `day` / `week` / `month` (via `date_trunc` SQL) |

#### Período de comparação

Ao passar `withComparison: true`, o engine calcula automaticamente o período anterior de mesma duração e retorna o bloco `comparison { value, period, change, direction }` no `MetricResult`.

### packages/database

- `MetricRepository` — `upsert`, `findByKey`, `listByTenant`.

### packages/domain

- `MetricService` — wraps `MetricEngine` com validação Zod, autenticação de contexto e helpers para cálculo bulk via query params.

### Rotas API

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/metrics` | tenant | Calcula todas as métricas (ou só `mode=definitions`) |
| `POST` | `/api/v1/metrics/:key/calculate` | tenant | Calcula uma métrica com opções completas |

**Query params de `/api/v1/metrics`:**

| Param | Descrição |
|---|---|
| `from`, `to` | Período ISO (padrão: mês corrente) |
| `withComparison` | `"true"` para incluir bloco de comparação |
| `breakdownDimension` | `product` \| `seller` \| `time` |
| `breakdownGranularity` | `day` \| `week` \| `month` |
| `keys` | Métricas separadas por vírgula (padrão: todas) |
| `mode=definitions` | Retorna apenas as definições, sem calcular |

### Testes

`packages/intelligence/src/__tests__/metric-engine.test.ts` — **13 testes** em Postgres real com dataset fixo:

- Receita correta excluindo vendas canceladas
- Período vazio retorna 0
- `sales_count` conta apenas `confirmed`
- `average_ticket` = revenue / count; 0 sem vendas
- `customer_count` distintos corretos
- `revenue_growth` fracional exato (+75%)
- `sales_growth` fracional exato (+100%)
- Bloco `comparison` com valores e direção corretos
- Breakdown por vendedor com valor exato
- Breakdown por produto com valor exato
- `calculateAll` retorna as 6 métricas
- Isolamento: outro tenant retorna 0

**Total acumulado: 26 testes passando** (13 intelligence + 13 domain).

## Decisões

- **`MetricEngine` em `packages/intelligence`** aceita `PrismaClient` diretamente — métricas precisam de `aggregate`, `groupBy` e `$queryRaw` que seriam verbose de expor via repositories.
- **Período de comparação** calculado como o intervalo imediatamente anterior de mesma duração (não mês anterior fixo), compatível com qualquer granularidade de período.
- **`breakdownByTime`** usa `$queryRaw` + `date_trunc` para agrupar por dia/semana/mês sem materializar todos os registros em memória.
- **Definições** são built-in; o modelo `Metric` existe para permitir que etapas futuras armazenem thresholds customizados por tenant (spec §25).
- **`sales_growth` e `revenue_growth`** retornam o valor fracional (0.75 = +75%) — a IA e o dashboard convertem para exibição.

## Como testar manualmente

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm db:migrate:deploy
pnpm db:seed          # owner@demo.tactia / password123
pnpm dev
```

```bash
# Login → obter cookie de sessão + tenant

# Todas as métricas do mês corrente
GET /api/v1/metrics

# Métricas de Jan/2025 com comparação vs Dez/2024
GET /api/v1/metrics?from=2025-01-01&to=2025-02-01&withComparison=true

# Receita por vendedor
GET /api/v1/metrics?keys=revenue&breakdownDimension=seller

# Receita diária de uma semana
GET /api/v1/metrics?keys=revenue&from=2025-01-01&to=2025-01-08&breakdownDimension=time&breakdownGranularity=day

# Calcular uma métrica específica via POST
POST /api/v1/metrics/revenue/calculate
{ "period": { "from": "2025-01-01", "to": "2025-02-01" }, "withComparison": true }
```

Testes automatizados:

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm --filter @tactia/intelligence test
```

## Pendências (próximas etapas)

- `MetricResult` é o formato de "evidência citável" pela IA (spec §43) — Etapa 6 consumirá o engine diretamente pelas tools.
- Intelligence Engine (regras, insights, recomendações) consome o `MetricEngine` na Etapa 5.
- Dashboard (Etapa 8) exibirá os 4 cards e gráficos via `/api/v1/metrics`.
