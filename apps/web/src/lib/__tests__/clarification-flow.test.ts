/**
 * Evidence clarification integration (Fluxo D): Ops prepares one contextual
 * question, the send revalidates the gap and the contact policy, and the reply
 * becomes a `reported` evidence linked to the gap. Silence or an ambiguous reply
 * never confirms anything and never closes the gap.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.LLM_PROVIDER = 'mock';
  process.env.JOBS_ENABLED = 'false';
});

const sent: Array<{ number: string; text: string }> = [];

vi.mock('@/lib/evolution', () => ({
  sendWhatsappText: vi.fn(async (number: string, text: string) => {
    sent.push({ number, text });
  }),
  sendWhatsappImage: vi.fn(async () => {}),
}));

import {
  EvidenceClarificationRepository,
  MembershipRepository,
  prisma,
  TenantRepository,
  UserRepository,
  WhatsappAuthorizedNumberRepository,
} from '@tactia/database';
import { EvidenceClarificationService } from '@tactia/domain';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { runEvidenceClarificationJob } from '../clarification-worker';

const SLUG = 'clarification-co';
const PHONE = '5511955550000';
const repository = new EvidenceClarificationRepository(prisma);
const service = new EvidenceClarificationService(repository);
const operator: RequestContext = {
  requestId: 'clarification-test',
  tenantId: null,
  userId: null,
  role: null,
  operatorId: createId(),
};

let tenantId: string;
let numberId: string;

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: SLUG } });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }
  const authUsers = await prisma.authUser.findMany({
    where: { email: { endsWith: '@clarification.test' } },
  });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
}

async function createGap(dedupeKey: string) {
  return prisma.evidenceGap.create({
    data: {
      id: createId(),
      tenantId,
      subject: 'Retorno do contato com a Empresa X',
      reason: 'A fonte não confirma se houve resposta.',
      impact: 'high',
      status: 'new',
      dedupeKey,
    },
  });
}

/** Business hours in São Paulo on a Tuesday. */
const businessHours = new Date('2026-09-29T15:00:00Z');

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();
  const tenant = await new TenantRepository(prisma).create({ name: 'clarification', slug: SLUG });
  tenantId = tenant.id;
  const auth = await prisma.authUser.create({
    data: {
      id: createId(),
      name: 'clarification-owner',
      email: 'owner@clarification.test',
      emailVerified: true,
    },
  });
  const user = await new UserRepository(prisma).create({
    externalAuthId: auth.id,
    name: 'clarification-owner',
    email: 'owner@clarification.test',
  });
  await new MembershipRepository(prisma).create({ tenantId, userId: user.id, role: 'owner' });
  const number = await new WhatsappAuthorizedNumberRepository(prisma).create({
    tenantId,
    userId: user.id,
    phone: PHONE,
    contactName: 'João',
    contactRole: 'Vendedor',
  });
  numberId = number.id;
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

beforeEach(async () => {
  sent.length = 0;
  await prisma.evidenceClarification.deleteMany({ where: { tenantId } });
  await prisma.operationalEvidence.deleteMany({ where: { tenantId } });
  await prisma.evidenceGap.deleteMany({ where: { tenantId } });
  await prisma.whatsappAgentConfig.deleteMany({ where: { tenantId } });
});

async function enableClarifications() {
  await prisma.whatsappAgentConfig.create({
    data: {
      id: createId(),
      tenantId,
      clarificationsEnabled: true,
      clarificationStartHour: 0,
      clarificationEndHour: 24,
      clarificationMaxPerDay: 2,
      clarificationCooldownHours: 1,
      clarificationWeekdays: [0, 1, 2, 3, 4, 5, 6],
    },
  });
}

