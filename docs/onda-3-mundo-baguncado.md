# Etapa 16 — Mundo bagunçado (Onda 3)

**Status:** planejada (pré-implementação)
**Onda:** 3 — Documentos, multimodal de entrada, busca híbrida
**Depende de:** [Etapa 15 / Onda 2](./onda-2-memoria.md)
**Spec:** seções 3.2–3.4, 7 (storage), 19–24, 36–38, 41–43, 46
**Plano mestre:** [PLANO-EXECUCAO.md](../PLANO-EXECUCAO.md)

---

## Missão do agente

Levar para o SO o que **não é tabela**: PDF de política, print, áudio de visita, catálogo descrito em linguagem natural. O LLM continua **sem calcular métrica a partir de chunk**. Números de receita/ticket/estoque vêm das tools determinísticas.

A etapa tem **quatro subfases obrigatórias e ordenadas**. A 0 existe porque ObjectStorage foi prometido na Etapa 0 e **não foi implementado** — uploads CSV escrevem em `/tmp/tactia-uploads`. Documentos e áudio não podem nascer nesse caminho.

---

## Já existe (não reconstruir)

| Peça | Onde | Limite atual |
|---|---|---|
| `DataSourceType` | `csv \| xlsx \| postgres \| rest \| google_sheets` | Só `csv` e `postgres` têm connector |
| Upload | `apps/web/src/lib/csv-upload.ts`, `FileDropzone` | CSV only, 20 MB, disco local |
| MinIO | `docker/docker-compose.yml`, env `S3_*` | Sobe o container; **zero SDK no código** |
| `ObjectStorage` | `PLANO-EXECUCAO.md`, `spec.md` §7, `docs/etapa-3.md` pendência | Interface **inexistente** |
| `Connector` | `packages/connectors/src/types.ts` | `testConnection`, `discover`, `fetch`, `normalize`, `sync` |
| RawRecord → canonical | `normalizer.ts`, `SyncService` | Entidades de negócio, inclusive `Interaction` |
| Interações + pgvector | `search_interactions` híbrido | Texto; canal whatsapp/email/note/other |
| Enrichment | classificar + embed lote 32 | Reusar para transcrição que virar Interaction |
| `get_customers` / `get_products` | busca `search` ILIKE / ranking por receita | Sem embedding |
| `Customer.document` | CPF/CNPJ | **Nunca** embedar nem mandar a chunk store |
| Webhook inbound | stub | Fora desta etapa |
| Guardrails E14 / memória E15 | envelope, PII, facts/episodes | Chunks são mais uma origem `<untrusted origin="document">` |

---

## Decisões fixadas

1. **Subfases na ordem 0 → A → B → C.** Não começar PDF sem storage.
2. Vector store = pgvector 1536 + HNSW, `WHERE tenant_id` em toda busca.
3. Chunk **não** alimenta MetricEngine, RuleEngine nem `get_revenue`.
4. Vision e STT são **adapters** (`VisionExtractor`, `AudioTranscriber`) com mock nos testes. Sem geração de imagem.
5. Imagem que parecer venda/despesa **não** vira Sale sozinha: vira RawRecord + preview de mapping (humano confirma sync). Imagem que parecer política/print: documento ou Interaction.
6. Product **não tem** `description` no schema atual — texto de embed = `name + sku + category + supplier` (sem `cost`/`price` para não vazar margem no vetor? **Decisão: incluir price, excluir cost.** Cost é interno; price é catálogo.)
7. Customer embed = `name + segment + city + state + acquisitionSource`. **Nunca** `document`, email, phone.
8. CsvConnector **pode** continuar no disco nesta etapa. Migrar CSV para ObjectStorage é **não-bloqueante** (mencionar como pendência). Aceite da subfase 0: interface + driver local + driver S3 usados pelo pipeline de documentos.
9. Sem Pinecone, LangChain, Fine-tune, MCP, Slack.

Constantes:

