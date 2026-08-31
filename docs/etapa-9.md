# Etapa 9 — Pilot Readiness

**Status:** concluída
**Data:** 2026-08-30
**Depende de:** [Etapa 8](./etapa-8.md)
**Entregas operacionais:** [onboarding-cliente.md](./onboarding-cliente.md) · [runbook.md](./runbook.md)

Auditoria final contra a spec e preparação para o primeiro cliente real. Esta
etapa não adicionou features: fechou a Definition of Done (spec §59), corrigiu o
que a auditoria encontrou e produziu evidência automatizada para cada item.

---

## O que a auditoria encontrou

Seis gaps, um deles bloqueante para o piloto.

### 1. O pipeline de ingestão parava no RawRecord (bloqueante)

`normalizeToCanonical` era **código morto**. O `SyncService` chamava
`connector.sync()`, que gravava `RawRecord`, e o ciclo terminava ali: nada era
escrito em `Customer`, `Product`, `Seller` ou `Sale`. O `CsvConnector` até
calculava o registro normalizado e o descartava com um `void normalized`. Além
disso, o normalizer não suportava `sale` (`default: return 'skipped'`).

Consequência: importar um CSV de vendas produzia zero receita, o dashboard ficava
vazio e nenhuma regra disparava. Os itens "Dados são normalizados" e "É possível
importar CSV" da DoD estavam falsos, apesar de o sync reportar `completed`.

**Correção** — novo passo no `SyncService.executeSync`, fechando o lifecycle da
spec §37 (`fonte → raw → normalize → upsert`):

```text
connector.sync()            → RawRecord (original preservado, §3.3)
  ↓ agrupa mappings por entidade e ordena por dependência
  ↓ customer → product → seller → sale
normalizeRow + normalizeToCanonical → upsert por (tenant, fonte, external_id)
  ↓ marca RawRecord.processedAt
runDataQualityChecks(normalizados) → DataQualityReport + Import
```

- `normalizeToCanonical` passou a suportar `sale`, resolvendo cliente, vendedor e
  produto por `external_id` e criando o `SaleItem` quando há produto. Devolve
  `{ status: 'skipped', reason }` em vez de lançar: uma linha ruim não aborta a
  importação e o motivo vira evidência no relatório de qualidade.
- `SaleRepository.upsertByExternalId` agora **substitui** os itens no update
  (antes só atualizava o cabeçalho, então reimportar inflava a base) — resolve a
  pendência registrada na Etapa 3.
- `findByExternalId` em `Customer`/`Product`/`Seller`, com `dataSourceId` opcional.
- Contadores do `SyncJob` passaram a significar o resultado canônico:
  `recordsRead` = linhas lidas na origem, `recordsCreated/Updated` = entidades
  canônicas escritas, `recordsFailed` = linhas descartadas. É o número que o
  operador precisa ("1.842 clientes importados"), e é o que a tela de resultado
  do onboarding já mostrava.

### 2. Data quality rodava sobre o payload cru

`runDataQualityChecks` recebia `rawRecord.payload`, então procurava `name`,
`external_id` e `customer_external_id` nos nomes de coluna **da origem** — não
nos campos canônicos. Em qualquer arquivo cujas colunas não tivessem exatamente
esses nomes, o relatório saía limpo por acidente.

Agora roda sobre os registros normalizados, e os motivos de descarte da
normalização (`sale_customer_not_found`, `missing_external_id`, …) são somados aos
`errors` do relatório.

### 3. Sync sem log estruturado e sem audit de falha

A spec §47 usa justamente um log de sync como exemplo, e o `SyncService` não
logava nada. `AuditAction.SYNC_FAILED` existia no enum e **nunca era gravado**: uma
importação quebrada só deixava rastro na coluna `error` do `SyncJob`.

Agora emite `operation: "sync"` com `tenant_id`, `data_source_id`, `sync_job_id`,
`records`, `records_created/updated/failed`, `duration_ms` e `status`, grava
`SYNC_FAILED` no audit e persiste o erro classificado (`SYNC_ERROR: mensagem`,
sem stack trace).

