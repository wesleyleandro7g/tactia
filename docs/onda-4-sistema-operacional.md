# Etapa 17 — Sistema operacional / MCP (Onda 4)

**Status:** planejada (pré-implementação)
**Onda:** 4 — O registry vira porta do SO
**Depende de:** [Etapa 16 / Onda 3](./onda-3-mundo-baguncado.md)
**Spec:** seções 34, 41–45, 47–49
**Plano mestre:** [PLANO-EXECUCAO.md](../PLANO-EXECUCAO.md)

---

## Missão do agente

O Tool Registry já é o único portão entre a IA e os dados da empresa. Esta etapa **não reescreve o cérebro**: expõe o mesmo `definitions()` / `execute()` para clientes externos via MCP, com identidade de tenant equivalente à sessão.

Chat, guardrails, aprovações e tools permanecem a fonte da verdade. MCP é adaptador.

A sequência oficial espera E16 para o servidor já listar `search_documents`, `search_catalog`, `search_episodes`, etc. Se alguém antecipar E17 após E14, o servidor simplesmente lista o registry daquele momento — o contrato não muda.

---

## Já existe (não reconstruir)

| Peça | Onde | Limite atual |
|---|---|---|
| `ToolRegistry` | `packages/ai/src/tool-registry.ts` | `definitions()`, `execute(name, ctx, input)`, Zod, log `tool:{name}` |
| ~35 tools + `propose_action` | `createDefaultTools` | Filtro `minRole` da E14 |
| Chat | cookie Better Auth, `createApiHandler` `auth: 'tenant' \| 'user' \| 'none'` | Sem API key |
| Cron | `CRON_SECRET` + `cronSecretMatches` em `apps/web/src/lib/jobs.ts` | **Não** reutilizar para MCP (é um segredo de plataforma, não de tenant) |
| Webhook inbound | stub | Fora |
| Slack | inexistente | Fora |
| `@modelcontextprotocol/sdk` | só transitivo no lockfile | Declarar dep **direta** onde o server/client viver |
| Connector | CSV + Postgres | `xlsx`/`rest`/`google_sheets` ainda vazios; MCP client ocupa o encaixe `rest`-like sem fingir ser REST |
| Execution | propose → approval → run | MCP `tools/call` de `propose_action` segue **exato** o mesmo motor |

---

## Decisões fixadas

1. MCP é protocolo em volta do registry. Zero tool “nova” que só exista no MCP.
2. Autenticação de cliente externo = **`TenantApiKey`**. Header `Authorization: Bearer tactia_live_<secret>`. Context (`tenantId`, `userId`, `role`) deriva da key, **nunca** do JSON-RPC body.
3. Não usar `CRON_SECRET` nem cookie de browser no Claude Desktop.
4. `tools/call` devolve o `ToolResult` (JSON). **Não** roda o Orchestrator, **não** aplica `claim_mismatch` em prosa de terceiro. A evidência vai em `sources`. O cliente que narrar número é o responsável. Documentar isso no README da etapa e no `docs/runbook.md` (parágrafo).
5. `propose_action` via MCP cria a mesma `ActionExecution` `origin: 'ai'` (ou origin `'mcp'` se quiserem distinguir — **preferir `origin: 'mcp'`** novo valor, auditável). Continua exigindo aprovação humana. Role abaixo de `member` nem vê a tool (E14).
6. MCP **client** (Tactia consome MCP alheio) só no connector: `fetch` → RawRecord. O chat **não** ganha tool `call_external_mcp`.
7. Sem Slack, WhatsApp outbound, CLI rica, multi-agente, sandbox de código, Fine-tune, Streamable auth OAuth (v1 da key basta; OAuth fica pendência).
8. Rate limit próprio, mais apertado que o chat: default 60 req/min por key.

---

## Escopo

### 1. TenantApiKey

#### Schema

