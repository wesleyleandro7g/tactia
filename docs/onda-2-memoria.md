# Etapa 15 — Memória da empresa (Onda 2)

**Status:** planejada (pré-implementação)
**Onda:** 2 — Memória organizacional
**Depende de:** [Etapa 14 / Onda 1](./onda-1-confianca.md)
**Spec:** seções 3.4, 33, 34, 41–44
**Plano mestre:** [PLANO-EXECUCAO.md](../PLANO-EXECUCAO.md)

---

## Missão do agente

A Tactia já guarda o que o dono declara (`BusinessFact`) e o que o motor aprendeu sobre ruído de insight (`InsightFeedback` + `ThresholdCalibrator`). Falta a memória que faz o produto parecer um **sistema operacional**: recuperar o fato certo na hora certa, lembrar o que foi decidido/executado, e ter playbooks que o assistente **narra** — nunca dispara sozinho.

Três camadas, todas com `tenant_id` e (quando houver texto buscável) `embedding vector(1536)` no Postgres, mesmo padrão de `interactions`.

---

## Já existe (não reconstruir)

| Peça | Onde | Limite atual |
|---|---|---|
| `BusinessFact` | schema `business_facts`; `BusinessFactRepository`; `BusinessFactService` | Sem embedding; `listActive` devolve **tudo** |
| Tools `remember_fact` / `list_business_facts` | `packages/ai/src/tools/phase-cd.ts` | Lista completa; `remember_fact` já é `minRole: member` (E14) |
| ContextBuilder.facts | `packages/ai/src/context-builder.ts` + wiring em `apps/web/src/lib/ai.ts` | Dump de todos os fatos ativos no system prompt |
| `isSuppressed(entityType, entityId)` | `packages/intelligence/src/rule-engine.ts` | Só funciona se o fato tiver **ambos** entityType e entityId |
| UI Settings fatos | `apps/web/src/components/app/facts-settings.tsx` | Só `kind` + `text`. Sem entidade, sem validade — suppression pela UI quase morta |
| Embeddings | `EmbeddingAdapter`, `EMBEDDING_DIMENSIONS = 1536`, HNSW em `interactions` | Só interações |
| `InteractionRepository.searchByEmbedding` | raw SQL `<=>` + `WHERE tenant_id =` | **Copiar este padrão**; não introduzir cliente de vector DB |
| ActionExecution / Approval | `packages/execution/src/execution-engine.ts` | Approve/reject/run grava audit + status. **Não** cria memória |
| InsightFeedback | calibrador de limiar | Não misturar com episódios; são sinais diferentes |
| Playbook no prompt | `system-prompt.ts` seção “playbook do analista” | Texto estático de raciocínio, não playbook da empresa |

`InsightEngine` suppress-by-dismissal (`dismissReason: 'noise'`) **não** entra nesta etapa.

---

## Decisões fixadas

1. Vector store = **pgvector no Postgres da app**. Dimensão 1536. Índice HNSW `vector_cosine_ops`. Escrita via `$executeRaw` / `$queryRaw` (Prisma `Unsupported("vector")`).
2. Texto de episódio é **gerado em código** (template pt-BR), nunca pelo LLM.
3. Playbook é dado + tool de **leitura**. LLM não cria playbook. LLM não executa playbook. No máximo `propose_action` pontual, já existente.
4. ContextBuilder deixa de despejar todos os fatos: **top-K por similaridade com a pergunta**. Sem embedder: N mais recentes (não a lista infinita).
5. `list_business_facts` permanece para “o que você sabe / lista meus fatos”.
6. Envelope `<untrusted origin="fact|episode|playbook">` da E14 aplica-se a todo texto recuperado.
7. Sem Fine-tune, sem resumo infinito de conversa, sem Pinecone, sem documentos (Onda 3).

Constantes:

```
FACT_CONTEXT_K = 8
FACT_CONTEXT_MIN_SCORE = 0.25    // cosine similarity 1 - (embedding <=> q); piso baixo, K corta
EPISODE_SEARCH_LIMIT default 8
PLAYBOOK_CONTEXT_K = 3
EMBEDDING_DIMENSIONS = 1536      // já exportado do interaction-repository; reexportar de um único módulo se possível
```

