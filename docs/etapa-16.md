# Etapa 16 — Mundo bagunçado (Onda 3)

**Status:** concluída
**Data:** 2026-09-12
**Depende de:** [Etapa 15](./etapa-15.md)
**Spec:** seções 3.2–3.4, 7 (storage), 19–24, 36–38, 41–43, 46
**Plano:** [onda-3-mundo-baguncado.md](./onda-3-mundo-baguncado.md)

Fecha o que **não é tabela**: PDF/TXT/MD, imagem, áudio e busca híbrida de
catálogo. O LLM continua sem calcular métrica a partir de chunk. Receita,
ticket e estoque vêm das tools determinísticas.

## Entregue

### Subfase 0 — ObjectStorage
- Interface + `storageKey(${tenantId}/${kind}/${id}.${ext})` em
  `packages/shared/src/storage/object-storage.ts`.
- `LocalObjectStorage` (disco + sidecar `.meta`) e `S3ObjectStorage`
  (`@aws-sdk/client-s3`, `forcePathStyle`).
- Factory `createObjectStorageFromEnv()`: local se `OBJECT_STORAGE=local`
  ou `S3_ENDPOINT` vazio.
- Subpath `@tactia/shared/storage` para não puxar `fs`/AWS no client.

### Subfase A — Documentos
- Chunker 640/80 (tokens ≈ `ceil(chars/4)`), headings markdown.
- `KnowledgeDocument` + `DocumentChunk` (pgvector HNSW cosine).
- Upload → storage → job `knowledge.ingest`. Checksum SHA-256 reusa o
  documento no tenant (`reused: true`, HTTP 200).
- PDF sem texto → `PDF_NO_TEXT` (OCR é visão, subfase B).
- Tool `search_documents`: excerpt 240, `metric: 'documents'`, **sem
  `value`**. Excerpt no envelope `<untrusted origin="document">`.
- UI `/settings/documents` (member+ envia; viewer lê).

### Subfase B — Multimodal
- `MediaAsset` persiste `pending|processing|ready|failed` (incluindo
  `VISION_UNAVAILABLE` / `STT_UNAVAILABLE` sem 500).
- Invoice/receipt → `RawRecord` (`payload.source = vision`), **não** Sale.
- Screenshot / texto longo → `Interaction` channel `other`.
- Áudio → `Interaction` channel `note` + enrichment existente.
- Policy/knowledge → `KnowledgeDocument` via `createFromText`.
- Adapters mock (classificação por bytes UTF-8) e OpenAI-compatible.
- `POST /api/v1/media` (`purpose: knowledge|interaction|auto`).

### Subfase C — Catálogo
- `Customer.embedding` / `Product.embedding`. Texto do cliente **nunca**
  inclui `document`, e-mail ou telefone. Produto inclui preço, não custo.
- `CatalogEmbeddingService` no tick `memory.embed_facts` e inline no
  create/update (falha só loga).
- Tool `search_catalog` (não devolve receita). `get_products` permanece
  ranking por faturamento.

### Guardrail
- `buildClaimAllowlist` ignora sources `metric === 'documents'` ou
  `tool === 'search_documents'`.
- Eval `E16: document source does not satisfy revenue claim`.

## Decisões

- Vector store = **pgvector**. Sem Pinecone, sem LlamaIndex.
- Invoice extraída **não** chama `normalizeToCanonical`.
- `MediaAsset` não estava no spec da onda; foi adicionado para persistir
  failed/unavailable sem distorcer RawRecord.
- Drivers Node/AWS não entram no index principal de `@tactia/shared`.
- Overlap do chunker usa a aproximação chars/4, sem tiktoken.

## Como testar

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test \
  pnpm --filter @tactia/database migrate:deploy

rg "E16:" packages --glob '*.test.ts'

pnpm --filter @tactia/shared exec vitest run src/storage/object-storage.test.ts
pnpm --filter @tactia/domain exec vitest run src/__tests__/chunker.test.ts src/__tests__/e16-messy-world.test.ts
pnpm --filter @tactia/ai exec vitest run src/__tests__/e16-messy-world.test.ts src/__evals__/runner.test.ts
```

UI: `/settings/documents`. Chat: tools `search_documents` / `search_catalog`.

## Pendências

- **Migrar CSV para ObjectStorage.** Uploads CSV ainda escrevem em
  `/tmp/tactia-uploads` via `csv-upload.ts`. Fora desta etapa de propósito.
- OCR de PDF escaneado: usuário reenvia como imagem (visão).
- MCP (Onda 4).