```prisma
model TenantApiKey {
  id         String    @id @db.Uuid
  tenantId   String    @map("tenant_id") @db.Uuid
  name       String
  prefix     String    // 8 chars visíveis, ex. "k4f9c2ab"
  hash       String    // scrypt or sha256(pepper + secret) — NEVER the secret
  scopes     String[]  @default(["tools:read"])
  createdBy  String    @map("created_by") @db.Uuid
  lastUsedAt DateTime? @map("last_used_at")
  revokedAt  DateTime? @map("revoked_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  tenant     Tenant    @relation(...)
  creator    User      @relation(...)

  @@unique([prefix])
  @@index([tenantId, revokedAt])
  @@map("tenant_api_keys")
}
```

Pepper: `ENCRYPTION_KEY` (já existe). Hash: `sha256(hex(ENCRYPTION_KEY) + secret)` é aceitável se o secret tiver 32 bytes crypto; **preferir scrypt** (`crypto.scrypt`) com N padrão Node. Comparar em tempo constante (`timingSafeEqual` no hash, como `cronSecretMatches`).

Secret cru: `tactia_live_` + `prefix` + `_` + 32 bytes hex (ou base64url). Mostrado **uma vez** no POST response. Nunca mais selecionável.

Scopes:

```
tools:read      // tools/list + tools/call de tools com minRole viewer
tools:propose   // inclui propose_action (ainda exige member+ na role da key)
keys:manage     // não necessário na key; manage é só sessão owner/admin
```

A **role** da key é a role do `createdBy` **no momento da emissão, congelada na key**? Mudança de papel do user não deve reabrir propose. **Decisão: persistir `role Snapshot` na key.**

```prisma
role MembershipRole  // viewer | member | admin | owner no momento do create
```

Revogar não apaga (auditoria); `revokedAt` setado.

#### Service / rotas (UI sessão, não MCP)

`TenantApiKeyService`:

- `create(ctx, { name, scopes })` — `assertOwnerOrAdmin`; devolve `{ ...row, secret }` uma vez
- `list(ctx)` — sem hash
- `revoke(ctx, id)` — owner/admin

| Método | Path | Auth |
|---|---|---|
| GET | `/api/v1/api-keys` | tenant, roles admin+ |
| POST | `/api/v1/api-keys` | tenant, roles admin+ |
| POST | `/api/v1/api-keys/:id/revoke` | tenant, roles admin+ |

Audit: `API_KEY_CREATED`, `API_KEY_REVOKED`. Não logar o secret.

UI: `/settings/api-keys` — nome, prefixo, createdAt, lastUsedAt, botão revogar, modal “copie agora”.

`.env.example`: nada de key de tenant (são por empresa). Documentar no runbook como emitir.

---

### 2. Auth no `createApiHandler`

Estender `AuthMode`:

```ts
type AuthMode = 'none' | 'user' | 'tenant' | 'api_key'
```

`api_key`:

1. Ler `Authorization: Bearer ...`
2. Resolver `TenantApiKeyService.verify(token)` → `{ tenantId, userId, role, scopes, keyId }`
3. Montar `RequestContext` (sem cookie)
4. Touch `lastUsedAt` (fire-and-forget, no máximo 1x/min para não escrever toda call)
5. Falha → `AUTHENTICATION_ERROR` 401, mesma forma `fail()`

Não misturar cookie + key no mesmo handler. Rota MCP é só `api_key`.

Rate limit: chave `api_key:{keyId}` , policy `RATE_LIMITS.mcp = { windowMs: 60_000, max: 60 }`.

---

### 3. MCP server

Pacote: implementação em `packages/ai/src/mcp/server.ts` + route Next.

Dep: `@modelcontextprotocol/sdk` em `packages/ai` **e** se a rota precisar, reexport. Verificar a API atual do SDK (Streamable HTTP / JSON-RPC 2.0) **no momento da implementação** via docs do pacote instalado — não chutar métodos deprecados.

Contrato mínimo (mesmo que o SDK mude nomes, estes métodos JSON-RPC existem no spec MCP):