Mover `EMBEDDING_DIMENSIONS` para `packages/database/src/embeddings.ts` (ou continuar importando do interaction-repository). Um único número no monorepo.

---

## Escopo

### A — Fatos com retrieve semântico

#### Schema

Em `BusinessFact` (Prisma):

```prisma
/// Written via raw SQL (pgvector). Never selected through Prisma.
embedding Unsupported("vector")?
```

Migration:

```sql
ALTER TABLE "business_facts" ADD COLUMN "embedding" vector(1536);
CREATE INDEX "business_facts_embedding_hnsw_idx"
  ON "business_facts" USING hnsw ("embedding" vector_cosine_ops);
```

Não selecionar `embedding` em `findMany` do Prisma.

#### Repository

`BusinessFactRepository` ganha (espelhar `InteractionRepository`):

```ts
updateEmbedding({ tenantId, id, embedding: number[] }): Promise<void>
searchByEmbedding({
  tenantId,
  embedding,
  limit,
  now,           // só fatos ativos (validFrom/validTo)
  kinds?: string[]
}): Promise<Array<BusinessFactRow & { score: number }>>
findPendingEmbedding({ tenantId, take }): Promise<BusinessFactRow[]>  // embedding IS NULL
```

SQL de busca **obrigatoriamente** `WHERE tenant_id = $tenantId::uuid AND embedding IS NOT NULL` + filtro de validade (mesmo predicado de `listActive`).

#### Service

`BusinessFactService.create`: depois do insert, se `embedder` injetado, `embed([text])` e `updateEmbedding`. Falha do embedder **não** falha o create (log warn, fica pendente — igual enrichment de interação).

Novo método:

```ts
searchSemantic(ctx, { query, limit?, kinds? }): Promise<{ items, mode: 'semantic' | 'keyword' }>
```

Keyword fallback: `ILIKE` em `text` nos ativos, se embedder ausente.

Novo método `embedPending(ctx | { tenantId })` para backfill.

#### Tools

`search_business_facts`:

```
name: search_business_facts
description: Busca fatos/eventos/preferências do negócio por similaridade
  com a pergunta. Use quando precisar de contexto qualitativo
  ("temos promoção?", "fulano saiu?"). Não calcula métrica.
minRole: viewer
input: { query: string min 1 max 500, limit?: 1-20 default 8, kind?: fact|event|preference }
output.data: { query, mode, matches: [{ id, kind, text, score?, entityType, entityId, validFrom, validTo }] }
sources: [{ metric: 'business_facts', tool: 'search_business_facts', refId, excerpt, label }]
```

`list_business_facts` — inalterado na forma; description deixa explícito: “lista completa dos fatos ativos; para uma pergunta pontual prefira search_business_facts”.

`remember_fact` — após create, o service já embeda. Sem mudança de input além do que a UI passar (entity/validade já existem no Zod).

#### ContextBuilder

Assinatura do provider de fatos hoje: `(ctx) => Promise<ContextFact[]>`.

Mudar para receber a **pergunta**:

```ts
facts?: (ctx: ToolContext, query: string) => Promise<ContextFact[]>
```

`ContextBuilder.build(ctx, { period, query })` — `Orchestrator.prepare` já tem `request.question`; passar.

Wiring em `apps/web/src/lib/ai.ts`: embed da pergunta + `searchByEmbedding` limit `FACT_CONTEXT_K`. Sem embedder: `listActive` slice 0..K ordenado por `createdAt desc`.

Cada fato no prompt continua na seção “Fatos do negócio”, agora envelopado `<untrusted origin="fact">` (E14).

#### UI

`facts-settings.tsx` + POST `/api/v1/facts`:

Campos novos no form:

- `entityType`: select opcional `seller | product | customer | ''`
- `entityId`: uuid opcional (texto; validar UUID se preenchido)
- `validFrom` / `validTo`: date opcional (já no schema Zod)

