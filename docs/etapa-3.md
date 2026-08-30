# Etapa 3 — Data Platform e Connectors

**Status:** concluída  
**Data:** 2026-08-30  
**Depende de:** [Etapa 2](./etapa-2.md)

## Entregue

### Modelo e persistência

Migration `20260830000000_data_platform` adiciona 7 novos modelos:

| Modelo | Descrição |
|---|---|
| `Credential` | Credenciais criptografadas (AES-256-GCM) |
| `DataSource` | Fonte de dados (csv, postgres, etc.) |
| `SyncJob` | Execução de sincronização com contadores |
| `RawRecord` | Registro original preservado + checksum |
| `Mapping` | Configuração declarativa campo→campo com transforms |
| `Import` | Rastreio por entidade; suporte a `idempotency_key` |
| `DataQualityReport` | Relatório pós-import com warnings e errors |

Novos enums: `DataSourceType`, `DataSourceStatus`, `SyncJobStatus`, `ImportStatus`.

Índices e constraints críticas:
- `@@unique([tenantId, dataSourceId, externalId, entityType])` em `RawRecord` — garante idempotência.
- `@unique idempotency_key` em `Import`.

### packages/connectors

Interface `Connector` (spec §36) com métodos: `testConnection`, `discover`, `fetch`, `normalize`, `sync`.

| Classe | Descrição |
|---|---|
| `CsvConnector` | Lê CSV local via `csv-parse`; detect headers; idempotência por checksum |
| `PostgresConnector` | Conexão externa `pg`; discovery via `information_schema`; fetch paginado (1 000/batch) |
| `applyTransform` | Transforms: `trim`, `number`, `date`, `currency`, `none` |
| `computeChecksum` | SHA-256 do payload ordenado — base da idempotência |
| `runDataQualityChecks` | Validações pós-import por tipo de entidade |
| `normalizeToCanonical` | Upsert canônico em Customer/Product/Seller via `externalId` |

Dependências adicionadas: `csv-parse`, `pg`, `@types/pg`.

### packages/domain

| Service | Descrição |
|---|---|
| `CredentialService` | Criptografia AES-256-GCM (`ENCRYPTION_KEY` de 32 bytes); `getDecryptedData` apenas no momento do uso |
| `DataSourceService` | CRUD + `testConnection`, `discover`, `preview`; CRUD de `Mapping` |
| `SyncService` | Orquestra lifecycle completo: `startSync` → `executeSync` inline (V0.1); data quality; audit logs |
| `ImportService` | Leitura de imports |

Novos eventos de audit: `DATA_SOURCE_CREATED`, `DATA_SOURCE_UPDATED`, `DATA_SOURCE_DELETED`, `SYNC_STARTED`, `SYNC_COMPLETED`, `SYNC_FAILED`, `IMPORT_CREATED`.

Schemas Zod em `packages/domain/src/schemas/data-platform.ts`: `createDataSourceSchema`, `createMappingSchema`, `createCredentialSchema`.

### Rotas API

| Método | Rota | Auth |
|---|---|---|
| GET/POST | `/api/v1/data-sources` | tenant; POST owner/admin |
| GET/PATCH/DELETE | `/api/v1/data-sources/:id` | tenant; mutação owner/admin |
| POST | `/api/v1/data-sources/:id/test-connection` | tenant |
| POST | `/api/v1/data-sources/:id/discover` | tenant |
| POST | `/api/v1/data-sources/:id/preview` | tenant |
| POST | `/api/v1/data-sources/:id/sync` | tenant member+ |
| GET/POST | `/api/v1/data-sources/:id/mappings` | tenant |
| GET/PATCH/DELETE | `/api/v1/data-sources/:id/mappings/:mappingId` | tenant |
| GET | `/api/v1/sync-jobs` | tenant |
| GET | `/api/v1/sync-jobs/:id` | tenant |
| POST | `/api/v1/sync-jobs/:id/cancel` | owner/admin |
| GET | `/api/v1/imports` | tenant |
| GET | `/api/v1/imports/:id` | tenant |
| POST | `/api/v1/webhooks/:provider/:source` | público (retorna 200 sempre) |

### Upsert canônico

Repositories `CustomerRepository`, `ProductRepository`, `SellerRepository`, `SaleRepository` receberam método `upsertByExternalId` — usa constraint `(tenantId, dataSourceId, externalId)` para find-or-update sem duplicatas.

### Testes

`sync-idempotency.test.ts` (4 testes):
- Sync CSV de fixture → 3 raw records criados.
- Segundo sync com mesmo CSV → ainda 3 raw records (zero duplicatas).
- DataQualityReport criado com `totalRecords=3`, `validRecords=3`.
- Isolamento: outro tenant vê 0 raw records do mesmo dataSourceId.

Total: **13 testes passando** (4 novos + 9 anteriores).

## Decisões

- **SyncService inline (V0.1):** `executeSync` roda synchronously em `startSync`. Integração com pg-boss pode ser adicionada ao nível da `apps/web` sem alterar o domínio (injetar via adapter).
- **Webhooks (V0.1):** apenas recebem e logam eventos; persistência em `RawRecord` aguarda resolução de `dataSourceId` pelo caller (infraestrutura de worker é etapa posterior).
- **CredentialService expõe apenas `{ id, provider, createdAt }` via GET** — dados nunca descriptografados para o cliente.
- **CSVConnector usa `filePath` local** — S3 pode ser adicionado estendendo o config sem mudar a interface.
- **`noUncheckedIndexedAccess`** exigiu casts explícitos de `Prisma.InputJsonValue` em campos JSON não-nulos.

## Como testar manualmente

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm db:migrate:deploy
pnpm db:seed          # owner@demo.tactia / password123
pnpm dev
```

1. Login em http://localhost:3000/login.
2. `POST /api/v1/data-sources` com `{ "name": "CSV Demo", "type": "csv", "configuration": { "filePath": "/caminho/para/arquivo.csv" } }`.
3. `POST /api/v1/data-sources/:id/discover` → retorna colunas detectadas.
4. `POST /api/v1/data-sources/:id/mappings` com mapeamento campo→campo.
5. `POST /api/v1/data-sources/:id/sync` → executa sync inline.
6. `GET /api/v1/sync-jobs` → ver status e contadores.
7. `GET /api/v1/imports` → ver imports por entidade.

Testes de idempotência automatizados:

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test ENCRYPTION_KEY=<64-hex-chars> pnpm --filter @tactia/domain test
```

## Pendências (próximas etapas)

- Integração pg-boss no worker de `apps/web` para sync assíncrono (atualmente inline).
- S3/MinIO no `CsvConnector` para upload de arquivo via API (hoje usa `filePath` local).
- `SaleRepository.upsertByExternalId` não cria SaleItems em caso de update — a ser refinado na Etapa 4/5 quando o normalizer for expandido para `sale`.
- Webhook pipeline completo: resolver `dataSourceId` por provider+source, persistir em `RawRecord` e enfileirar.
