# Etapa 2 — Canonical Data Model

**Status:** concluída
**Data:** 2026-08-29
**Depende de:** [Etapa 1](./etapa-1.md)

## Entregue

### Modelo e persistência

- Prisma + migration `20260829160000_canonical_data_model`: `Customer`, `Lead`, `Product`, `Seller`, `Sale`, `SaleItem`, `Activity`.
- Enums de status/tipo conforme spec (§12–18); status de Customer/Product/Seller definidos para V0.1 (`active`/`inactive`/…).
- Soft delete (`deleted_at`) em Customer, Product e Seller.
- Campo opcional `data_source_id` + constraint única `(tenant_id, data_source_id, external_id)` nas entidades com `external_id` (prep. Etapa 3 / upsert §38). Sem FK para `DataSource` (modelo chega na Etapa 3).
- Índices em `tenant_id`, `external_id`, `created_at`, `status`, `sold_at` e FKs frequentes.
- Valores monetários em `Decimal(18, 4)`; API serializa como `number`.

### Repositories e services

| Entidade | Repository | Service | Soft delete |
|---|---|---|---|
| Customer | `CustomerRepository` | `CustomerService` | sim |
| Lead | `LeadRepository` | `LeadService` | hard delete |
| Product | `ProductRepository` | `ProductService` | sim |
| Seller | `SellerRepository` | `SellerService` | sim |
| Sale (+ items) | `SaleRepository` | `SaleService` | hard delete (cascade items) |
| Activity | `ActivityRepository` | `ActivityService` | hard delete |

- Validação Zod em `packages/domain/src/schemas/business.ts`.
- Todo repository exige `tenantId`; FKs cross-tenant rejeitadas com `NOT_FOUND`.
- Mutações exigem role ≥ `member`; listagem/leitura disponível para `viewer`.

### Rotas

| Método | Rota | Auth |
|---|---|---|
| GET/POST | `/api/v1/customers` | tenant; POST member+ |
| GET/PATCH/DELETE | `/api/v1/customers/:id` | tenant; mutação member+ |
| GET/POST | `/api/v1/leads` | idem |
| GET/PATCH/DELETE | `/api/v1/leads/:id` | idem |
| GET/POST | `/api/v1/products` | idem |
| GET/PATCH/DELETE | `/api/v1/products/:id` | idem |
| GET/POST | `/api/v1/sellers` | idem |
| GET/PATCH/DELETE | `/api/v1/sellers/:id` | idem |
| GET/POST | `/api/v1/sales` | idem (POST com `items[]`) |
| GET/PATCH/DELETE | `/api/v1/sales/:id` | idem |
| GET/POST | `/api/v1/activities` | idem |
| GET/PATCH/DELETE | `/api/v1/activities/:id` | idem |

Paginação (`page`, `pageSize`), filtro por `status`/`type` e busca simples (`search`) onde aplicável.

### Auditoria

`CUSTOMER_*`, `LEAD_*`, `PRODUCT_*`, `SELLER_*`, `SALE_*`, `ACTIVITY_*` (`CREATED` / `UPDATED` / `DELETED`).

### Seed

`pnpm db:seed` popula a Empresa Demo com:

- ~200 customers, ~50 products, ~10 sellers, ~30 leads
- ~900+ sales nos últimos 6 meses
- **Queda de receita proposital** nas últimas ~3 semanas (volume e ticket reduzidos) para as Etapas 4–5
- Leads sem activity recente (>7 dias) para regras de `inactive_leads`

### Testes

Integração em Postgres (`tactia_test`):

- CRUD completo das 7 entidades + audit logs
- Isolamento: tenant B recebe `NOT_FOUND` ao acessar recursos do tenant A; create de sale com FK alienígena falha
- Viewer recebe `AUTHORIZATION_ERROR` em mutações

`pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` passam.

## Decisões

- Status de Customer (`active`/`inactive`/`blocked`) e Product (`active`/`inactive`/`discontinued`) não estavam enumerados na spec; escolhidos valores mínimos para V0.1.
- `data_source_id` nullable sem tabela `DataSource` — a constraint única já prepara o upsert da Etapa 3; múltiplos `NULL` são permitidos pelo Postgres (seed/CRUD manual).
- Sale create calcula `totalAmount` a partir dos itens quando omitido; items aninhados na resposta.
- Lead/Sale/Activity usam hard delete (dados históricos / não listados em soft delete §51).

## Como testar manualmente

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm db:migrate:deploy
pnpm db:seed          # owner@demo.tactia / password123
pnpm dev
```

1. Login em http://localhost:3000/login.
2. `GET /api/v1/customers?page=1&pageSize=20` e `GET /api/v1/sales?status=confirmed`.
3. `POST /api/v1/customers` com `{ "name": "Novo Cliente" }` → 201 + audit.
4. Criar product + sale com `items` → conferir `totalAmount` e items na resposta.
5. Com segundo tenant, tentar `GET /api/v1/customers/:idDoTenantA` → `NOT_FOUND`.

Isolamento/CRUD automatizado:

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm --filter @tactia/database migrate:deploy
pnpm --filter @tactia/domain test
```

## Pendências (próximas etapas)

- `DataSource` + sync/upsert idempotente (Etapa 3).
- Metric Engine sobre o seed (Etapa 4) — anomalia de receita já embutida.
- UI de listagem/CRUD das entidades canônicas (Etapa 8).