Sem isso, `isSuppressed` continua inacessível pela Settings. Help text: “Vincule a um vendedor/produto/cliente para o motor deixar de tratar a queda dessa entidade como anomalia.”

Listar `source` e validade já ajuda; mostrar se o fato está indexado (`embedding` não vaza para a UI — expor `indexed: boolean` no list DTO, derivado de `embedding IS NOT NULL` via raw ou coluna espelho `embeddedAt DateTime?`).

**Preferir `embeddedAt DateTime?`** no Prisma (selecionável) + vector não selecionado. Preencher `embeddedAt` no mesmo `updateEmbedding`. UI: ponto “indexado” se `embeddedAt != null`.

#### Job de backfill

`JOBS.embedFacts = 'memory.embed_facts'` em `apps/web/src/lib/jobs.ts`.

Payload `{ tenantId }`. Handler chama `embedPending`. Publicar após create em lote e no `intelligence.tick` (ou uma vez no deploy via script). Idempotente.

Não precisa de cron dedicado se o tick diário já percorrer tenants — documentar: *backfill no daily tick, lote 32*.

---

### B — Episódios (memória episódica)

#### Schema

```prisma
enum EpisodeKind {
  decision
  action_outcome
  event
}

enum EpisodeOutcome {
  approved
  rejected
  executed
  failed
  cancelled
}

model Episode {
  id                 String         @id @db.Uuid
  tenantId           String         @map("tenant_id") @db.Uuid
  kind               EpisodeKind
  outcome            EpisodeOutcome
  text               String
  actionExecutionId  String?        @map("action_execution_id") @db.Uuid
  approvalId         String?        @map("approval_id") @db.Uuid
  entityType         String?        @map("entity_type")
  entityId           String?        @map("entity_id") @db.Uuid
  embedding          Unsupported("vector")?
  embeddedAt         DateTime?      @map("embedded_at")
  occurredAt         DateTime       @map("occurred_at")
  createdAt          DateTime       @default(now()) @map("created_at")
  tenant             Tenant         @relation(...)
  actionExecution    ActionExecution? @relation(...)

  @@index([tenantId, occurredAt])
  @@index([tenantId, kind])
  @@index([tenantId, actionExecutionId])
  @@map("episodes")
}
```

Índice HNSW igual. Unique parcial **não** obrigatório; o writer é idempotente por `(tenantId, actionExecutionId, outcome)` — unique:

```
@@unique([tenantId, actionExecutionId, outcome])
```

`actionExecutionId` nullable para `kind=event` futuro; unique Postgres permite múltiplos NULL — ok.

#### Texto determinístico (pt-BR)

Função `formatEpisodeText(input)` em `packages/domain` ou `packages/execution`:

```
Proposta {actionType} ({origin}): {outcome}.
Motivo da proposta: {reason || '—'}.
{actionType=send_email → "Destinatário: {to}; assunto: {subject}"}
{actionType=create_task → "Tarefa: {title}"}
```

Não incluir body completo de e-mail (PII / injeção). Subject + to bastam. Rodar `redactSensitive` no texto.

#### Writer

Hook no `ExecutionEngine` **depois** de persistir o status, nos métodos:

- `approve` → kind `decision`, outcome `approved`
- `reject` → kind `decision`, outcome `rejected`
- `run` success → kind `action_outcome`, outcome `executed`
- `run` failure → kind `action_outcome`, outcome `failed`
- `cancel` → kind `decision`, outcome `cancelled`

Porta para não acoplar `execution` → embeddings:

```ts
type EpisodeSink = {
  record(input: CreateEpisodeInput): Promise<void>;
};
```

Injetar em `ExecutionEngine` deps. No composition root (`apps/web/src/lib/services.ts`): `EpisodeService.record` que insert + embed async (falha de embed não reverte a ação).

Se `EpisodeSink` ausente (testes unitários atuais da execution): no-op. Atualizar **um** teste de execution para verificar que o sink é chamado; o isolamento de tenant fica no service.

Não criar tool `remember_episode`.

#### Tool

```
name: search_episodes
description: Busca decisões e resultados de ações já aprovadas, rejeitadas
  ou executadas nesta empresa. Use para "já tentamos desconto?",
  "o que decidimos sobre o cliente X?".
input: { query: string, limit?: default 8, outcome?: EpisodeOutcome }
```