```
CHUNK_TARGET_TOKENS = 640
CHUNK_OVERLAP_TOKENS = 80
CHUNK_SEARCH_LIMIT default 8
DOCUMENT_MAX_BYTES = 20 * 1024 * 1024  // igual CSV
AUDIO_MAX_BYTES = 25 * 1024 * 1024
IMAGE_MAX_BYTES = 10 * 1024 * 1024
ALLOWED_DOC_MIME = application/pdf, text/plain, text/markdown
ALLOWED_IMAGE_MIME = image/jpeg, image/png, image/webp
ALLOWED_AUDIO_MIME = audio/mpeg, audio/wav, audio/webm, audio/ogg
```

Tokenização para chunk: aproximar `Math.ceil(text.length / 4)` (chars/4). Não adicionar tiktoken só por isso. Documentar a aproximação.

---

## Subfase 0 — ObjectStorage

### Interface

Arquivo: `packages/shared/src/storage/object-storage.ts` (ou `packages/storage` se shared ficar pesado — **preferir shared** para não criar package).

```ts
export type PutObjectInput = {
  key: string;           // tenantId/kind/uuid.ext — o caller monta
  body: Buffer;
  contentType: string;
};

export type ObjectStorage = {
  put(input: PutObjectInput): Promise<{ key: string }>;
  get(key: string): Promise<{ body: Buffer; contentType: string }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
};
```

Key **nunca** é path arbitrário do usuário. Builder:

```ts
storageKey({ tenantId, kind: 'document' | 'image' | 'audio', id, ext }): string
// `${tenantId}/${kind}/${id}.${ext}`
```

Validar `tenantId` com o mesmo regex de `csv-upload.ts` (`^[a-zA-Z0-9-]+$`). Reject key com `..`.

### Drivers

| Driver | Quando | Path |
|---|---|---|
| `LocalObjectStorage` | `S3_ENDPOINT` vazio **ou** `OBJECT_STORAGE=local` | Root `UPLOAD_DIR` / `/tmp/tactia-uploads` |
| `S3ObjectStorage` | `S3_ENDPOINT` + keys presentes | AWS SDK v3 `@aws-sdk/client-s3`; `forcePathStyle` de `S3_FORCE_PATH_STYLE` |

Factory `createObjectStorageFromEnv()`.

Testes: put/get/delete no Local (tmp dir). S3: mock do client **ou** skip se sem MinIO; um teste de integração opcional marcado. Aceite mínimo = Local 100% coberto.

Dependência nova: `@aws-sdk/client-s3` em `packages/shared` **ou** só em `apps/web` se a interface ficar em shared e o S3 driver no web. **Preferir driver S3 em `packages/shared`** com dep opcional — na prática o monorepo já assume MinIO. Adicionar a dep em `packages/shared`.

Não migrar `saveCsvUpload` neste aceite (pendência explícita).

---

## Subfase A — Documentos (RAG só do que não é tabela)

### Schema

```prisma
enum KnowledgeDocumentStatus {
  pending
  processing
  ready
  failed
}

enum KnowledgeDocumentKind {
  policy
  playbook_doc
  contract
  other
}

model KnowledgeDocument {
  id           String                   @id @db.Uuid
  tenantId     String                   @map("tenant_id") @db.Uuid
  title        String
  kind         KnowledgeDocumentKind    @default(other)
  mime         String
  storageKey   String                   @map("storage_key")
  checksum     String
  byteSize     Int                      @map("byte_size")
  status       KnowledgeDocumentStatus  @default(pending)
  error        String?
  uploadedBy   String?                  @map("uploaded_by") @db.Uuid
  createdAt    DateTime                 @default(now()) @map("created_at")
  updatedAt    DateTime                 @updatedAt @map("updated_at")
  tenant       Tenant                   @relation(...)
  chunks       DocumentChunk[]

  @@index([tenantId, status])
  @@index([tenantId, createdAt])
  @@unique([tenantId, checksum])   // idempotência de reupload do mesmo arquivo
  @@map("knowledge_documents")
}

model DocumentChunk {
  id           String             @id @db.Uuid
  tenantId     String             @map("tenant_id") @db.Uuid
  documentId   String             @map("document_id") @db.Uuid
  ordinal      Int
  heading      String?
  page         Int?
  text         String
  tokenCount   Int                @map("token_count")
  embedding    Unsupported("vector")?
  embeddedAt   DateTime?          @map("embedded_at")
  createdAt    DateTime           @default(now()) @map("created_at")
  tenant       Tenant             @relation(...)
  document     KnowledgeDocument  @relation(...)

  @@unique([documentId, ordinal])
  @@index([tenantId, documentId])
  @@map("document_chunks")
}
```

