/**
 * Etapa 15 — tools, contexto top-K, envelope e contrato de playbook (sem executar).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  BusinessFactRepository,
  FACT_CONTEXT_K,
  MembershipRepository,
  PlaybookRepository,
  prisma,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import {
  AuditLogService,
  BusinessFactService,
  PlaybookService,
  TenantService,
} from '@tactia/domain';
import { createId, type RequestContext } from '@tactia/shared';
import { MockLLMAdapter } from '../adapters/mock-llm-adapter';
import { ContextBuilder } from '../context-builder';
import { MockEmbeddingAdapter } from '../embeddings/mock-embedding-adapter';
import { Orchestrator } from '../orchestrator';
import { buildSystemPrompt } from '../system-prompt';
import { ToolRegistry } from '../tool-registry';
import { createDefaultTools } from '../tools/index';
import { createSearchBusinessFactsTool } from '../tools/memory';
import type { ToolDeps } from '../tools/shared';
import type { ToolContext } from '../types';

const SLUGS = ['e15-ai-a'];
const PERIOD = { from: '2025-01-01T00:00:00.000Z', to: '2025-02-01T00:00:00.000Z' };

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));
const tenantService = new TenantService(tenants, memberships, auditLogs);
const factsRepo = new BusinessFactRepository(prisma);
const playbooksRepo = new PlaybookRepository(prisma);
const embedder = new MockEmbeddingAdapter();
const factService = new BusinessFactService(factsRepo, embedder);
const playbookService = new PlaybookService(playbooksRepo, auditLogs, embedder);

let ctxA: ToolContext;

function toolContext(partial: Pick<RequestContext, 'tenantId' | 'userId' | 'role'>): ToolContext {
  return { requestId: createId(), ip: '127.0.0.1', ...partial } as ToolContext;
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.episode.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.playbook.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.businessFact.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.insight.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  const authUsers = await prisma.authUser.findMany({
    where: { email: { endsWith: '@e15-ai.test' } },
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
  const authA = await prisma.authUser.create({
    data: { id: createId(), name: 'A', email: 'a@e15-ai.test', emailVerified: true },
  });
  const userA = await users.create({
    externalAuthId: authA.id,
    name: 'A',
    email: 'a@e15-ai.test',
  });
  const tenantA = await tenants.create({ name: 'e15-ai-a', slug: 'e15-ai-a' });
  await memberships.create({ tenantId: tenantA.id, userId: userA.id, role: 'owner' });
  ctxA = toolContext({ tenantId: tenantA.id, userId: userA.id, role: 'owner' });
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('E15 tools and context', () => {
  it('E15: search_business_facts semantic mode when embedder present', async () => {
    await factService.create(ctxA, {
      kind: 'event',
      text: 'Cliente reclamou de atraso na entrega do pedido',
    });
    const tool = createSearchBusinessFactsTool({
      facts: factService,
      embedder,
    } as ToolDeps);
    const result = await tool.execute(ctxA, { query: 'reclamação de atraso' });
    const data = result.data as { mode: string; matches: Array<{ text: string }> };
    expect(data.mode).toBe('semantic');
    expect(data.matches.some((match) => /atraso/i.test(match.text))).toBe(true);
    expect(result.sources[0]?.tool).toBe('search_business_facts');
  });

  it('E15: search_business_facts keyword fallback without embedder', async () => {
    const local = new BusinessFactService(factsRepo);
    await local.create(ctxA, { kind: 'fact', text: 'Temos promoção de inverno' });
    const tool = createSearchBusinessFactsTool({ facts: local } as ToolDeps);
    const result = await tool.execute(ctxA, { query: 'promoção' });
    const data = result.data as { mode: string; matches: Array<{ text: string }> };
    expect(data.mode).toBe('keyword');
    expect(data.matches.some((match) => /promoção/i.test(match.text))).toBe(true);
  });

  it('E15: ContextBuilder.build uses top-K not full list', async () => {
    await prisma.businessFact.deleteMany({ where: { tenantId: ctxA.tenantId } });
    const match = await factService.create(ctxA, {
      kind: 'event',
      text: 'A vendedora Ana ficou de licença e o cliente reclamou de atraso',
    });
    for (let index = 0; index < 19; index += 1) {
      await factService.create(ctxA, {
        kind: 'fact',
        text: `Preferência irrelevante de café número ${index}`,
      });
    }

    const builder = new ContextBuilder({
      tenants: tenantService,
      metrics: {
        calculate: async () => {
          throw new Error('skip metric');
        },
      } as never,
      insights: {
        list: async () => ({ items: [], total: 0, page: 1, pageSize: 5 }),
      } as never,
      providers: {
        facts: async (toolCtx, query) => {
          const items = await factService.forChatContext(toolCtx, query);
          return items.map((fact) => ({
            id: fact.id,
            kind: fact.kind,
            text: fact.text,
          }));
        },
      },
    });

    const context = await builder.build(ctxA, {
      query: 'a vendedora saiu e o cliente reclamou de atraso?',
    });
    expect(context.facts.length).toBeLessThanOrEqual(FACT_CONTEXT_K);
    expect(context.facts.some((fact) => fact.id === match.id)).toBe(true);
    const prompt = buildSystemPrompt(context, ['get_revenue']);
    expect(prompt).toContain('Ana ficou de licença');
    const dumped = (prompt.match(/Preferência irrelevante de café/g) ?? []).length;
    expect(dumped).toBeLessThan(19);
  });

  it('E15: no remember_episode tool in createDefaultTools', () => {
    const tools = createDefaultTools({} as ToolDeps);
    expect(tools.some((tool) => tool.name === 'remember_episode')).toBe(false);
    expect(tools.some((tool) => tool.name === 'search_episodes')).toBe(true);
  });

  it('E15: get_playbook unknown slug returns found false', async () => {
    const registry = new ToolRegistry(
      createDefaultTools({ playbooks: playbookService } as ToolDeps),
    );
    const result = await registry.execute('get_playbook', ctxA, { slug: 'nao-existe' });
    expect(result.data).toEqual({ found: false });
  });

  it('E15: LLM tools cannot execute playbook', () => {
    expect(Object.getOwnPropertyNames(PlaybookService.prototype)).not.toContain('run');
    const names = createDefaultTools({} as ToolDeps).map((tool) => tool.name);
    expect(names).toContain('list_playbooks');
    expect(names).toContain('get_playbook');
    expect(names.some((name) => /run_playbook|execute_playbook/.test(name))).toBe(false);
  });

  it('E15: search_business_facts result is wrapped untrusted in tool message', async () => {
    const searchTool = createSearchBusinessFactsTool({
      facts: {
        searchSemantic: async () => ({
          items: [
            {
              id: 'fact-1',
              kind: 'event',
              text: 'Ana saiu',
              entityType: null,
              entityId: null,
              validFrom: null,
              validTo: null,
            },
          ],
          mode: 'semantic' as const,
        }),
      } as never,
    } as unknown as ToolDeps);

    const llm = new MockLLMAdapter({
      script: [
        { toolCalls: [{ name: 'search_business_facts', input: { query: 'Ana' } }] },
        { text: 'A Ana saiu de licença.' },
      ],
    });
    const orchestrator = new Orchestrator({
      llm,
      tools: new ToolRegistry([searchTool]),
      contextBuilder: {
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
      },
    });

    await orchestrator.run({ ctx: ctxA, question: 'A Ana saiu?' });
    const toolMessage = llm.requests[1]?.messages.find((message) => message.role === 'tool');
    if (toolMessage?.role !== 'tool') throw new Error('expected tool message');
    expect(String(toolMessage.output)).toContain(
      '<untrusted origin="tool" name="search_business_facts">',
    );
  });
});