### 4. Chat sem duração

`createApiHandler` mede o request, mas a resposta em streaming retorna **antes**
de a geração terminar — a duração registrada era a do setup. Foi adicionado
`logChatTurn`, com `operation: "chat"`, `mode: sync|stream`, `duration_ms`,
provider, model, `tool_calls` e `sources`, nos dois caminhos e também no erro.

### 5. Rate limiting só nas rotas de auth

Chat (que gasta dinheiro por request), sync (que lê a origem inteira) e pipeline
(que varre o tenant) estavam sem limite — pendência anotada na Etapa 6.

`createApiHandler` ganhou a opção `rateLimit`, aplicada **depois** da autenticação
para que o bucket seja por tenant:

| Política | Limite | Rotas |
|---|---|---|
| `chat` | 20/min | `POST /conversations/:id/messages` |
| `sync` | 6/min | `POST /data-sources/:id/sync` |
| `pipeline` | 10/min | `POST /insights` |
| `execution` | 60/min | `POST /action-executions` |
| (auth) | 30/min por IP | `/api/v1/auth/*` |

### 6. O pipeline de insights não rodava depois do sync

Previsto na Etapa 5, ficou como pendência. `SyncServiceDeps.onSyncCompleted` é um
hook opcional que `apps/web` liga no `IntelligencePipelineService`; uma falha ali
é logada e **não** derruba o sync. Fecha o trecho
`Importar → Normalizar → Gerar Insight` da spec §2 sem passo manual.

### 7. Bug encontrado durante o smoke test: "queda de 195%"

Com receita caindo de R$ 4.000 para R$ 200, o insight dizia **"Queda de receita de
195%"**. Causa: `ruleRevenueDrop` lia `result.comparison.change` da métrica
`revenue_growth` — ou seja, a variação **do crescimento** entre dois períodos, uma
derivada segunda. Como o período anterior tinha crescimento +100% e o atual −95%,
a conta dava −1,95.

Corrigido para usar `result.value` (a métrica `revenue_growth` já É a variação
contra o período anterior) em `revenue_drop` e `revenue_growth`. A evidência
passou a incluir também `revenue` com comparação — o número que o cliente
reconhece ("R$ 200 contra R$ 4.000"). Teste de regressão fixa o texto:
`'Queda de receita de 90%'` para 1000 → 100.

---

## Definition of Done (spec §59)

### Tenant

| Item | Evidência |
|---|---|
| ✅ É possível criar uma empresa | `pilot-flow.test.ts` "1. cria a empresa" + audit `TENANT_CREATED`; smoke test HTTP no container |
| ✅ É possível criar usuários | `pilot-flow.test.ts` "2. cria usuários" (2 usuários, audit `USER_CREATED`) |
| ✅ Dados são isolados por tenant | `pilot-flow.test.ts` "13. o tenant vizinho não vê nada do piloto" (vendas 0, insights 0, aprovações 0, receita 0, fonte `NOT_FOUND`) + `tenant-isolation.test.ts` + isolamento em `sync-idempotency`, `tools.test.ts` e `execution.test.ts` |

### Data

| Item | Evidência |
|---|---|
| ✅ É possível importar CSV | `pilot-flow.test.ts` 3–5 (4 fontes CSV, testar → descobrir → mapear → prévia → importar); smoke test no container com CSV real |
| ✅ É possível conectar PostgreSQL | `postgres-connector.test.ts` (7 testes): credencial cifrada, `testConnection`, discovery via `information_schema`, prévia, sync para raw + canônico, update refletido, erro de conexão sem vazar senha |
| ✅ Dados raw são preservados | `pilot-flow.test.ts` "5." (6 `RawRecord` com payload) — `RawRecord` nunca é apagado pelo sync |
| ✅ Dados são normalizados | `pilot-flow.test.ts` "5." (3 clientes, 2 produtos, 2 vendedores, 6 vendas com item); `sync-idempotency.test.ts` "should upsert raw records into the canonical model" e "should normalize sales with items, resolving references across data sources" |
| ✅ Sync é idempotente | `sync-idempotency.test.ts`: 2º sync mantém 3 raw records **e** 3 clientes; receita estável em 830,50 com itens não duplicados; `postgres-connector.test.ts` "is idempotent and reflects source updates" (`recordsUpdated: 2`, `recordsCreated: 0`) |