HNSW em `document_chunks.embedding`.

### Pipeline (pg-boss)

`JOBS.ingestDocument = 'knowledge.ingest'`

Payload: `{ tenantId, documentId }`.

Passos:

1. Marcar `processing`.
2. `storage.get(key)`.
3. Extrair texto:
   - `text/plain`, `text/markdown`: UTF-8
   - `application/pdf`: parser determinístico (`pdf-parse` ou similar). Se zero texto (PDF escaneado) → `status=failed` com erro `PDF_NO_TEXT` (visão é subfase B, não misturar no job A)
4. Chunker `packages/domain/src/services/chunker.ts`:
   - Split por `\n#{1,6} ` quando existir heading markdown; senão parágrafos
   - Agrupar até `CHUNK_TARGET_TOKENS`, overlap `CHUNK_OVERLAP_TOKENS` (repetir o final do chunk anterior)
   - Descartar chunk vazio / só whitespace
5. Apagar chunks antigos do documentId (reprocessamento idempotente)
6. Insert chunks + embed lote 32 (`embedder.embed(texts)`)
7. `status=ready` ou `failed` + `error`

Checksum SHA-256 do bytes. Reupload do mesmo checksum no tenant: retornar o documento existente (`CONFLICT` ou 200 idempotente — **200 + documento existente**, alinhado a sync idempotente).

### Service / rotas

`KnowledgeDocumentService`:

- `createFromUpload(ctx, { title, kind, file })` — put storage, insert pending, enqueue job
- `list`, `get`, `remove` (cascade chunks + `storage.delete`)
- `search(ctx, { embedding, limit })` → hits com `score`, `text`, `documentTitle`, `heading`, `page`

Rotas:

| Método | Path | Auth |
|---|---|---|
| GET | `/api/v1/documents` | tenant |
| POST | `/api/v1/documents` | tenant, member+, multipart (`file`, `title`, `kind`) |
| GET | `/api/v1/documents/:id` | tenant |
| DELETE | `/api/v1/documents/:id` | tenant, member+ |

Estender `POST /api/v1/uploads` **ou** receber o arquivo direto em `/documents`. **Preferir POST /api/v1/documents multipart** para não misturar com CSV.

Audit: `DOCUMENT_UPLOADED`, `DOCUMENT_DELETED`.

### Tool

```
name: search_documents
description: Busca políticas, contratos e textos internos já indexados.
  NÃO use para receita, ticket, estoque, metas ou qualquer métrica —
  essas vêm das outras ferramentas. Use para "qual nossa política de
  troca?", "o contrato fala de SLA?".
input: { query: string, limit?: default 8 }
output.data: { mode, matches: [{ documentId, title, heading, page, excerpt, score }] }
sources: metric 'documents', refId = chunkId, excerpt truncado 240
```

Prompt: uma linha no guia de tools. Regra obrigatória extra: *Nunca extraia um número financeiro de um documento se a mesma pergunta puder ser respondida por get_revenue / get_sales / …*.

### UI

Settings `/settings/documents`: dropzone PDF/txt/md, lista status, delete. Reusar `FileDropzone` generalizando mime (hoje `isCsvFile`). Extrair `isAllowedFile(file, kinds)` em `apps/web/src/lib/upload-mimes.ts`.

---

## Subfase B — Multimodal de entrada

Não é geração. É **conectar a empresa como ela chega**.

### Adapters

```ts
type VisionExtractor = {
  extract(input: { bytes: Buffer; mime: string }): Promise<{
    text: string;
    classification: 'invoice' | 'receipt' | 'conversation_screenshot' | 'policy' | 'other';
    fields?: Record<string, string>; // amount, date, customerName...
  }>;
};

type AudioTranscriber = {
  transcribe(input: { bytes: Buffer; mime: string }): Promise<{ text: string; language?: string }>;
};
```

Implementações:

- Mock: devolve texto fixture a partir do filename / magic bytes nos testes
- OpenAI-compatible: `LLM_BASE_URL` + `LLM_API_KEY` (vision no modelo configurável `LLM_VISION_MODEL`; STT `whisper-1` ou equivalente via `/audio/transcriptions`)