| Método MCP | Mapeamento Tactia |
|---|---|
| `initialize` | server name `tactia`, version do `package.json` da web ou `0.1.0` |
| `tools/list` | `registry.definitions(ctx.role)` → `{ name, description, inputSchema }` JSON Schema (Zod → JSON Schema; o registry hoje passa Zod ao LLM adapter — **converter** com `zod-to-json-schema` já usado ou o helper do AI SDK). Só tools cobertas pelo scope: sem `tools:propose`, omitir `propose_action`. |
| `tools/call` | parse `name` + `arguments`; `registry.execute(name, toolContext, arguments)`; retorno `{ content: [{ type: 'text', text: JSON.stringify(result.data) }], _meta: { sources: result.sources, proposal: result.proposal } }` ou o campo `structuredContent` se o SDK da versão instalada tiver. **Sempre JSON da tool, nunca prosa.** |
| `ping` | `{}` |
| Outros (`prompts/list`, `resources/list`) | lista vazia / method not found — não inventar resources paralelos ao canônico |

Rota:

```
POST /api/v1/mcp
```

`createApiHandler({ auth: 'api_key', rateLimit: RATE_LIMITS.mcp })`.

Se o SDK exigir GET/SSE para streamable HTTP, documentar GET na **mesma** path com o mesmo auth. Implementar só o que o SDK da versão pinada exigir para Claude Desktop “HTTP MCP”.

`toToolContext(ctx)` já existe em `apps/web/src/lib/ai.ts` — reusar.

Erros: tool Zod → MCP `isError: true` + message de `VALIDATION_ERROR`. `AUTHORIZATION_ERROR` se scope/role. Nunca stack.

Audit por call: `MCP_TOOL_CALLED` metadata `{ tool, keyPrefix, duration_ms, error? }`. Sem input cru se PII (redactSensitive no JSON stringificado se for logar). Preferir **não** persistir arguments no audit, só o nome da tool.

#### Initialize payload (documentar para o operador)

```json
{
  "url": "https://<host>/api/v1/mcp",
  "headers": { "Authorization": "Bearer tactia_live_..." }
}
```

Parágrafo em `docs/runbook.md` e `docs/onboarding-cliente.md` (seção curta “Agentes externos”).

---

### 4. Origin `mcp` na execution

`ExecutionEngine.propose` já recebe `origin?: ExecutionOrigin`. Hoje `'user' | 'ai' | 'system'`.

Estender:

```ts
type ExecutionOrigin = 'user' | 'ai' | 'system' | 'mcp'
```

`origin === 'mcp'` **sempre** `requiresApproval` (igual `'ai'`).

Wiring: `actionProposer` usado pelo registry MCP chama `proposeFromAi` ou novo `proposeFromMcp` que seta origin. Não duplicar validação Zod.

Teste: MCP call `propose_action` → execution `awaiting_approval`, 0 tasks criadas (espelhar pilot-flow 11).

---

### 5. MCP client (connector)

`packages/connectors/src/mcp-connector.ts` implementa `Connector`:

- Config/credential: `{ url: string, authorization?: string }` — authorization na `Credential` cifrada (AES-256-GCM já existe)
- `testConnection`: `initialize` + `tools/list`
- `discover`: mapeia tools externas para `DiscoveryResource` (nome da tool = resource; schema = columns sintéticas `name/type`)
- `fetch(resource)`: `tools/call` da tool remota; cada item do retorno vira `RawRow`
- `sync`: upsert RawRecord como os outros connectors
- `normalize`: reusa transforms existentes

`DataSourceType`: usar `rest` **é mentira**. Adicionar enum `mcp`.

`DataSourceService._buildConnector`: `case 'mcp': new McpConnector(...)`.

Chat **não** registra tool para chamar esse MCP. Ingestão é sync job, como Postgres.

Testes: servidor MCP mock in-process (JSON-RPC handler fake) + 2 calls. Sem rede.

---

## Testes nomeados

