# Etapa 1 — Foundation e Identity

**Status:** concluída
**Data:** 2026-08-26
**Depende de:** [Etapa 0](./etapa-0.md)

## Entregue

### Modelo e persistência

- Prisma: `Tenant`, `User`, `Membership`, `AuditLog` com enums da spec (status/roles).
- Soft delete (`deleted_at`) em User e Membership; Tenant usa `status = deleted`.
- Índices em `tenant_id`, `status`, `created_at`, `email`, `slug`.
- Tabelas Better Auth isoladas (`auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`). O User de domínio aponta para o provider via `external_auth_id`.

### Autenticação e contexto

- Better Auth (email/senha) em `/api/v1/auth/*`, `basePath` alinhado à spec.
- Porta `AuthProvider` no domínio — o domínio não importa Better Auth.
- `createApiHandler` resolve sessão → User de domínio → membership ativo → `RequestContext { requestId, tenantId, userId, role }`.
- Tenant ativo vem do cookie httpOnly `tactia-tenant-id`, validado contra membership. Nunca do body/query.
- Autorização por role (`owner` > `admin` > `member` > `viewer`).
- Rate limit in-memory nas rotas de auth (30 req/min por IP).

### Serviços e rotas

| Método | Rota | Auth |
|---|---|---|
| * | `/api/v1/auth/*` | Better Auth + rate limit |
| GET/POST | `/api/v1/tenants` | usuário autenticado |
| GET/PATCH | `/api/v1/tenants/:id` | membro; PATCH owner/admin |
| POST | `/api/v1/tenants/:id/switch` | membro |
| GET/POST | `/api/v1/users` | tenant; POST owner/admin |
| GET | `/api/v1/users/me` | usuário |
| GET/PATCH | `/api/v1/users/:id` | tenant |
| GET/POST | `/api/v1/memberships` | tenant; POST owner/admin |
| GET/PATCH/DELETE | `/api/v1/memberships/:id` | tenant; mutação owner/admin |
| GET | `/api/v1/audit-logs` | owner/admin |

### Auditoria

`AuditLogService` grava `TENANT_CREATED`, `USER_CREATED`, `MEMBERSHIP_CREATED`, `MEMBERSHIP_UPDATED`, `MEMBERSHIP_REMOVED`.

### UI mínima

- `/signup` — cria conta Better Auth + empresa (owner).
- `/login` — login email/senha.
- `/app` — lista empresas e troca tenant ativo.

### Testes

Integração em Postgres (`tactia_test`):

- Ator do tenant A recebe `NOT_FOUND` ao ler user/tenant B.
- Listagens e audit logs não vazam entre tenants.
- Viewer recebe `AUTHORIZATION_ERROR` ao mutar memberships.
- Criar empresa + usuário grava `TENANT_CREATED`, `USER_CREATED`, `MEMBERSHIP_CREATED`.

`pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` passam.

## Decisões

- User de domínio é separado das tabelas Better Auth (spec §7: domínio desacoplado do provider).
- `UserRepository.findByExternalAuthId` / `findByDomainId` não recebem `tenantId` — o User não é tenant-scoped; listagens passam por Membership. Exceção documentada à convenção §34.
- Cookie de tenant em vez de campo extra na sessão Better Auth, para não acoplar tenancy ao provider.
- Better Auth 1.7 exige `issuer` em `auth_accounts`; credenciais usam `issuer = "credential"`.
- UUID v7 gerado na aplicação (`createId()`), não no default do Postgres.
- Rate limit mapeado para HTTP 429 com código `AUTHENTICATION_ERROR` (spec §48 não tem `RATE_LIMITED`).

## Como testar manualmente

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm db:migrate:deploy
pnpm db:seed          # owner@demo.tactia / password123
pnpm dev
```

1. Abrir http://localhost:3000/signup, criar empresa.
2. Confirmar redirecionamento para `/app` com a empresa ativa.
3. `GET /api/v1/users/me` e `GET /api/v1/audit-logs` (owner) via cookie de sessão.
4. Criar segundo usuário em `/api/v1/users` (role member).
5. Logout + login com o member; `GET /api/v1/audit-logs` deve retornar `AUTHORIZATION_ERROR`.

Isolamento automatizado:

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm --filter @tactia/database migrate:deploy
pnpm --filter @tactia/domain test
```

## Pendências (próximas etapas)

- Email de verificação / convite por e-mail (fora do V0.1).
- Rate limit distribuído (hoje in-memory; suficiente para um processo).
- Warning do Turbopack sobre tracing do Prisma Client — avaliar `outputFileTracingRoot` na Etapa 9.
- Seed rico de negócio (customers/sales) é da Etapa 2.
