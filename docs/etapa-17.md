# Etapa 17 — Sistema operacional / MCP (Onda 4)

**Status:** concluída
**Data:** 2026-09-12
**Depende de:** [Etapa 16](./etapa-16.md)
**Spec:** seções 34, 41–45, 47–49
**Plano:** [onda-4-sistema-operacional.md](./onda-4-sistema-operacional.md)

O Tool Registry continua o único portão. Esta etapa **não reescreve o cérebro**:
expõe `definitions()` / `execute()` a clientes externos via MCP, com identidade
de tenant equivalente à sessão.

## Entregue

### TenantApiKey
- Model `tenant_api_keys` (prefixo único, hash scrypt, `role` congelada na
  emissão, `revokedAt` sem delete).
- Secret `tactia_live_<prefix>_<32 bytes hex>` mostrado **uma vez** no POST.
- Hash: `crypto.scrypt` com pepper `ENCRYPTION_KEY`; compare `timingSafeEqual`.
- Rotas sessão (admin+): `GET/POST /api/v1/api-keys`,
  `POST /api/v1/api-keys/:id/revoke`.
- UI `/settings/api-keys` (modal “copie agora”, revogar).
- Audit `API_KEY_CREATED` / `API_KEY_REVOKED` — sem o secret.

### Auth `api_key`
- `createApiHandler({ auth: 'api_key' })` lê `Authorization: Bearer`, ignora
  cookie. Tenant/user/role vêm **só** da key.
- Rate limit `RATE_LIMITS.mcp` → bucket `api_key:{keyId}`, 60/min.
- `CRON_SECRET` não autentica o MCP.

### MCP server (adaptador)
- `@modelcontextprotocol/sdk` 1.30 em `packages/ai`: `Server` +
  `WebStandardStreamableHTTPServerTransport` **stateless** +
  `enableJsonResponse: true` (Request/Response Web, uma instância por call).
- Rota `POST|GET|DELETE /api/v1/mcp`. GET/DELETE existem porque o transporte
  Streamable HTTP usa SSE/teardown; o contrato útil é POST JSON-RPC.
- `tools/list` / `tools/call` sobre o registry. Zod → JSON Schema via
  `zod-to-json-schema`. Resultado sempre JSON (`content[].text` +
  `structuredContent` + `_meta.sources`). Sem orchestrator, sem prosa.
- Scope `tools:propose` para `propose_action`; role da key continua filtrando
  (E14). `origin: 'mcp'` no `ExecutionEngine` (sempre `awaiting_approval`).
- Audit `MCP_TOOL_CALLED` (`tool`, `keyPrefix`, `duration_ms`) — sem arguments.

### MCP client (connector)
- `DataSourceType.mcp` + `McpConnector`: `initialize`/`tools/list` no teste,
  `tools/call` no fetch, upsert `RawRecord` no sync.
- Chat **não** ganha `call_external_mcp`.

## Decisões

- SDK pinado **1.30.0** (já estava no lockfile). Transporte Web Standard, não
  o wrapper Node `IncomingMessage`. Stateless: cada request cria server+transport
  novos (`sessionIdGenerator: undefined`).
- `structuredContent` existe nesta versão; devolvemos `{ data, sources, proposal? }`
  além do texto JSON e do `_meta`.
- Accept obrigatório do SDK: `application/json, text/event-stream`.
- OAuth / marketplace Claude fica pendência (spec).

## Como testar

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test \
  pnpm --filter @tactia/database migrate:deploy

rg "E17:" packages apps --glob '*.test.ts'

pnpm --filter @tactia/domain exec vitest run src/__tests__/e17-api-keys.test.ts
pnpm --filter @tactia/ai exec vitest run src/__tests__/e17-mcp.test.ts
pnpm --filter @tactia/execution exec vitest run src/__tests__/execution.test.ts -t "E17"
pnpm --filter @tactia/connectors exec vitest run src/__tests__/mcp-connector.test.ts
pnpm --filter @tactia/web exec vitest run src/lib/__tests__/security.test.ts src/lib/__tests__/e17-mcp-auth.test.ts
```

UI: `/settings/api-keys`. Cliente: `POST /api/v1/mcp` com Bearer da key.

## Pendências

- OAuth / Claude Custom Connector marketplace.
- Slack, WhatsApp outbound, CLI rica (fora de propósito).
- Rate limit in-memory: por processo, como o resto da V0.1.