### Intelligence

| Item | Evidência |
|---|---|
| ✅ Métricas básicas funcionam | `metric-engine.test.ts` (13 testes de valor exato); `pilot-flow.test.ts` "7." (receita 200 vs 4000, direção `down`, 6 métricas) |
| ✅ Regras detectam anomalias | `pilot-flow.test.ts` "8." (`revenue_drop` `anomaly` `critical` após o sync, sem passo manual); `intelligence-pipeline.test.ts` (10 testes, incluindo o percentual correto) |
| ✅ Insights são persistidos | `insightService.list` em "8."; deduplicação em `intelligence-pipeline.test.ts`; audit `INSIGHT_CREATED` |
| ✅ Recomendações são persistidas | `pilot-flow.test.ts` "9." (insight com recomendação vinculada, fila `pending`) |

### AI

| Item | Evidência |
|---|---|
| ✅ Chat consulta dados reais | `pilot-flow.test.ts` "10." (tool `get_revenue` sobre os dados importados); `tools.test.ts` (12 testes de integração); chat verificado no container com `LLM_PROVIDER=mock` |
| ✅ IA não acessa banco diretamente | `ToolRegistry` recebe apenas services de domínio; nenhuma tool genérica de query; `packages/ai` não importa `PrismaClient` |
| ✅ Números possuem evidência | `pilot-flow.test.ts` "10." (`sources` com `metric: revenue`, sem guardrail, `metadata` persistido); guardrail `unsourced_numbers` em `orchestrator.test.ts` |
| ✅ Respostas contextualizadas por tenant | `ToolContext` derivado da sessão; log do container mostra `operation:"chat"` com `sources: 4` para o tenant do piloto; isolamento em `tools.test.ts` |

### Execution

| Item | Evidência |
|---|---|
| ✅ É possível criar uma ação | `pilot-flow.test.ts` "11." (proposta via chat) + catálogo em `execution.test.ts`; smoke test `POST /api/v1/action-executions` |
| ✅ Ação pode exigir aprovação | "11.": proposta em `awaiting_approval`, fila com 1 item e **zero** tarefas criadas |
| ✅ Execução é registrada | "12.": `completed`, `output.activityId`, `startedAt`/`finishedAt`, `Activity` criada, audit `ACTION_PROPOSED` + `ACTION_APPROVED` + `ACTION_EXECUTED` |
| ✅ Falhas são registradas | `execution.test.ts` (falha do sender e referência cross-tenant → `status: failed` + `error` classificado + `ACTION_FAILED`) |

### Operations

| Item | Evidência |
|---|---|
| ✅ Existem audit logs | Trilha completa do container: `TENANT_CREATED`, `MEMBERSHIP_CREATED`, `DATA_SOURCE_CREATED`, `SYNC_STARTED`, `SYNC_COMPLETED`, `INSIGHT_CREATED`, `ACTION_CREATED`, `ACTION_PROPOSED`, `ACTION_APPROVED`, `ACTION_EXECUTED`; `SYNC_FAILED` em `sync-idempotency.test.ts` |
| ✅ Existem logs estruturados | Logs do container com `operation: sync / chat / action:create_task / POST /api/v1/...`, todos com `request_id`, `tenant_id`, `duration_ms`, `status`. O mesmo `request_id` correlaciona a requisição HTTP e a execução da ação |
| ✅ Existe painel administrativo | `/admin` e `/admin/tenants/:id` (Etapa 8) com sync jobs, contadores, erros, imports e reprocessamento; gate por allowlist testado em `ui-helpers.test.ts` |
| ✅ Erros podem ser diagnosticados | Erro classificado + `x-request-id` em toda resposta; `security.test.ts` prova que o corpo de erro só tem `code`/`message`/`requestId`; `DataQualityReport` com o motivo de cada linha descartada; [runbook.md](./runbook.md) mapeia sintoma → causa → ação |

