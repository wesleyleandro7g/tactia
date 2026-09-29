/**
 * Etapa 16 — tools de documentos/catálogo e guardrail de chunk.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  CustomerRepository,
  KnowledgeDocumentRepository,
  MembershipRepository,
  ProductRepository,
  prisma,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import {
  AuditLogService,
  CatalogEmbeddingService,
  KnowledgeDocumentService,
} from '@tactia/domain';
import { createId, type RequestContext } from '@tactia/shared';
import { LocalObjectStorage } from '@tactia/shared/storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLLMAdapter } from '../adapters/mock-llm-adapter';
import { Orchestrator } from '../orchestrator';
import { ToolRegistry } from '../tool-registry';
import { createDefaultTools } from '../tools/index';
import { createSearchCatalogTool } from '../tools/search-catalog';
import { createSearchDocumentsTool } from '../tools/search-documents';
import type { ToolDeps } from '../tools/shared';
import type { ToolContext } from '../types';

const SLUGS = ['e16-ai-a', 'e16-ai-b-iso'];
const PERIOD = { from: '2025-01-01T00:00:00.000Z', to: '2025-02-01T00:00:00.000Z' };

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));

let ctxA: ToolContext;
let storageRoot: string;

function toolContext(partial: Pick<RequestContext, 'tenantId' | 'userId' | 'role'>): ToolContext {
  return { requestId: createId(), ip: '127.0.0.1', ...partial } as ToolContext;
}

function emptyContext() {
  return {
    async build() {
      return {
        company: {
          id: 'tenant-1',
          name: 'Demo',
          currency: 'BRL',
          timezone: 'America/Sao_Paulo',
          today: '2025-01-31',
          weekday: 'sexta-feira',
          daysLeftInMonth: 1,
          daysElapsedInMonth: 31,
        },
        period: PERIOD,
        trailing30: [],
        trailingPeriod: PERIOD,
        goals: [],
        facts: [],
        playbooks: [],
        briefing: null,
        metrics: [],
        insights: [],
        sources: [],
      };
    },
  };
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.documentChunk.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.knowledgeDocument.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  const authUsers = await prisma.authUser.findMany({
    where: { email: { endsWith: '@e16-ai.test' } },
  });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();
  storageRoot = await mkdtemp(join(tmpdir(), 'e16-ai-'));
  const authA = await prisma.authUser.create({
    data: { id: createId(), name: 'A', email: 'a@e16-ai.test', emailVerified: true },
  });
  const userA = await users.create({
    externalAuthId: authA.id,
    name: 'A',
    email: 'a@e16-ai.test',
  });
  const tenantA = await tenants.create({ name: 'e16-ai-a', slug: 'e16-ai-a' });
  await memberships.create({ tenantId: tenantA.id, userId: userA.id, role: 'owner' });
  ctxA = toolContext({ tenantId: tenantA.id, userId: userA.id, role: 'owner' });
});

afterAll(async () => {
  await cleanUp();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe('E16 tools and guardrails', () => {
  it('E16: search_documents excerpt in tool message is untrusted', async () => {
    const searchTool = createSearchDocumentsTool({
      documents: {
        search: async () => [
          {
            id: 'chunk-1',
            documentId: 'doc-1',
            documentTitle: 'Política',
            heading: null,
            page: null,
            text: 'Prazo de troca de sete dias.',
          },
        ],
      },
    } as unknown as ToolDeps);

    const llm = new MockLLMAdapter({
      script: [
        { toolCalls: [{ name: 'search_documents', input: { query: 'troca' } }] },
        { text: 'A política fala em prazo de troca.' },
      ],
    });
    const orchestrator = new Orchestrator({
      llm,
      tools: new ToolRegistry([searchTool]),
      contextBuilder: emptyContext(),
    });

    await orchestrator.run({ ctx: ctxA, question: 'Qual a política de troca?' });
    const toolMessage = llm.requests[1]?.messages.find((message) => message.role === 'tool');
    if (toolMessage?.role !== 'tool') throw new Error('expected tool message');
    expect(String(toolMessage.output)).toContain('origin=\\"document\\"');
    expect(String(toolMessage.output)).toContain('<untrusted origin="tool" name="search_documents">');
  });

  it('E16: document-only sources cannot ground a revenue number', async () => {
    const searchTool = createSearchDocumentsTool({
      documents: {
        search: async () => [
          {
            id: 'chunk-1',
            documentId: 'doc-1',
            documentTitle: 'Relatório',
            heading: null,
            page: null,
            text: 'A receita no PDF é 10 milhões',
          },
        ],
      },
    } as unknown as ToolDeps);

    const llm = new MockLLMAdapter({
      script: [
        { toolCalls: [{ name: 'search_documents', input: { query: 'receita' } }] },
        { text: 'Vendemos R$ 10.000.000.' },
      ],
    });
    const orchestrator = new Orchestrator({
      llm,
      tools: new ToolRegistry([searchTool]),
      contextBuilder: emptyContext(),
    });

    const answer = await orchestrator.run({ ctx: ctxA, question: 'Quanto vendemos?' });
    expect(['unsourced_numbers', 'claim_mismatch']).toContain(answer.guardrail);
    expect(answer.content).not.toContain('10.000.000');
    expect(answer.sources.some((source) => source.value != null)).toBe(false);
    expect(answer.content).not.toContain('Não consegui cruzar');
  });

  it('E16: search_catalog keyword fallback without embedder', async () => {
    await new ProductRepository(prisma).create({
      tenantId: ctxA.tenantId,
      name: 'Parafusadeira Z42',
      sku: 'Z42',
    });
    const catalog = new CatalogEmbeddingService(
      new ProductRepository(prisma),
      new CustomerRepository(prisma),
    );
    const tool = createSearchCatalogTool({ catalog } as ToolDeps);
    const result = await tool.execute(ctxA, { query: 'Parafusadeira Z42', entity: 'product' });
    const data = result.data as {
      mode: string;
      products: Array<Record<string, unknown>>;
      customers: Array<Record<string, unknown>>;
    };
    expect(data.mode).toBe('keyword');
    expect(data.products.some((product) => product.name === 'Parafusadeira Z42')).toBe(true);
    expect(data.products.some((product) => 'document' in product || 'cost' in product)).toBe(false);
  });

  it('registers search_documents and search_catalog', () => {
    const names = createDefaultTools({} as ToolDeps).map((tool) => tool.name);
    expect(names).toContain('search_documents');
    expect(names).toContain('search_catalog');
    expect(names).toContain('get_data_catalog');
    expect(names).toContain('query_business_data');
    expect(names).toContain('aggregate_business_data');
  });
});

describe('E16 search_documents isolation', () => {
  it('E16: search_documents never leaks neighbor tenant', async () => {
    const storage = new LocalObjectStorage(storageRoot);
    const docs = new KnowledgeDocumentService({
      documents: new KnowledgeDocumentRepository(prisma),
      storage,
      auditLogs,
      extractor: {
        async extract(input) {
          return { text: input.bytes.toString('utf8') };
        },
      },
    });
    const other = await tenants.create({ name: 'e16-ai-b', slug: 'e16-ai-b-iso' });
    const authB = await prisma.authUser.create({
      data: { id: createId(), name: 'B', email: 'b@e16-ai.test', emailVerified: true },
    });
    const userB = await users.create({
      externalAuthId: authB.id,
      name: 'B',
      email: 'b@e16-ai.test',
    });
    await memberships.create({ tenantId: other.id, userId: userB.id, role: 'owner' });
    const ctxB = toolContext({ tenantId: other.id, userId: userB.id, role: 'owner' });

    const bytes = (text: string) => {
      const buffer = Buffer.from(text, 'utf8');
      return {
        name: 'doc.txt',
        type: 'text/plain',
        arrayBuffer: async () =>
          buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      };
    };

    await docs.createFromUpload(ctxA, {
      title: 'Doc A',
      file: bytes('politica-alpha-somente-aqui'),
    });
    await docs.createFromUpload(ctxB, {
      title: 'Doc B',
      file: bytes('politica-bravo-vizinho-secreto'),
    });

    const tool = createSearchDocumentsTool({ documents: docs } as ToolDeps);
    const result = await tool.execute(ctxA, { query: 'politica-bravo-vizinho-secreto' });
    const data = result.data as { matches: Array<{ excerpt: string; title: string }> };
    expect(data.matches.some((match) => /bravo-vizinho/i.test(match.excerpt))).toBe(false);

    await prisma.documentChunk.deleteMany({ where: { tenantId: other.id } });
    await prisma.knowledgeDocument.deleteMany({ where: { tenantId: other.id } });
    await prisma.membership.deleteMany({ where: { tenantId: other.id } });
    await prisma.user.deleteMany({ where: { id: userB.id } });
    await prisma.authUser.deleteMany({ where: { id: authB.id } });
    await prisma.tenant.deleteMany({ where: { id: other.id } });
  });
});
