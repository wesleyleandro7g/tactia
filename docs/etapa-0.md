# Etapa 0 — Scaffolding do Monorepo

**Status:** concluída (pré-requisito da Etapa 1)
**Data:** 2026-08-26

## Entregue

- Monorepo pnpm + Turborepo (`apps/web`, `packages/*`).
- `docker/docker-compose.yml` com PostgreSQL 16 (porta local **5433**) e MinIO.
- `packages/database` com Prisma 6, client gerado em `src/generated`, migrations versionadas.
- `packages/shared`: logger Pino, `AppError` + códigos da spec §48, helper de API, UUID v7.
- Pacotes stub compiláveis: `connectors`, `intelligence`, `execution`, `ai`.
- ESLint (flat config) + Prettier + `tsconfig.base.json` strict.
- `.env.example`, README, CI GitHub Actions (lint, typecheck, test, build).
- `pnpm-workspace.yaml` com `allowBuilds` para Prisma/esbuild (pnpm 11).

## Decisões

- Postgres local em `5433` porque `5432` já estava ocupada neste ambiente. CI continua em `5432`.
- Prisma 6.19 (client clássico) em vez de Prisma 7, para evitar driver adapter nesta etapa.
- Pacotes exportam TypeScript-fonte; Next.js transpila via `transpilePackages`.

## Como testar

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm install
pnpm db:generate
pnpm db:migrate:deploy
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
