# Etapa 5 — Intelligence (Rules, Insights, Recommendations)

**Status:** concluída  
**Data:** 2026-08-30  
**Depende de:** [Etapa 4](./etapa-4.md)

## Entregue

### Modelo e persistência

Migration `20260830200000_intelligence` adiciona:

| Modelo | Descrição |
|---|---|
| `Insight` | Insight persistido: tipo, severidade, status, evidência (MetricResults), período |
| `Recommendation` | Recomendação vinculada a um insight: prioridade, status, tipo de ação |

Novos enums: `InsightType` (`anomaly`, `performance`, `opportunity`, `warning`), `InsightSeverity` (`low`, `medium`, `high`, `critical`), `InsightStatus` (`open`, `acknowledged`, `resolved`, `dismissed`), `RecommendationPriority`, `RecommendationStatus`.

Índices: `(tenantId, status)`, `(tenantId, createdAt)`, `(tenantId, ruleKey, status)` em insights; `(tenantId, status)`, `(insightId)` em recommendations.

### packages/intelligence

| Arquivo | Descrição |
|---|---|
| `src/rule-engine.ts` | `RuleEngine` com 6 regras determinísticas |
| `src/insight-engine.ts` | `InsightEngine` — persiste eventos, deduplicação por `(ruleKey, periodFrom, periodTo)` |
| `src/recommendation-engine.ts` | `RecommendationEngine` — templates determinísticos por tipo de regra |

#### Regras da V0.1

| Regra | Condição | Tipo | Severidade |
|---|---|---|---|
| `revenue_drop` | `revenue_growth < -15%` | `anomaly` | `high`/`critical` (≥30%) |
| `revenue_growth` | `revenue_growth > 15%` | `performance` | `medium` |
| `product_growth` | Produto com receita +20% vs período anterior | `performance` | `medium` |
| `product_decline` | Produto com receita -20% vs período anterior | `warning` | `medium` |
| `inactive_leads` | Leads ativos sem atividade há > 7 dias | `opportunity` | `medium`/`high` (≥10) |
| `inactive_customers` | Clientes ativos sem compra há > 30 dias | `opportunity` | `medium`/`high` (≥20) |
| `seller_performance_deviation` | Vendedor com receita ≥40% abaixo da média | `warning` | `medium` |

Thresholds configuráveis via `TenantThresholds` (defaults em `DEFAULT_THRESHOLDS`).

#### Templates de recomendação

Cada regra tem um template deterministico (`TEMPLATES` no `RecommendationEngine`) que gera título, descrição e `actionType` (ex: `create_task`, `send_email`, `review_revenue`).

### packages/domain

| Service | Descrição |
|---|---|
| `InsightService` | Listar insights, obter por ID, atualizar status |
| `RecommendationService` | Listar, accept/reject/dismiss (com audit `RECOMMENDATION_ACCEPTED`) |
| `IntelligencePipelineService` | Orquestra `RuleEngine → InsightEngine → RecommendationEngine`; aceita período e thresholds customizáveis |

`AuditAction` atualizado: `INSIGHT_CREATED`, `RECOMMENDATION_ACCEPTED`.

### Rotas API

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/insights` | tenant | Listar insights (filtro: `status`, `page`, `pageSize`) |
| `POST` | `/api/v1/insights` | tenant member+ | Disparar pipeline on-demand |
| `GET` | `/api/v1/insights/:id` | tenant | Obter insight + recommendations |
| `PATCH` | `/api/v1/insights/:id` | tenant | Atualizar status |
| `GET` | `/api/v1/recommendations` | tenant | Listar recomendações |
| `GET` | `/api/v1/recommendations/:id` | tenant | Obter recomendação |
| `POST` | `/api/v1/recommendations/:id/accept` | tenant | Aceitar |
| `POST` | `/api/v1/recommendations/:id/reject` | tenant | Rejeitar |
| `POST` | `/api/v1/recommendations/:id/dismiss` | tenant | Dispensar |

### Testes

`packages/intelligence/src/__tests__/intelligence-pipeline.test.ts` — **9 testes** em Postgres real:

- `RuleEngine` detecta `revenue_drop` com queda de 90% (dataset: 1000 em dez/2024 → 100 em jan/2025)
- `RuleEngine` detecta `inactive_leads` (lead sem atividade)
- `RuleEngine` não vaza eventos entre tenants
- `InsightEngine` cria insight na primeira execução
- `InsightEngine` não cria duplicatas na segunda execução (deduplicação confirmada)
- Evidence contém `MetricResult` com `key = "revenue_growth"`
- `RecommendationEngine` gera recomendações para insights criados
- `RecommendationEngine` não duplica recomendações pendentes
- Recomendação de `revenue_drop` tem `priority = "high"`

**Total acumulado: 35 testes passando** (22 intelligence + 13 domain).

`pnpm lint`, `pnpm typecheck`, `pnpm test` passam.

## Decisões

- **`IntelligencePipelineService` em `packages/domain`** recebe `PrismaClient` diretamente, seguindo o padrão do `MetricEngine` (spec §3.4: determinístico antes de IA).
- **Deduplicação** por `(tenantId, ruleKey, periodFrom, periodTo)` + status `open|acknowledged` — insight `resolved`/`dismissed` pode ser recriado numa execução futura com o mesmo período se a condição reaparecer.
- **Pipeline on-demand** via `POST /api/v1/insights` — integração com pg-boss após sync fica na `apps/web` como adapter externo (sem alterar o domínio), seguindo a decisão da Etapa 3.
- **Regras `product_growth/decline` e `seller_performance_deviation`** requerem ao menos 2 produtos/vendedores com dados no período anterior; sem dados históricos não disparam (sem falsos positivos).
- **`vitest.config.ts`** adicionado a `packages/intelligence` com `singleFork: true` para evitar conflito de cleanup entre arquivos de teste no mesmo pacote.
- **Cleanups escopados** em `canonical-data.test.ts`, `tenant-isolation.test.ts` e nos novos testes de intelligence — uso de slug-based filter em vez de `deleteMany()` global para suportar execução paralela entre pacotes no Turborepo.

## Como testar manualmente

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm db:migrate:deploy
pnpm db:seed          # owner@demo.tactia / password123
pnpm dev
```

1. Login em http://localhost:3000/login.
2. Disparar pipeline: `POST /api/v1/insights` (body opcional: `{ "periodFrom": "2026-08-01", "periodTo": "2026-08-31" }`)
3. `GET /api/v1/insights` → ver insights gerados (espera `revenue_drop` do seed)
4. `GET /api/v1/recommendations` → ver recomendações criadas
5. `POST /api/v1/recommendations/:id/accept` → aceitar; verificar audit log em `/api/v1/audit-logs`
6. Disparar pipeline novamente → nenhum novo insight duplicado

Testes automatizados:

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm --filter @tactia/intelligence test
```

## Pendências (próximas etapas)

- Integração pg-boss: disparar pipeline automaticamente após `SYNC_COMPLETED` (worker em `apps/web`).
- Chat AI (Etapa 6) consumirá insights via tool `get_insights` — `InsightEngine` + pipeline já prontos para uso.
- Dashboard (Etapa 8) listará insights por severidade e recomendações pendentes.