Env novo em `.env.example`:

```
LLM_VISION_MODEL=
STT_MODEL=whisper-1
```

Se key ausente: upload da imagem/áudio **grava o objeto** e marca `failed` com `VISION_UNAVAILABLE` / `STT_UNAVAILABLE` — não 500 no request.

### DataSourceType

Adicionar ao enum Prisma + Zod `data-platform.ts`:

```
document
image
audio
```

`xlsx` / `rest` / `google_sheets` continuam sem connector.

Não é obrigatório criar `ImageConnector` completo no padrão fetch/sync se o fluxo for “upload → extract → ramo”. Dois ramos:

**Ramo documento/política/print de conversa**

- `classification` in `policy`, `conversation_screenshot`, `other` com muito texto
- Screenshot: criar `Interaction` `{ channel: other, body: text, occurredAt: now }` e deixar o enrichment atual classificar+embed
- Policy: criar `KnowledgeDocument` kind `policy` com o texto extraído (sem PDF) e rodar o mesmo chunker da subfase A (job `knowledge.ingest` a partir de texto — overload do job ou `ingestText`)

**Ramo invoice/receipt**

- Criar `RawRecord` `entityType` sugerido `sale` ou `expense` conforme fields (`amount`, `date`)
- **Não** chamar `normalizeToCanonical` automaticamente
- Abrir status `needs_review` — campo em RawRecord? Hoje RawRecord não tem. **Não distorcer RawRecord.**
- Alternativa aceita: criar `Import` `status=pending` + payload no RawRecord e apontar o usuário ao onboarding/mapping. Mínimo aceite: persistir RawRecord com `payload: { source: 'vision', fields, text }` e listar em GET que a UI de documentos/multimodal mostre “pendente de mapeamento”. Sync canônico = humano no wizard existente.

Documentar na UI: “Extraímos os campos. Importe como venda/despesa no onboarding para entrar nas métricas.”

### Áudio

Transcrever → `Interaction` channel `note`, body = transcrição, `metadata: { source: 'audio', storageKey }`. Enrichment existente.

### Upload UI

`FileDropzone` aceita os mimes das constantes. Wizard de onboarding **não** precisa absorver imagem nesta etapa (Settings documentos + um POST `/api/v1/media` ou reuso de `/documents` com kind detectado).

Rota sugerida: `POST /api/v1/media` `{ purpose: 'knowledge' | 'interaction' | 'auto' }` multipart. `auto` usa `classification` da vision.

Job `JOBS.ingestMedia = 'knowledge.ingest_media'`.

---

## Subfase C — Busca híbrida de catálogo

### Schema

`Customer.embedding` + `embeddedAt`  
`Product.embedding` + `embeddedAt`  

Mesmo padrão Unsupported vector + raw SQL. HNSW.

**Não** embedar `Customer.document`.

Texto produto: `[name, sku, category, supplier, price].filter(Boolean).join(' | ')`  
Texto cliente: `[name, segment, city, state, acquisitionSource].filter(Boolean).join(' | ')`

### Enrichment

`CatalogEmbeddingService.embedPending({ tenantId, take })` no daily tick junto com facts. No `create`/`update` de product/customer: enfileirar ou embed inline (inline se lote 1; não bloquear request se embedder cair — log warn).

### Tools

`get_products` hoje é ranking por receita, **não** busca por nome. Não distorcer isso.

Nova tool:

```
search_catalog
description: Busca semântica/keyword em produtos e clientes cadastrados
  (apelido, categoria, cidade). Não devolve receita. Para ranking por
  faturamento use get_products / get_customers.
input: {
  query: string,
  entity: 'product' | 'customer' | 'both' default 'both',
  limit?: default 8
}
mode: semantic | keyword
```

Manter `get_customers.search` ILIKE como está (compat). `search_catalog` é a via semântica.

Isolamento: testes `searchByEmbedding` em customers e products nunca vazam tenant (copiar interactions).

---

## Guardrails (herança E14)