Sources: `metric: 'episodes'`, `refId`, `excerpt: text`.

#### UI

Somente leitura: `/settings/memory` (ou seção em Settings) listando os 50 episódios mais recentes. Sem edição. Role `member+` para ver (viewer pode ver — é histórico tático; **viewer pode listar**, alinhado a insights).

Não é aceite bloquear viewer aqui.

---

### C — Playbooks (memória procedural)

#### Schema

```prisma
model Playbook {
  id          String    @id @db.Uuid
  tenantId    String    @map("tenant_id") @db.Uuid
  slug        String
  title       String
  trigger     String    // quando usar, em linguagem natural
  steps       Json      // PlaybookStep[]
  enabled     Boolean   @default(true)
  embedding   Unsupported("vector")?
  embeddedAt  DateTime? @map("embedded_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")
  tenant      Tenant    @relation(...)

  @@unique([tenantId, slug])
  @@index([tenantId, enabled])
  @@map("playbooks")
}
```

Zod `PlaybookStep`:

```ts
z.object({
  ordinal: z.number().int().min(1),
  text: z.string().min(1).max(500),
  actionType: z.enum(['create_task', 'send_email']).optional(), // só sugestão
})
```

Slug: `^[a-z0-9-]{2,64}$`.

#### Service / rotas

`PlaybookService`: `list`, `getBySlug`, `create`, `update`, `remove`. Mutação `assertRole(ctx, 'member')`. Embed `title + trigger + steps.text` concatenados no create/update.

Rotas:

| Método | Path | Auth |
|---|---|---|
| GET | `/api/v1/playbooks` | tenant |
| GET | `/api/v1/playbooks/:id` | tenant |
| POST | `/api/v1/playbooks` | tenant, roles member+ |
| PATCH | `/api/v1/playbooks/:id` | tenant, roles member+ |
| DELETE | `/api/v1/playbooks/:id` | tenant, roles member+ |

Audit: `PLAYBOOK_CREATED`, `PLAYBOOK_UPDATED`, `PLAYBOOK_DELETED` em `AuditAction`.

#### Tools (somente leitura)

```
list_playbooks  — { enabled?: boolean } → { items: [{ id, slug, title, trigger }] }
get_playbook    — { slug } ou { id } → playbook completo + steps
```

Se o modelo chamar `get_playbook` com slug inexistente: data `{ found: false }`, sem throw (o chat continua).

System prompt — nova seção curta:

```
Playbooks da empresa são procedimentos. Se um for relevante, narre os passos
e, se couber providência concreta, use propose_action. Nunca afirme que o
playbook foi executado.
```

ContextBuilder: top `PLAYBOOK_CONTEXT_K` por embedding da pergunta (título+trigger). Sem embedder: playbooks `enabled` mais recentes, K.

#### Seed

No `apps/web/scripts/seed.ts`, um playbook:

- slug: `reclamacao-atraso`
- title: `Reclamação de atraso`
- trigger: `cliente reclama de atraso na entrega ou logística`
- steps: (1) confirmar pedido e prazo no cadastro (2) criar tarefa para o vendedor responsável no mesmo dia (3) criar tarefa para logística com o número do pedido (4) só então oferecer e-mail de desculpas se o atraso for nosso

#### RuleEngine (fase B — opcional explícita)

**Fora da entrega mínima.** Se o tempo sobrar: `Recommendation.metadata.playbookSlug` quando a regra `unanswered_messages` / complaint casar o trigger por keyword. Não é critério de aceite. Documentar em pendências do `docs/etapa-15.md`.

Playbook **nunca** enfileira `ActionExecution` sozinho.

---

## Envelope e PII

Todo `text` de fato, episódio e passo de playbook que entrar no LLM passa por `sanitizeInjection` + `<untrusted>` da E14. `redactSensitive` no `formatEpisodeText`.

---

## Testes nomeados

### Fatos

