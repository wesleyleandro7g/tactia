import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockLLMAdapter } from '@tactia/ai';
import { prisma, TenantRepository, UserRepository } from '@tactia/database';
import { createId, type RequestContext } from '@tactia/shared';
import { CompanyKnowledgeService } from '../server/company-knowledge';

const slugs = ['knowledge-co-a', 'knowledge-co-b'];
let first: string;
let second: string;
let owner: string;
let member: string;
let outsider: string;
let conversationId: string;

const knowledge = new CompanyKnowledgeService(
  prisma,
  new MockLLMAdapter({ script: [
    { text: 'A empresa decidiu priorizar clientes recorrentes neste trimestre.' },
    { text: 'A equipe planeja ampliar o atendimento nas manhãs.' },
  ] }),
  null,
);

function ctx(tenantId: string, userId: string, role: RequestContext['role']): RequestContext {
  return { requestId: createId(), tenantId, userId, role };
}

async function cleanup() {
  const tenants = await prisma.tenant.findMany({ where: { slug: { in: slugs } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants.map((tenant) => tenant.id) } } });
  const auth = await prisma.authUser.findMany({ where: { email: { endsWith: '@knowledge.test' } } });
  await prisma.user.deleteMany({ where: { externalAuthId: { in: auth.map((user) => user.id) } } });
  await prisma.authUser.deleteMany({ where: { id: { in: auth.map((user) => user.id) } } });
}

async function createUser(name: string) {
  const auth = await prisma.authUser.create({ data: {
    id: createId(), name, email: `${name}@knowledge.test`, emailVerified: true,
  } });
  return new UserRepository(prisma).create({ externalAuthId: auth.id, name, email: auth.email });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
  const tenants = new TenantRepository(prisma);
  first = (await tenants.create({ name: 'Knowledge A', slug: slugs[0]! })).id;
  second = (await tenants.create({ name: 'Knowledge B', slug: slugs[1]! })).id;
  owner = (await createUser('knowledge-owner')).id;
  member = (await createUser('knowledge-member')).id;
  outsider = (await createUser('knowledge-outsider')).id;
  await prisma.membership.createMany({ data: [
    { id: createId(), tenantId: first, userId: owner, role: 'owner' },
    { id: createId(), tenantId: first, userId: member, role: 'member' },
    { id: createId(), tenantId: second, userId: outsider, role: 'owner' },
  ] });
  conversationId = createId();
  await prisma.conversation.create({ data: { id: conversationId, tenantId: first, userId: owner, title: 'Estratégia' } });
  await prisma.message.createMany({ data: [
    { id: createId(), tenantId: first, conversationId, role: 'user', content: 'Vamos priorizar clientes recorrentes neste trimestre.' },
    { id: createId(), tenantId: first, conversationId, role: 'assistant', content: 'Entendi a prioridade.' },
  ] });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('shared company context', () => {
  it('keeps the official profile tenant-scoped and owner-controlled', async () => {
    const profile = { industry: 'Varejo', offering: 'Produtos', customers: 'Lojistas', geography: 'SP', positioning: 'Atendimento', priorities: 'Retenção' };
    await knowledge.saveProfile(ctx(first, owner, 'owner'), profile);
    expect((await knowledge.profile(ctx(first, member, 'member')))?.industry).toBe('Varejo');
    expect(await knowledge.profile(ctx(second, outsider, 'owner'))).toBeNull();
    await expect(knowledge.saveProfile(ctx(first, member, 'member'), profile)).rejects.toThrow();
  });

  it('shares summaries across members without crossing tenants and respects corrections', async () => {
    await knowledge.summarizeConversation(ctx(first, owner, 'owner'), conversationId);
    const found = await knowledge.search(ctx(first, member, 'member'), 'clientes recorrentes');
    expect(found[0]?.text).toContain('clientes recorrentes');
    expect(found[0]?.personal).toBe(false);
    expect(await knowledge.search(ctx(second, outsider, 'owner'), 'clientes recorrentes')).toEqual([]);
    const id = found[0]!.id;
    await knowledge.editSummary(ctx(first, owner, 'owner'), id, { text: 'Priorizar retenção dos clientes recorrentes.' });
    await prisma.message.create({ data: {
      id: createId(), tenantId: first, conversationId, role: 'user', content: 'Também vamos ampliar o atendimento nas manhãs.',
    } });
    await knowledge.summarizeConversation(ctx(first, owner, 'owner'), conversationId);
    expect((await knowledge.listSummaries(ctx(first, member, 'member')))[0]?.text).toBe('Priorizar retenção dos clientes recorrentes.\nA equipe planeja ampliar o atendimento nas manhãs.');
    await knowledge.deleteSummary(ctx(first, owner, 'owner'), id);
    expect(await knowledge.search(ctx(first, member, 'member'), 'clientes recorrentes')).toEqual([]);
    await knowledge.summarizeConversation(ctx(first, owner, 'owner'), conversationId);
    expect(await knowledge.listSummaries(ctx(first, member, 'member'))).toEqual([]);
  });
});
