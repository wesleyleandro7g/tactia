# Tactia

Camada de inteligência operacional para empresas. **Entenda. Decida. Execute.**

## Stack (V0.1)

- pnpm workspaces + Turborepo
- Next.js (App Router) em `apps/web` — UI e `/api/v1/*`
- PostgreSQL 16 + Prisma
- Better Auth (email/senha), desacoplado do domínio via `external_auth_id`
- MinIO (S3-compatible) para etapas futuras

## Setup

```bash
cp .env.example .env
# preencha BETTER_AUTH_SECRET (mín. 32 chars) e ENCRYPTION_KEY (64 hex)

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
packages/connectors   (Etapa 3)
packages/intelligence (Etapas 4–5)
packages/execution    (Etapa 7)
packages/ai           (Etapa 6)
```
