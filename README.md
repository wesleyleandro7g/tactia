# Tactia

Camada de inteligência operacional para empresas. **Entenda. Decida. Execute.**

## Stack (V0.1)

- pnpm workspaces + Turborepo
- Next.js (App Router) em `apps/web` — UI e `/api/v1/*` do produto
- Next.js em `apps/admin` (porta 3001) — backoffice Tactia Ops
- PostgreSQL 16 + Prisma
- Better Auth (email/senha), desacoplado do domínio via `external_auth_id`
- Vercel AI SDK atrás de um `LLMAdapter` próprio (provider e modelo via env)
- UI em Next.js App Router com Tailwind v4 (Server Components para leitura, `/api/v1/*` para escrita)
- MinIO (S3-compatible) para etapas futuras

## Telas

| Rota | O que faz |
|---|---|
| `/dashboard` | Receita, vendas, clientes e ticket médio; séries no tempo; insights por severidade; recomendações pendentes |
| `/signup` | Captação de leads e agendamento opcional de consultoria gratuita |
| `/onboarding` | Orientação para usuários que aguardam liberação do acesso pela equipe |
| `/chat` | Conversa com a Tactia com streaming, fonte de cada número e proposta de ação |
| `/approvals` | Fila de aprovações e execuções recentes |

Backoffice (`apps/admin`, http://localhost:3001): login de operador, **leads** (`/leads`, atendimento e conversão em cliente), empresas, usuários, **fontes de dados** (conexão, mapeamento, sync) e audit. Identidade separada do app dos clientes. Novas empresas e acessos são criados exclusivamente pelo Ops.

## Setup

```bash
cp .env.example .env
# preencha BETTER_AUTH_SECRET (mín. 32 chars) e ENCRYPTION_KEY (64 hex)
# para o chat: LLM_API_KEY (ou LLM_PROVIDER=mock)
# para o backoffice: ADMIN_AUTH_SECRET (mín. 32 chars) e TACTIA_BOOTSTRAP_OPERATOR_*
# depois: pnpm --filter @tactia/admin seed

PostgreSQL local usa a porta **5433** (5432 costuma estar ocupada). MinIO: 9000.
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed   # opcional: owner@demo.tactia / password123
pnpm dev
```

App: http://localhost:3000
Ops: http://localhost:3001

O Next do Ops lê `apps/admin/.env.local` (não o `.env` da raiz). Copie `DATABASE_URL`, `ENCRYPTION_KEY` e as variáveis `ADMIN_*`.

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

O E2E do fluxo completo (empresa → fonte → import → métricas → insight → ação →
execução) está em `apps/web/src/__tests__/pilot-flow.test.ts`.

## Deploy

```bash
cp .env.example .env.production   # preencha os valores reais
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
curl -s http://localhost:3000/api/v1/health   # {"data":{"status":"ok","database":"up"}}
```

Sobe `postgres` → `migrate` (`prisma migrate deploy`) → `web` (Next standalone)
e `admin` (Tactia Ops). Publique as portas 3000 (produto) e 3001 (backoffice)
atrás de um proxy com TLS. Guia completo: [docs/deploy-producao.md](docs/deploy-producao.md).

## Operação

| Documento | Para quê |
|---|---|
| [docs/deploy-producao.md](docs/deploy-producao.md) | Deploy em produção com Docker Compose e TLS |
| [docs/onboarding-cliente.md](docs/onboarding-cliente.md) | Passo a passo para colocar um cliente real |
| [docs/runbook.md](docs/runbook.md) | Diagnóstico de sync, chat, segredos, backup e deploy |
| [docs/integrations/torge/operations.md](docs/integrations/torge/operations.md) | Implantação, workflows, segurança e operação Torge/Figranium |
| [docs/integrations/torge/acceptance-report.md](docs/integrations/torge/acceptance-report.md) | Cobertura, evidências, bloqueios e estado de produção |
| [docs/integracao-chatgpt-mcp.md](docs/integracao-chatgpt-mcp.md) | OAuth 2.1, deploy e publicação do app MCP no ChatGPT |

Logs são JSON estruturado com `request_id`, `tenant_id`, `user_id`, `operation`,
`duration_ms` e `status`. Toda resposta traz o header `x-request-id`, que é a chave
para achar a linha correspondente no log.

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
docker/                 docker-compose de dev, Dockerfile e compose de produção
docs/                   Documento por etapa + onboarding e runbook
```

## Landing de consultoria

Nova campanha independente em `apps/landing` (Astro), com captura curta integrada ao Tactia Ops. Desenvolvimento: `pnpm --filter @tactia/landing dev` (porta 4321). A LP atual permanece em `apps/web`. Veja [configuração, publicação e funil](docs/landing-consultoria.md).
