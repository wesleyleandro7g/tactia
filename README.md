# Tactia

Camada de inteligência operacional para empresas. **Entenda. Decida. Execute.**

## Stack (V0.1)

- pnpm workspaces + Turborepo
- Next.js (App Router) em `apps/web` — UI e `/api/v1/*`
- PostgreSQL 16 + Prisma
- Better Auth (email/senha), desacoplado do domínio via `external_auth_id`
- Vercel AI SDK atrás de um `LLMAdapter` próprio (provider e modelo via env)
- UI em Next.js App Router com Tailwind v4 (Server Components para leitura, `/api/v1/*` para escrita)
- MinIO (S3-compatible) para etapas futuras

## Telas

| Rota | O que faz |
|---|---|
| `/dashboard` | Receita, vendas, clientes e ticket médio; séries no tempo; insights por severidade; recomendações pendentes |
| `/onboarding` | Wizard empresa → fonte → conexão → descoberta → mapeamento → prévia → importação |
| `/chat` | Conversa com a Tactia com streaming, fonte de cada número e proposta de ação |
| `/approvals` | Fila de aprovações e execuções recentes |
| `/admin` | Painel interno do operador (allowlist `TACTIA_OPERATOR_EMAILS`) |

## Setup

```bash
cp .env.example .env
# preencha BETTER_AUTH_SECRET (mín. 32 chars) e ENCRYPTION_KEY (64 hex)
# para o chat: LLM_API_KEY (ou LLM_PROVIDER=mock)
# para o painel /admin: TACTIA_OPERATOR_EMAILS=seu@email

PostgreSQL local usa a porta **5433** (5432 costuma estar ocupada). MinIO: 9000.
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed   # opcional: owner@demo.tactia / password123
pnpm dev
```

App: http://localhost:3000

## Scripts

| Comando | Efeito |
|---|---|
| `pnpm dev` | Next.js em modo desenvolvimento |
| `pnpm test` | Vitest (unit + integração) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | Build do monorepo |

## Testes de integração

Os testes de isolamento entre tenants usam o banco `tactia_test` (criado pelo init do Docker).

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm db:migrate:deploy
pnpm test
```

## Estrutura

```text
apps/web              Next.js (UI + route handlers)
packages/database     Prisma, client, repositories
packages/domain       Services, autorização, portas
packages/shared       Erros, logger, UUID v7, helpers de API
packages/connectors     CSV/Postgres connectors, normalização, data quality
packages/intelligence   Metric engine, rules, insights, recommendations
packages/execution      Action registry, execution engine, approvals
packages/ai             Tool registry, context builder, LLM adapter, orchestrator
```
