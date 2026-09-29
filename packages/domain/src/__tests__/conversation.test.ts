/**
 * ConversationService integration tests (Etapa 6).
 *
 * Covers chat persistence and its access rules:
 * - messages keep the assistant evidence in `metadata.sources` (spec §43)
 * - conversations are personal: another member cannot read them
 * - another tenant never sees the conversation (spec §34)
 * - creation writes a CONVERSATION_CREATED audit log
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  ConversationRepository,
  MembershipRepository,
  MessageRepository,
  prisma,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { AuditLogService } from '../services/audit-log-service';
import { ConversationService } from '../services/conversation-service';

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const auditLogRepository = new AuditLogRepository(prisma);
const auditLogs = new AuditLogService(auditLogRepository);

const conversationService = new ConversationService(
  new ConversationRepository(prisma),
  new MessageRepository(prisma),
  auditLogs,
);

const TEST_SLUGS = ['chat-co', 'chat-other-co'];

const SOURCES = [
  {
    metric: 'revenue',
    period: { from: '2025-01-01T00:00:00.000Z', to: '2025-02-01T00:00:00.000Z' },
    value: 1000,
    tool: 'get_revenue',
  },
];

function context(
  partial: Pick<RequestContext, 'tenantId' | 'userId' | 'role'>,
): RequestContext {
  return { requestId: createId(), ip: '127.0.0.1', ...partial };
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: TEST_SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;

  await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });

  const authUsers = await prisma.authUser.findMany({ where: { email: { endsWith: '@chat.local' } } });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function createUser(name: string) {
  const auth = await prisma.authUser.create({
    data: { id: createId(), name, email: `${name}@chat.local`, emailVerified: true },
  });
  return users.create({ externalAuthId: auth.id, name, email: `${name}@chat.local` });
}

let ownerCtx: RequestContext;
let memberCtx: RequestContext;
let adminCtx: RequestContext;
let otherTenantCtx: RequestContext;

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();

  const tenant = await tenants.create({ name: 'chat-co', slug: 'chat-co' });
  const otherTenant = await tenants.create({ name: 'chat-other-co', slug: 'chat-other-co' });

  const owner = await createUser('owner');
  const member = await createUser('member');
  const admin = await createUser('admin');
  const outsider = await createUser('outsider');

  await memberships.create({ tenantId: tenant.id, userId: owner.id, role: 'owner' });
  await memberships.create({ tenantId: tenant.id, userId: member.id, role: 'member' });
  await memberships.create({ tenantId: tenant.id, userId: admin.id, role: 'admin' });
  await memberships.create({ tenantId: otherTenant.id, userId: outsider.id, role: 'owner' });

  ownerCtx = context({ tenantId: tenant.id, userId: owner.id, role: 'owner' });
  memberCtx = context({ tenantId: tenant.id, userId: member.id, role: 'member' });
  adminCtx = context({ tenantId: tenant.id, userId: admin.id, role: 'admin' });
  otherTenantCtx = context({ tenantId: otherTenant.id, userId: outsider.id, role: 'owner' });
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('ConversationService', () => {
  it('creates a conversation, audits it and renames it from the first message', async () => {
    const conversation = await conversationService.create(ownerCtx, {});
    expect(conversation.title).toBe('Nova conversa');

    const audit = await auditLogRepository.list({
      tenantId: ownerCtx.tenantId!,
      action: 'CONVERSATION_CREATED',
      skip: 0,
      take: 10,
    });
    expect(audit.items.some((entry) => entry.entityId === conversation.id)).toBe(true);

    await conversationService.appendMessage(ownerCtx, conversation.id, {
      role: 'user',
      content: 'Quanto vendemos este mês?',
    });
    const renamed = await conversationService.renameFromFirstMessage(
      ownerCtx,
      conversation.id,
      'Quanto vendemos este mês?',
    );
    expect(renamed.title).toBe('Quanto vendemos este mês?');
  });

  it('stores the assistant evidence in the message metadata', async () => {
    const conversation = await conversationService.create(ownerCtx, { title: 'Receita' });

    await conversationService.appendMessage(ownerCtx, conversation.id, {
      role: 'user',
      content: 'Quanto vendemos?',
    });
    await conversationService.appendMessage(ownerCtx, conversation.id, {
      role: 'assistant',
      content: 'A receita foi de R$ 1.000,00 em janeiro.',
      metadata: { sources: SOURCES, provider: 'mock', model: 'mock-model' },
    });

    const loaded = await conversationService.get(ownerCtx, conversation.id);
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0]?.role).toBe('user');
    expect(loaded.messages[1]?.role).toBe('assistant');

    const metadata = loaded.messages[1]?.metadata as { sources: typeof SOURCES };
    expect(metadata.sources[0]?.metric).toBe('revenue');
    expect(metadata.sources[0]?.period?.from).toBe('2025-01-01T00:00:00.000Z');
  });

  it('persists a structured context reference with the conversation', async () => {
    const resourceId = createId();
    const conversation = await conversationService.create(ownerCtx, {
      title: 'Plano contextual',
      contextRef: {
        type: 'plan',
        resourceId,
        version: 3,
        label: 'Recuperar clientes inativos',
      },
    });
    const loaded = await conversationService.get(ownerCtx, conversation.id);
    expect(loaded.contextRef).toEqual({
      type: 'plan',
      resourceId,
      version: 3,
      label: 'Recuperar clientes inativos',
    });
    await expect(conversationService.get(otherTenantCtx, conversation.id))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('lists only the conversations of the current user', async () => {
    const mine = await conversationService.create(memberCtx, { title: 'Minha conversa' });
    await conversationService.create(ownerCtx, { title: 'Conversa do owner' });

    const page = await conversationService.list(memberCtx, {});
    expect(page.items.map((item) => item.id)).toEqual([mine.id]);
  });

  it('hides a conversation from another member of the same tenant', async () => {
    const conversation = await conversationService.create(ownerCtx, { title: 'Privada' });

    await expect(conversationService.get(memberCtx, conversation.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    // Admins can read for support/audit purposes
    await expect(conversationService.get(adminCtx, conversation.id)).resolves.toMatchObject({
      id: conversation.id,
    });
  });

  it('never exposes a conversation to another tenant', async () => {
    const conversation = await conversationService.create(ownerCtx, { title: 'Do tenant A' });

    await expect(conversationService.get(otherTenantCtx, conversation.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await expect(
      conversationService.appendMessage(otherTenantCtx, conversation.id, {
        role: 'user',
        content: 'oi',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('returns only the last N messages for the prompt', async () => {
    const conversation = await conversationService.create(ownerCtx, { title: 'Histórico' });
    for (let index = 0; index < 5; index += 1) {
      await conversationService.appendMessage(ownerCtx, conversation.id, {
        role: 'user',
        content: `mensagem ${index}`,
      });
    }

    const recent = await conversationService.recentMessages(ownerCtx, conversation.id, 2);
    expect(recent.map((message) => message.content)).toEqual(['mensagem 3', 'mensagem 4']);
  });
});