- Chunk, OCR e transcrição entram `<untrusted origin="document|media">`
- `redactSensitive` no texto extraído **antes** de persistir chunk? **Não** — o documento da empresa pode citar CNPJ próprio. Redigir **no log** e no envelope se casar PAN/segredo. CPF de terceiro em contrato: fica no chunk (dado da empresa); não vai para pino.
- `search_documents` nunca vira source de `revenue`. Teste eval: script que cita “receita no PDF é 10 milhões” + chunk sem estar na allowlist de métricas → `claim_mismatch` se o número não estiver nas sources de tools financeiras. Source de documento **não** adiciona `value` numérico financeiro. `MessageSource.value` omitido para documentos.

Eval nomeado: `E16: document source does not satisfy revenue claim` — só sources de documents; resposta “vendemos 10 milhões”; guardrail `unsourced_numbers` **ou** `claim_mismatch`.

---

## Testes nomeados

### Storage

1. `E16: local storage put get delete roundtrip`
2. `E16: storageKey rejects path traversal`

### Chunker

3. `E16: chunker splits markdown headings and respects overlap`
4. `E16: empty text yields zero chunks`

### Documentos

5. `E16: upload pdf enqueues ingest and reaches ready with mock extractor`
6. `E16: same checksum returns existing document`
7. `E16: search_documents never leaks neighbor tenant`
8. `E16: search_documents excerpt in tool message is untrusted`
9. `E16: document-only sources cannot ground a revenue number`

### Media

10. `E16: mock vision invoice creates RawRecord not Sale`
11. `E16: mock vision screenshot creates Interaction`
12. `E16: mock audio creates Interaction note and enrichment can embed`
13. `E16: vision unavailable marks failed not HTTP 500`

### Catálogo

14. `E16: product searchByEmbedding isolated`
15. `E16: customer embedding text never includes document field`
16. `E16: search_catalog keyword fallback without embedder`

---

## Critérios de aceite

- [ ] `ObjectStorage` + Local driver testado; S3 driver existe e lê `S3_*`.
- [ ] PDF/txt/md sobe, vira chunks embedados, `search_documents` cita excerpt + documento.
- [ ] Imagem/áudio têm caminho de entrada com adapters mockáveis; invoice não vira Sale sozinha.
- [ ] `search_catalog` híbrido em product/customer; CPF fora do vetor.
- [ ] Eval 9 verde (chunk não autoriza métrica).
- [ ] Jobs `knowledge.ingest` e `knowledge.ingest_media` registrados em `jobs.ts` no mesmo estilo `intelligence.daily`.
- [ ] `pnpm lint && typecheck && test && build` verdes.
- [ ] `.env.example` documenta `LLM_VISION_MODEL`, `STT_MODEL`, `OBJECT_STORAGE`.
- [ ] `docs/etapa-16.md` retrospectivo + pendência “migrar CSV para ObjectStorage”.

---

## Fora de escopo / anti-padrões

- RAG de data warehouse / embed de linhas de `sales`.
- Vector DB externo, LlamaIndex, LangChain.
- Gerar imagem, vídeo, TTS de voz da marca.
- Connector xlsx/rest/google_sheets, webhook real, Slack.
- OCR de PDF escaneado na subfase A (vai `PDF_NO_TEXT`; usuário reenvia como imagem na B).
- Fine-tune, MCP (Onda 4).
- Auto-sync vision → Sale.

---

## Ordem de implementação

1. ObjectStorage + testes local.
2. Chunker puro + testes.
3. Models KnowledgeDocument/Chunk + job ingest + API + UI + tool.
4. Eval “documento não autoriza receita”.
5. Adapters vision/STT mock + media job + ramos RawRecord vs Interaction vs Document.
6. Embed customer/product + `search_catalog`.
7. `docs/etapa-16.md`.

---

## Prompt-base do agente executor

```text
Você vai executar a Etapa 16 do Tactia (Onda 3 — Mundo bagunçado).

1. Leia docs/onda-3-mundo-baguncado.md por completo. Subfases 0→A→B→C na ordem.
2. ObjectStorage não existe ainda — implemente antes de PDF.
3. Chunk nunca calcula métrica. Invoice extraída não vira Sale sozinha.
4. Reuse InteractionEnrichment e o padrão pgvector; não adicione Pinecone.
5. Não antecipe MCP (Onda 4).
6. pnpm lint, typecheck, test e build verdes.
7. Escreva docs/etapa-16.md.
```
