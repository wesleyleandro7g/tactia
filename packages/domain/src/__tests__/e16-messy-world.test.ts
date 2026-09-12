/**
 * Etapa 16 — documentos, multimodal e catálogo.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  CustomerRepository,
  DataSourceRepository,
  EMBEDDING_DIMENSIONS,
  InteractionRepository,
  KnowledgeDocumentRepository,
  MediaAssetRepository,
  MembershipRepository,
  ProductRepository,
  RawRecordRepository,
  prisma,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import { createId, type RequestContext } from '@tactia/shared';
import { LocalObjectStorage } from '@tactia/shared/storage';
import { AuditLogService } from '../services/audit-log-service';
import { CatalogEmbeddingService } from '../services/catalog-embedding-service';
import { InteractionEnrichmentService } from '../services/interaction-enrichment-service';
import { KnowledgeDocumentService } from '../services/knowledge-document-service';
import { MediaIngestService } from '../services/media-ingest-service';
import { VISION_UNAVAILABLE, type AudioTranscriber, type VisionExtractor } from '../ports/media';
import { customerEmbeddingText } from '../memory/catalog-text';
import type { TextEmbedder } from '../ports/embedder';

const SLUGS = ['e16-messy-a', 'e16-messy-b'];

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const documentsRepo = new KnowledgeDocumentRepository(prisma);
const mediaRepo = new MediaAssetRepository(prisma);
const dataSources = new DataSourceRepository(prisma);
const rawRecords = new RawRecordRepository(prisma);
const interactions = new InteractionRepository(prisma);
const productsRepo = new ProductRepository(prisma);
const customersRepo = new CustomerRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));

const unitVector = (index: number) => {
  const values = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  values[index] = 1;
  return values;
};

function keywordEmbedder(): TextEmbedder {
  return {
    async embed(texts: string[]) {
      return texts.map((text) => unitVector(/troca|furadeira|politica|política/i.test(text) ? 0 : 1));
    },
  };
}

const mockVision: VisionExtractor = {
  async extract(input) {
    const text = input.bytes.toString('utf8');
    const lower = text.toLowerCase();
    if (/invoice|nota fiscal/.test(lower)) {
      return {
        text,
        classification: 'invoice',
        fields: { amount: '1500', date: '2026-01-10', customerName: 'Ana Souza' },
      };
    }
    if (/screenshot|whatsapp|conversa/.test(lower)) {
      return { text, classification: 'conversation_screenshot' };
    }
    return { text, classification: 'other' };
  },
};

const mockAudio: AudioTranscriber = {
  async transcribe(input) {
    const text = input.bytes.toString('utf8').trim();
    return { text: text || 'Transcrição de visita comercial.', language: 'pt' };
  },
};

let tenantA: string;
let tenantB: string;
let ownerA: RequestContext;
let ownerB: RequestContext;
let storageRoot: string;
let storage: LocalObjectStorage;
let documents: KnowledgeDocumentService;
let media: MediaIngestService;

function ctx(tenantId: string, userId: string, role: RequestContext['role'] = 'owner'): RequestContext {
  return { requestId: createId(), tenantId, userId, role, ip: '127.0.0.1' };
}

function uploadFile(name: string, type: string, content: string) {
  const bytes = Buffer.from(content, 'utf8');
  return {
    name,
    type,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.documentChunk.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.knowledgeDocument.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.mediaAsset.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rawRecord.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.sale.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.interaction.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.dataSource.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  const authUsers = await prisma.authUser.findMany({
    where: { email: { endsWith: '@e16-messy.test' } },
  });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function createUser(name: string) {
  const auth = await prisma.authUser.create({
    data: { id: createId(), name, email: `${name}@e16-messy.test`, emailVerified: true },
  });
  return users.create({ externalAuthId: auth.id, name, email: `${name}@e16-messy.test` });
}

describe('E16 catalog text', () => {
  it('E16: customer embedding text never includes document field', () => {
    const text = customerEmbeddingText({
      name: 'Ana Souza',
      segment: 'varejo',
      city: 'Curitiba',
      state: 'PR',
      acquisitionSource: 'indicação',
      document: '12345678901',
      email: 'ana@example.com',
      phone: '41999999999',
    });
    expect(text).toContain('Ana Souza');
    expect(text).toContain('varejo');
    expect(text).toContain('Curitiba');
    expect(text).not.toContain('12345678901');
    expect(text).not.toContain('ana@example.com');
    expect(text).not.toContain('41999999999');
  });
});

describe('E16 messy world', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanUp();
    storageRoot = await mkdtemp(join(tmpdir(), 'e16-storage-'));
    storage = new LocalObjectStorage(storageRoot);

    const tenant = await tenants.create({ name: 'e16-a', slug: 'e16-messy-a' });
    const other = await tenants.create({ name: 'e16-b', slug: 'e16-messy-b' });
    tenantA = tenant.id;
    tenantB = other.id;

    const owner = await createUser('e16-owner-a');
    const ownerOther = await createUser('e16-owner-b');
    await memberships.create({ tenantId: tenantA, userId: owner.id, role: 'owner' });
    await memberships.create({ tenantId: tenantB, userId: ownerOther.id, role: 'owner' });
    ownerA = ctx(tenantA, owner.id, 'owner');
    ownerB = ctx(tenantB, ownerOther.id, 'owner');

    const embedder = keywordEmbedder();
    documents = new KnowledgeDocumentService({
      documents: documentsRepo,
      storage,
      auditLogs,
      embedder,
      extractor: {
        async extract() {
          return { text: '# Política de troca\nPrazo de sete dias para devolver o produto.' };
        },
      },
    });
    media = new MediaIngestService({
      media: mediaRepo,
      storage,
      dataSources,
      rawRecords,
      interactions,
      documents,
      vision: mockVision,
      transcriber: mockAudio,
      enrichment: new InteractionEnrichmentService({
        interactions,
        embedder,
      }),
    });
  });

  afterAll(async () => {
    await cleanUp();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it('E16: upload pdf enqueues ingest and reaches ready with mock extractor', async () => {
    const enqueued: Array<{ tenantId: string; documentId: string }> = [];
    const service = new KnowledgeDocumentService({
      documents: documentsRepo,
      storage,
      auditLogs,
      embedder: keywordEmbedder(),
      extractor: {
        async extract() {
          return { text: '# Política de troca\nPrazo de sete dias para devolver o produto.' };
        },
      },
      enqueueIngest: async (job) => {
        enqueued.push(job);
      },
    });

    const created = await service.createFromUpload(ownerA, {
      title: 'Política de troca',
      kind: 'policy',
      file: uploadFile('politica.pdf', 'application/pdf', '%PDF-fake-policy'),
    });
    expect(created.reused).toBe(false);
    expect(created.document.status).toBe('pending');
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.documentId).toBe(created.document.id);

    await service.ingest(enqueued[0]!);
    const ready = await service.get(ownerA, created.document.id);
    expect(ready.status).toBe('ready');
    const chunks = await documentsRepo.listChunks(created.document.id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((chunk) => /troca/i.test(`${chunk.heading ?? ''} ${chunk.text}`))).toBe(true);
  });

  it('E16: same checksum returns existing document', async () => {
    const first = await documents.createFromUpload(ownerA, {
      title: 'Contrato único',
      kind: 'contract',
      file: uploadFile('contrato.txt', 'text/plain', 'checksum-unique-e16-aaaa'),
    });
    const second = await documents.createFromUpload(ownerA, {
      title: 'Contrato de novo',
      kind: 'contract',
      file: uploadFile('contrato-copia.txt', 'text/plain', 'checksum-unique-e16-aaaa'),
    });
    expect(second.reused).toBe(true);
    expect(second.document.id).toBe(first.document.id);
  });

  it('E16: search_documents never leaks neighbor tenant', async () => {
    await documents.createFromUpload(ownerA, {
      title: 'Segredo A',
      kind: 'other',
      file: uploadFile('a.txt', 'text/plain', 'token-tenant-alpha-zzz'),
    });
    const neighbor = new KnowledgeDocumentService({
      documents: documentsRepo,
      storage,
      auditLogs,
      extractor: {
        async extract() {
          return { text: 'token-tenant-bravo-secret-yyy política vizinha' };
        },
      },
    });
    await neighbor.createFromUpload(ownerB, {
      title: 'Segredo B',
      kind: 'other',
      file: uploadFile('b.txt', 'text/plain', 'token-tenant-bravo-secret-yyy'),
    });

    const hits = await documents.search(ownerA, { query: 'token-tenant-bravo-secret-yyy' });
    expect(hits.every((hit) => hit.tenantId === tenantA)).toBe(true);
    expect(hits.some((hit) => /bravo-secret/i.test(hit.text))).toBe(false);
  });

  it('E16: mock vision invoice creates RawRecord not Sale', async () => {
    const before = await prisma.sale.count({ where: { tenantId: tenantA } });
    const asset = await media.createFromUpload(ownerA, {
      purpose: 'auto',
      file: uploadFile(
        'invoice.png',
        'image/png',
        'invoice amount=1500 date=2026-01-10 customer=Ana Souza',
      ),
    });
    expect(asset.status).toBe('ready');
    expect(asset.resultKind).toBe('raw_record');
    expect(asset.classification).toBe('invoice');

    const record = await prisma.rawRecord.findFirst({
      where: { tenantId: tenantA, id: asset.resultId ?? undefined },
    });
    expect(record).toBeTruthy();
    expect(record?.entityType).toBe('sale');
    const payload = record?.payload as { source?: string };
    expect(payload.source).toBe('vision');
    expect(await prisma.sale.count({ where: { tenantId: tenantA } })).toBe(before);
  });

  it('E16: mock vision screenshot creates Interaction', async () => {
    const asset = await media.createFromUpload(ownerA, {
      purpose: 'interaction',
      file: uploadFile(
        'print.png',
        'image/png',
        'screenshot whatsapp conversa: o cliente pediu prazo maior na entrega amanhã',
      ),
    });
    expect(asset.status).toBe('ready');
    expect(asset.resultKind).toBe('interaction');
    const interaction = await prisma.interaction.findFirst({
      where: { tenantId: tenantA, id: asset.resultId ?? undefined },
    });
    expect(interaction?.channel).toBe('other');
    expect(interaction?.body).toMatch(/prazo/i);
  });

  it('E16: mock audio creates Interaction note and enrichment can embed', async () => {
    const asset = await media.createFromUpload(ownerA, {
      purpose: 'interaction',
      file: uploadFile('visita.mp3', 'audio/mpeg', 'Visita comercial: cliente quer repor a furadeira.'),
    });
    expect(asset.status).toBe('ready');
    expect(asset.classification).toBe('audio');
    const interaction = await prisma.interaction.findFirst({
      where: { tenantId: tenantA, id: asset.resultId ?? undefined },
    });
    expect(interaction?.channel).toBe('note');
    const pending = await interactions.findPendingEnrichment({ tenantId: tenantA });
    expect(pending.some((row) => row.id === interaction?.id)).toBe(false);
  });

  it('E16: vision unavailable marks failed not HTTP 500', async () => {
    const offline = new MediaIngestService({
      media: mediaRepo,
      storage,
      dataSources,
      rawRecords,
      interactions,
      documents,
      vision: null,
      transcriber: mockAudio,
    });
    const asset = await offline.createFromUpload(ownerA, {
      purpose: 'auto',
      file: uploadFile('foto.png', 'image/png', 'qualquer imagem sem vision'),
    });
    expect(asset.status).toBe('failed');
    expect(asset.error).toBe(VISION_UNAVAILABLE);
  });

  it('E16: product searchByEmbedding isolated', async () => {
    const a = await productsRepo.create({ tenantId: tenantA, name: 'Furadeira A' });
    const b = await productsRepo.create({ tenantId: tenantB, name: 'Furadeira B vizinha' });
    await productsRepo.updateEmbedding({ tenantId: tenantA, id: a.id, embedding: unitVector(0) });
    await productsRepo.updateEmbedding({ tenantId: tenantB, id: b.id, embedding: unitVector(0) });

    const hits = await productsRepo.searchByEmbedding({
      tenantId: tenantA,
      embedding: unitVector(0),
      limit: 10,
    });
    expect(hits.every((hit) => hit.tenantId === tenantA)).toBe(true);
    expect(hits.some((hit) => hit.id === b.id)).toBe(false);
  });

  it('E16: search_catalog keyword fallback without embedder', async () => {
    await productsRepo.create({ tenantId: tenantA, name: 'Furadeira X99 Azul' });
    const keywordOnly = new CatalogEmbeddingService(productsRepo, customersRepo);
    const result = await keywordOnly.search(ownerA, { query: 'Furadeira X99', entity: 'product' });
    expect(result.mode).toBe('keyword');
    expect(result.products.some((product) => product.name === 'Furadeira X99 Azul')).toBe(true);
    expect(result.products.some((product) => 'cost' in product)).toBe(false);
    expect(result.customers).toEqual([]);
  });
});