1. `E15: fact embedding written on create when embedder present`
2. `E15: fact create succeeds when embedder throws` — embedding null, `embeddedAt` null
3. `E15: searchByEmbedding never leaks neighbor tenant` — copiar o teste de interactions
4. `E15: search_business_facts semantic mode when embedder present` — espelhar `tools.test.ts` `mode === 'semantic'`
5. `E15: search_business_facts keyword fallback without embedder`
6. `E15: ContextBuilder.build uses top-K not full list` — 20 fatos, query casa 1; prompt/system contém o 1 e não despeja 20 (assert length ≤ K)
7. `E15: facts settings persists entityType entityId validTo` — API test
8. `E15: rule isSuppressed still honors entity-linked fact` — regressão RuleEngine

### Episódios

9. `E15: approve writes episode outcome approved with deterministic text`
10. `E15: reject writes episode outcome rejected`
11. `E15: run success writes episode executed` — unique (tenant, execution, outcome) impede duplicata se run for chamado 2x (segunda é no-op ou conflict ignorado)
12. `E15: episode sink failure does not fail approve` — sink throws; approve ainda 200
13. `E15: search_episodes isolated by tenant`
14. `E15: no remember_episode tool in createDefaultTools`

### Playbooks

15. `E15: create playbook member ok, viewer 403`
16. `E15: unique slug per tenant`
17. `E15: get_playbook unknown slug returns found false`
18. `E15: LLM tools cannot execute playbook` — grep: nenhum executor chama PlaybookService.run (não existe `run`)
19. `E15: seed includes reclamacao-atraso`

### Integração chat (mock LLM)

20. `E15: search_business_facts result is wrapped untrusted in tool message`

---

## Critérios de aceite

- [ ] Migration pgvector em `business_facts`, `episodes`, `playbooks` + HNSW + `tenant_id` em todo `WHERE` de busca.
- [ ] Context do chat não injeta mais a lista completa de fatos; top-K ou fallback N recentes.
- [ ] Settings de fatos grava vínculo de entidade e validade.
- [ ] Aprovar/rejeitar/executar ação gera episódio recuperável por `search_episodes`.
- [ ] CRUD de playbooks + 2 tools de leitura; seed demo; LLM não executa playbook.
- [ ] Testes 1–20 (exceto 18 que pode ser assert de código/arquivo) verdes.
- [ ] Isolamento de tenant nos três searchByEmbedding.
- [ ] `pnpm lint && typecheck && test && build` verdes.
- [ ] `docs/etapa-15.md` retrospectivo.

---

## Fora de escopo / anti-padrões

- Resumir conversas longas / memória estilo ChatGPT.
- Fine-tuning, LangChain, vector DB externo.
- Documentos PDF / multimodal (Onda 3).
- MCP (Onda 4).
- Auto-execução de playbook, WhatsApp, novos `ActionType`.
- Fazer o LLM escrever o texto do episódio.
- Unificar InsightFeedback com Episode (são sinais diferentes).

---

## Ordem de implementação

1. Extrair/constante `EMBEDDING_DIMENSIONS` se ainda duplicada.
2. `embeddedAt` + embedding em `BusinessFact` + repository search + service embed + tool + ContextBuilder + UI entidade.
3. Job `memory.embed_facts` no daily tick.
4. Model Episode + sink no ExecutionEngine + tool + UI leitura.
5. Model Playbook + API + Settings + tools + seed.
6. Testes de isolamento e evals de regressão E14 ainda verdes.
7. `docs/etapa-15.md`.

---

## Prompt-base do agente executor

```text
Você vai executar a Etapa 15 do Tactia (Onda 2 — Memória da empresa).

1. Leia docs/onda-2-memoria.md por completo, docs/onda-1-confianca.md (envelope
   e minRole) e docs/etapa-12.md (BusinessFact atual).
2. Copie o padrão pgvector de InteractionRepository; não adicione Pinecone.
3. Episódio = texto template; playbook = leitura; jamais auto-executar.
4. Não antecipe Onda 3 (documentos) nem Onda 4 (MCP).
5. pnpm lint, typecheck, test e build verdes.
6. Escreva docs/etapa-15.md.
```