1. `E17: create api key returns secret once; list does not include hash or secret`
2. `E17: revoke then Bearer 401`
3. `E17: timing-safe verify rejects truncated token`
4. `E17: viewer-role key tools/list omits propose_action`
5. `E17: tools/call get_revenue uses tenant from key not body`
6. `E17: body tenantId cannot switch tenant` — arguments `{ tenantId: victim }` ignorado; dados do dono da key
7. `E17: tools/call unknown tool isError NOT_FOUND`
8. `E17: tools/call invalid args isError VALIDATION_ERROR`
9. `E17: propose_action via MCP origin mcp awaiting_approval no task`
10. `E17: tools/call without tools:propose scope cannot propose_action`
11. `E17: rate limit 61st call RATE_LIMITED`
12. `E17: McpConnector fetch upserts RawRecord from mock server`
13. `E17: McpConnector does not register a chat tool` — `createDefaultTools().map(t => t.name)` not includes `call_external_mcp`
14. `E17: CRON_SECRET is not accepted as Bearer on /api/v1/mcp`

Pilot-flow: **não** é obrigatório estender o E2E HTTP MCP nesta etapa; os testes 5–9 com registry + verify bastam. Um teste de rota com `Request` + handler é desejável (padrão `security.test.ts` / route tests se existirem).

---

## Critérios de aceite

- [ ] Owner/admin emite key, vê secret uma vez, revoga; Settings funciona.
- [ ] `POST /api/v1/mcp` com Bearer lista e chama tools do registry do **mesmo** tenant da key.
- [ ] Impossível ler o tenant vizinho via arguments.
- [ ] `propose_action` via MCP não executa; fila de aprovação incrementa.
- [ ] `McpConnector` sincroniza para RawRecord contra mock; chat sem tool MCP genérica.
- [ ] Runbook explica URL + header e deixa claro que prosa do cliente MCP não passa pelo guardrail de números.
- [ ] `pnpm lint && typecheck && test && build` verdes.
- [ ] `docs/etapa-17.md` retrospectivo.

---

## Fora de escopo / anti-padrões

- Slack, WhatsApp, Discord, “mesmo chat no Slack”.
- OAuth / Claude Custom Connector marketplace (pendência).
- Orquestrar o LLM **dentro** do MCP server (vira segundo cérebro).
- Expor SQL, Prisma, ou `run_raw`.
- Reusar `CRON_SECRET`.
- Fine-tune, vector DB extra, LangChain.
- Sandbox de código, subagentes eve.
- CLI `tactia` completa (um curl no runbook basta).

---

## Runbook — parágrafo a incluir

> Clientes MCP (Claude Desktop, outro agente interno) chamam `POST /api/v1/mcp` com uma API key do tenant. Isso executa as **mesmas tools** do chat. Números vêm no JSON `data` + `sources`. Se o cliente MCP **escrever** uma frase com número inventado, a Tactia não intercepta — o guardrail de prosa vale no orchestrator do chat. Ações (`propose_action`) entram na fila de aprovação.

---

## Ordem de implementação

1. Model + hash + service + rotas + UI de keys + testes 1–3.
2. `AuthMode 'api_key'` + rate limit.
3. Adaptador MCP `list`/`call` sobre o registry existente + rota + testes 4–11, 14.
4. `origin: 'mcp'` no execution engine.
5. `McpConnector` + enum `mcp` + testes 12–13.
6. Runbook + onboarding.
7. `docs/etapa-17.md`.

---

## Prompt-base do agente executor

```text
Você vai executar a Etapa 17 do Tactia (Onda 4 — MCP / sistema operacional).

1. Leia docs/onda-4-sistema-operacional.md por completo. Confira a API atual
   de @modelcontextprotocol/sdk no pacote instalado (não use memória de versões).
2. MCP é adaptador do ToolRegistry. Não crie segundo orchestrator.
3. Auth = TenantApiKey; nunca CRON_SECRET. Tenant só da key.
4. Chat não ganha tool para MCP externo; connector só ingestão RawRecord.
5. Não implemente Slack.
6. pnpm lint, typecheck, test e build verdes.
7. Escreva docs/etapa-17.md e o parágrafo de runbook.
```