---

## Revisão de segurança (spec §49)

| Requisito | Situação |
|---|---|
| Senhas nunca em plaintext | Better Auth (hash próprio); a aplicação não guarda senha |
| Credentials criptografadas | AES-256-GCM; `postgres-connector.test.ts` verifica que a senha não aparece em `encrypted_data` e que o GET só devolve `{id, provider, createdAt}` |
| Isolamento por tenant | Retestado ponta a ponta no `pilot-flow.test.ts` (item 13) |
| Validação de input | Zod em API, tools e actions; input inválido não cria linha nenhuma |
| Autorização server-side | `createApiHandler` + `assertRole`; tenant sempre do cookie validado contra membership, nunca do body |
| Audit log | Ver tabela Operations |
| Rate limiting | 5 políticas; 429 `RATE_LIMITED` verificado no container em `/auth` e no chat |
| Secrets só em env | `grep` por chaves hardcoded: nada. **Achado do smoke test:** `packages/database/.env` estava entrando na imagem porque `.dockerignore` não é recursivo por padrão — corrigido com `**/.env*`, e verificado que só `.env.example` sobrou |
| Nenhuma API key hardcoded | Idem |
| Stack traces nunca expostos | `toAppError` converte erro desconhecido em `INTERNAL_ERROR` genérico; `security.test.ts` valida o formato do corpo; verificado no container (401 e 429 sem stack) |

Duas decisões registradas:

- **`ErrorCode.RATE_LIMITED` (429) foi adicionado** à lista da spec §48. A Etapa 1
  mapeava 429 para `AUTHENTICATION_ERROR`, o que fazia a UI dizer "sua sessão
  expirou" e mandar o usuário para o login por causa de throttling. §49 exige rate
  limiting; um código próprio é o mínimo para o erro ser diagnosticável.
  `security.test.ts` garante que todo código tem status HTTP e mensagem pt-BR.
- **`/api/v1/health` é intencionalmente sem autenticação** (healthcheck do
  container e do load balancer). Responde apenas `{status, database}` — nenhum
  dado de tenant, versão ou detalhe de infraestrutura.

---

## Observabilidade (spec §47)

Exemplos reais colhidos do container de produção:

```json
{"level":30,"request_id":"ae6590bf…","tenant_id":"01a0550b…","user_id":"01a0550b…",
 "operation":"sync","data_source_id":"01a0550b…","sync_job_id":"01a0550b…",
 "records":2,"records_created":2,"records_updated":0,"records_failed":0,
 "duration_ms":67,"status":"completed"}

{"level":30,"request_id":"4a6b0b54…","tenant_id":"01a0550b…","user_id":"01a0550b…",
 "operation":"chat","conversation_id":"01a0550f…","mode":"sync","duration_ms":19,
 "status":200,"provider":"mock","model":"gpt-4o-mini","tool_calls":0,"sources":4}

{"level":30,"request_id":"3157db26…","tenant_id":"01a0550b…",
 "operation":"action:create_task","duration_ms":5,"status":200,"execution_id":"01a0550e…"}

{"level":40,"request_id":"425f1f21…","tenant_id":"01a0550b…","user_id":"01a0550b…",
 "operation":"POST /api/v1/conversations/…/messages","duration_ms":5,
 "status":429,"error":"RATE_LIMITED"}
```

O nível agora acompanha a gravidade: `error` para 5xx, `warn` para 429, `info`
para o resto — `grep '"level":50'` isola incidentes.

---

## Teste E2E do fluxo da spec §2

