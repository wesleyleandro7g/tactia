# Etapa 15 — Memória da empresa (Onda 2)

**Status:** concluída
**Data:** 2026-09-12
**Depende de:** [Etapa 14](./etapa-14.md)
**Spec:** seções 3.4, 33, 34, 41–44
**Plano:** [onda-2-memoria.md](./onda-2-memoria.md)

Fecha a memória operacional: o fato certo na hora certa (pgvector), o que
foi decidido/executado (episódios) e playbooks que o assistente **narra** —
nunca dispara sozinho.

## Entregue

- `EMBEDDING_DIMENSIONS = 1536` e constantes de retrieve em
  `packages/database/src/embeddings.ts` (único número no monorepo).
- `BusinessFact.embedding` + `embeddedAt`; busca `searchByEmbedding` com
  `WHERE tenant_id` + validade; create embeda sem falhar o insert.
- Tool `search_business_facts` (`viewer`); `list_business_facts` aponta para
  ela em perguntas pontuais.
- ContextBuilder deixa de despejar todos os fatos: top-K semântico
  (`FACT_CONTEXT_K = 8`, piso `0.25`) ou N mais recentes sem embedder.
- Settings de fatos: `entityType` / `entityId` / validade + ponto “indexado”.
- Job `memory.embed_facts` no tick diário (lote 32, fatos + episódios + playbooks).
- `Episode` + sink no `ExecutionEngine` (approve/reject/run/cancel). Texto
  determinístico via `formatEpisodeText` (sem body de e-mail; `redactSensitive`).
- Tool `search_episodes`; UI somente leitura em `/settings/memory` (viewer ok).
- `Playbook` CRUD (`member+`), tools `list_playbooks` / `get_playbook`
  (`found: false` se não existir). Seed `reclamacao-atraso`.
- Envelope `<untrusted origin="fact|episode|playbook">` (E14) no prompt e nas tools.
- Testes nomeados E15 1–20.

## Decisões

- Vector store = **pgvector no Postgres da app**. Sem Pinecone. HNSW
  `vector_cosine_ops`. Embedding nunca é selecionado via Prisma.
- Falha do embedder ou do episode sink **não** reverte create/approve/run.
- Unique `(tenantId, actionExecutionId, outcome)` torna o writer de episódio
  idempotente; o sink ausente nos testes antigos é no-op.
- Playbook não tem `run`. LLM não cria nem executa playbook.
- Mock de embedding usa eixos unitários por família de palavras, senão um
  boost de uma coordenada some em 1536 dimensões.

## Como testar

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test \
  pnpm --filter @tactia/database migrate:deploy

rg "E15:" packages --glob '*.test.ts'

pnpm --filter @tactia/domain exec vitest run src/__tests__/e15-memory.test.ts
pnpm --filter @tactia/ai exec vitest run src/__tests__/e15-memory.test.ts
pnpm --filter @tactia/execution exec vitest run src/__tests__/execution.test.ts -t "E15"
pnpm --filter @tactia/intelligence exec vitest run src/__tests__/intelligence-pipeline.test.ts -t "E15"
```

UI: `/settings/facts` (vínculo e validade), `/settings/memory` (leitura),
`/settings/playbooks` (CRUD member+).

## Pendências

- `Recommendation.metadata.playbookSlug` quando a regra casar o trigger
  (fase B opcional do plano — fora da entrega mínima).
- Documentos / multimodal (Onda 3) e MCP (Onda 4).
- Unificar `InsightFeedback` com `Episode` — deliberadamente fora; são
  sinais diferentes.