describe('evidence clarification', () => {
  it('refuses to prepare a question when the company did not opt in', async () => {
    const gap = await createGap('gap:opt-out');
    await expect(
      service.prepare(operator, gap.id, { numberId, question: 'Houve retorno da Empresa X?' }, businessHours),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(await prisma.evidenceClarification.count({ where: { tenantId } })).toBe(0);
  });

  it('sends once, records the reply as reported evidence and resolves the gap', async () => {
    await enableClarifications();
    const gap = await createGap('gap:answered');
    const prepared = await service.prepare(
      operator,
      gap.id,
      { numberId, question: 'Sobre o contato com a Empresa X: houve retorno?' },
      businessHours,
    );

    // Preparing twice must not create a second question for the same gap.
    const again = await service.prepare(
      operator,
      gap.id,
      { numberId, question: 'Pergunta duplicada' },
      businessHours,
    );
    expect(again.id).toBe(prepared.id);

    await runEvidenceClarificationJob(tenantId, prepared.id);
    expect(sent).toEqual([
      { number: PHONE, text: 'Sobre o contato com a Empresa X: houve retorno?' },
    ]);

    const received = await service.receiveInbound({
      tenantId,
      numberId,
      text: 'Sim, o cliente respondeu ontem e pediu proposta.',
      messageId: 'wamid-answer-1',
    });
    expect(received).toMatchObject({ handled: true, clear: true });

    const evidence = await prisma.operationalEvidence.findMany({ where: { tenantId } });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      kind: 'reported',
      origin: 'whatsapp',
      externalRef: 'whatsapp-message:wamid-answer-1',
    });

    const refreshed = await prisma.evidenceGap.findUnique({ where: { id: gap.id } });
    expect(refreshed?.status).toBe('resolved');

    // A replay of the same inbound must not duplicate anything.
    const replay = await service.receiveInbound({
      tenantId,
      numberId,
      text: 'Sim, o cliente respondeu ontem e pediu proposta.',
      messageId: 'wamid-answer-1',
    });
    expect(replay.handled).toBe(false);
    expect(await prisma.operationalEvidence.count({ where: { tenantId } })).toBe(1);
  });

  it('keeps an ambiguous reply without confirmation and does not close the gap', async () => {
    await enableClarifications();
    const gap = await createGap('gap:ambiguous');
    const prepared = await service.prepare(
      operator,
      gap.id,
      { numberId, question: 'Houve retorno da Empresa X?' },
      businessHours,
    );
    await runEvidenceClarificationJob(tenantId, prepared.id);

    const received = await service.receiveInbound({
      tenantId,
      numberId,
      text: 'não sei, vou verificar',
      messageId: 'wamid-ambiguous-1',
    });
    expect(received).toMatchObject({ handled: true, clear: false });

    const refreshed = await prisma.evidenceGap.findUnique({ where: { id: gap.id } });
    expect(refreshed?.status).toBe('in_progress');
    expect(refreshed?.resolvedAt).toBeNull();
    const clarification = await prisma.evidenceClarification.findUnique({
      where: { id: prepared.id },
    });
    expect(clarification?.status).toBe('ambiguous');
  });

  it('cancels the question without contacting anyone when the gap was resolved meanwhile', async () => {
    await enableClarifications();
    const gap = await createGap('gap:resolved-before-send');
    const prepared = await service.prepare(
      operator,
      gap.id,
      { numberId, question: 'Houve retorno da Empresa X?' },
      businessHours,
    );
    await prisma.evidenceGap.update({
      where: { id: gap.id },
      data: { status: 'resolved', resolvedAt: new Date() },
    });

    await runEvidenceClarificationJob(tenantId, prepared.id);

    expect(sent).toEqual([]);
    const clarification = await prisma.evidenceClarification.findUnique({
      where: { id: prepared.id },
    });
    expect(clarification?.status).toBe('cancelled');
  });

  it('does not contact the person twice for the same day budget', async () => {
    await prisma.whatsappAgentConfig.create({
      data: {
        id: createId(),
        tenantId,
        clarificationsEnabled: true,
        clarificationStartHour: 0,
        clarificationEndHour: 24,
        clarificationMaxPerDay: 1,
        clarificationCooldownHours: 1,
        clarificationWeekdays: [0, 1, 2, 3, 4, 5, 6],
      },
    });
    const first = await createGap('gap:budget-1');
    const prepared = await service.prepare(
      operator,
      first.id,
      { numberId, question: 'Primeira pergunta?' },
      businessHours,
    );
    await runEvidenceClarificationJob(tenantId, prepared.id);
    expect(sent).toHaveLength(1);

    const second = await createGap('gap:budget-2');
    await expect(
      service.prepare(operator, second.id, { numberId, question: 'Segunda pergunta?' }, businessHours),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(sent).toHaveLength(1);
  });

  it('records only one evidence when two replies arrive concurrently', async () => {
    await enableClarifications();
    const gap = await createGap('gap:concurrent');
    const prepared = await service.prepare(
      operator,
      gap.id,
      { numberId, question: 'Houve retorno da Empresa X?' },
      businessHours,
    );
    await runEvidenceClarificationJob(tenantId, prepared.id);

    const [first, second] = await Promise.all([
      service.receiveInbound({
        tenantId,
        numberId,
        text: 'Sim, houve retorno.',
        messageId: 'wamid-race-1',
      }),
      service.receiveInbound({
        tenantId,
        numberId,
        text: 'Sim, confirmado.',
        messageId: 'wamid-race-2',
      }),
    ]);

    expect([first.handled, second.handled].filter(Boolean)).toHaveLength(1);
    expect(await prisma.operationalEvidence.count({ where: { tenantId } })).toBe(1);
  });

  it('ignores an unrelated inbound message when nothing is pending', async () => {
    const received = await service.receiveInbound({
      tenantId,
      numberId,
      text: 'quanto vendemos hoje?',
      messageId: 'wamid-unrelated-1',
    });
    expect(received.handled).toBe(false);
    expect(await prisma.operationalEvidence.count({ where: { tenantId } })).toBe(0);
  });
});