`apps/web/src/__tests__/pilot-flow.test.ts` — 13 testes, Postgres real,
`MockLLMAdapter`. Roda no ponto de composição: monta os mesmos objetos que
`lib/services.ts` liga em produção (o único substituto é o `AuthProvider`, porque
o teste não sobe HTTP).

| Passo da spec §2 | Teste |
|---|---|
| Criar empresa | 1 |
| Criar usuários | 2 |
| Configurar uma fonte de dados | 3 (testar → descobrir → mapear → prévia) |
| Importar dados | 4 |
| Normalizar dados | 5 |
| Consultar informações empresariais | 6 |
| Calcular métricas | 7 |
| Gerar Insight | 8 (automático, via hook pós-sync) |
| Apresentar Insight ao usuário | 9 |
| Solicitar uma ação | 10 (chat com evidência) e 11 (proposta da IA) |
| Registrar a execução | 12 |
| — | 13 (isolamento entre tenants) |

Os dados são gerados com datas relativas a `Date.now()` em CSVs temporários, então
o teste não apodrece com o tempo: a receita cai de 4.000 para 200 entre a janela
anterior e a atual, o que garante o `revenue_drop`.

---

## Deploy

`docker/Dockerfile` (multi-stage) e `docker/docker-compose.prod.yml`.

```bash
cp .env.example .env.production   # preencha os valores reais
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

- Stages: `deps` (install com lockfile) → `builder` (`prisma generate` + `next build`)
  → `migrator` (`prisma migrate deploy`) e `runner` (Next standalone, usuário não-root).
- Ordem garantida pelo compose: `postgres` healthy → `migrate` com exit 0 → `web`.
- Healthcheck do container consulta `/api/v1/health`.
- Só o web publica porta; Postgres e MinIO ficam na rede interna. TLS fica com um
  proxy na frente (documentado no compose).
- `output: 'standalone'` + `outputFileTracingRoot` no `next.config.ts` — resolve
  de passagem o warning de tracing do Prisma anotado na Etapa 1.
- CI ganhou um job que constrói a imagem: se o artefato de deploy quebrar, a CI falha.

### Resultado do smoke test

Executado com o stack de produção real (`-p tactia-smoke`, porta 3100):

| Verificação | Resultado |
|---|---|
| `migrate` | Todas as migrations aplicadas, exit 0 |
| `web` | `healthy` pelo healthcheck |
| `GET /api/v1/health` | 200 `{"status":"ok","database":"up"}` |
| `/`, `/login`, `/signup` | 200 |
| `/dashboard`, `/chat`, `/approvals`, `/admin` sem sessão | 307 → `/login` |
| `GET /api/v1/customers` sem sessão | 401 `AUTHENTICATION_ERROR`, sem stack trace |
| 31ª tentativa em `/api/v1/auth/sign-in/email` | 429 `RATE_LIMITED` |
| 21ª mensagem no chat | 429 `RATE_LIMITED` |
| Fluxo completo | signup → empresa → 2 fontes CSV → mapeamento → sync → **2 clientes e 2 vendas canônicas** → receita 200 → **3 insights automáticos** → propor ação → `Idempotency-Key` repetida devolve a mesma execução → aprovar → `completed` com `activityId` → `Activity` criada → trilha de audit completa |
| Chat com `LLM_PROVIDER=mock` | Resposta persistida com 4 fontes |

Dois defeitos de empacotamento apareceram só aqui e foram corrigidos: o `.env` de
desenvolvimento entrando na imagem e o query engine do Prisma não encontrado no
bundle standalone (resolvido com `PRISMA_QUERY_ENGINE_LIBRARY`).

---

## Decisões

- **A normalização ficou no `SyncService`, não no connector.** O connector é
  responsável por falar com a origem e preservar o registro cru; quem conhece o
  modelo canônico é o domínio. Assim um connector novo (API, webhook) herda
  normalização, qualidade e idempotência sem reimplementar nada.
- **Referências resolvem na fonte e, se falharem, no tenant.** O wizard cria uma
  `DataSource` por arquivo CSV, então as vendas e os clientes vivem em fontes
  diferentes. Sem o fallback, todo `sale` de um CSV separado seria descartado. O
  risco é colisão de `external_id` entre origens distintas dentro do mesmo tenant;
  para o piloto (uma origem por cliente) é aceitável, e está documentado.
- **`SyncService` passou a receber um objeto de dependências.** Com 12 colaboradores,
  parâmetros posicionais seriam ilegíveis; o padrão já existia em `ExecutionEngine`.
- **Linha descartada não derruba a importação.** `normalizeToCanonical` devolve
  `skipped` com motivo e o motivo vira erro no `DataQualityReport`. Um arquivo com
  10 linhas ruins em 10.000 importa 9.990 e explica as 10.
- **Contadores do `SyncJob` medem o resultado canônico.** É o que o operador
  precisa responder ("quantos clientes entraram?"); a contagem de raw records
  continua disponível em `/api/v1/imports` por entidade.
- **Rate limit aplicado depois da autenticação**, para que a chave seja o tenant e
  um cliente não consuma a cota do outro. Continua in-memory: com mais de uma
  instância o limite efetivo é multiplicado — anotado no runbook.
- **`onSyncCompleted` é um port opcional**, não uma dependência do domínio para o
  pacote `intelligence`. Mantém o sync utilizável sem pipeline e deixa o wiring
  em `apps/web`, coerente com as Etapas 3 e 7.
- **O E2E vive em `apps/web`.** É o único lugar que já depende de todos os pacotes;
  colocá-lo em `packages/*` exigiria dependências de teste cruzadas e inverteria o
  grafo (`domain` não conhece `execution`).
- **`docs/etapa-9.md` não repete a documentação operacional.** O passo a passo do
  cliente e o diagnóstico moram em arquivos próprios, que são o entregável para o
  operador.

---

## Como validar

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm install && pnpm db:generate
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm --filter @tactia/database migrate:deploy
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm test
```

Somente o E2E do piloto:

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test \
  pnpm --filter @tactia/web test -- pilot-flow
```

Deploy:

```bash
cp .env.example .env.production   # preencha os valores reais
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
curl -s http://localhost:3000/api/v1/health
```

> `--env-file` **não** sobrepõe variável já exportada no shell. Se o container
> subir apontando para o banco de desenvolvimento, limpe o ambiente
> (`env -u DATABASE_URL -u ENCRYPTION_KEY … docker compose …`).

---

## Suíte

**149 testes**, verdes em duas execuções consecutivas:

| Pacote | Testes | Novos nesta etapa |
|---|---|---|
| `shared` | 2 | — |
| `web` | 32 | +20 (13 do E2E do piloto, 7 de segurança) |
| `domain` | 34 | +15 (7 do PostgresConnector, 8 no sync) |
| `intelligence` | 23 | +1 (regressão do percentual) |
| `ai` | 34 | — |
| `execution` | 24 | — |

`pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` passam (9/9 tasks).

---

## Pendências (fora do escopo da V0.1)

Nada bloqueia o piloto. Em ordem de dor esperada:

1. **Sync assíncrono (pg-boss).** Hoje inline: uma importação muito grande pode
   estourar o timeout do proxy. A porta `JobQueue` já existe.
2. **Upload de CSV pela interface.** Depende de colocar o `CsvConnector` sobre o
   object storage; hoje é caminho no servidor + `docker compose cp`.
3. **Rate limit distribuído.** In-memory vale por processo.
4. **Provider real de e-mail.** O driver `console` só registra no log.
5. **Retry de execução falha** e agendamento de sync.
6. **Webhooks completos.** A rota recebe e loga; falta resolver `dataSourceId` por
   provider e persistir em `RawRecord`.
7. **Colisão de `external_id` entre fontes** do mesmo tenant (ver Decisões).
8. **Testes de componente/E2E de navegador** (Playwright): a UI continua coberta
   por helpers puros + smoke test HTTP.
