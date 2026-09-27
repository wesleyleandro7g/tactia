/**
 * WhatsApp async worker integration: runs the job lifecycle against a real
 * Postgres, mocking only the orchestrator (`@/lib/ai`) and the Evolution sender
 * (`@/lib/evolution`). Verifies the final status reply, failure reply, and that
 * a cancellation requested mid-run suppresses the success message.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.LLM_PROVIDER = 'mock';
  process.env.JOBS_ENABLED = 'false';
});

const sent: Array<{ number: string; text: string }> = [];
const orchestratorRun = vi.fn();

vi.mock('@/lib/evolution', () => ({
  sendWhatsappText: vi.fn(async (number: string, text: string) => {
    sent.push({ number, text });
  }),
  sendWhatsappImage: vi.fn(async () => {}),
}));

vi.mock('@/lib/ai', () => ({
  getOrchestrator: () => ({ run: orchestratorRun }),
  toToolContext: (ctx: unknown) => ctx,
  answerMetadata: () => ({}),
}));

import {
  MembershipRepository,
  prisma,
  TenantRepository,
  UserRepository,
  WhatsappAgentJobRepository,
  WhatsappAuthorizedNumberRepository,
} from '@tactia/database';
import { createId } from '@tactia/shared';
import { runWhatsappAgentJob } from '../whatsapp-worker';

const SLUGS = ['wa-worker-co'];
const jobs = new WhatsappAgentJobRepository(prisma);
const numbers = new WhatsappAuthorizedNumberRepository(prisma);

let tenantId: string;
let userId: string;
let numberId: string;

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.whatsappAgentJob.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.whatsappAuthorizedNumber.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  }
  const authUsers = await prisma.authUser.findMany({ where: { email: { endsWith: '@wa-worker.test' } } });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  if (ids.length > 0) await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();
  const tenant = await new TenantRepository(prisma).create({ name: 'wa-worker', slug: SLUGS[0]! });
  tenantId = tenant.id;
  const auth = await prisma.authUser.create({
    data: { id: createId(), name: 'wa-worker-owner', email: 'owner@wa-worker.test', emailVerified: true },
  });
  const user = await new UserRepository(prisma).create({
    externalAuthId: auth.id,
    name: 'wa-worker-owner',
    email: 'owner@wa-worker.test',
  });
  userId = user.id;
  await new MembershipRepository(prisma).create({ tenantId, userId, role: 'owner' });
  const number = await numbers.create({
    tenantId,
    userId,
    phone: '5511966660000',
    contactName: 'João',
    contactRole: 'Gerente',
  });
  numberId = number.id;
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

beforeEach(() => {
  sent.length = 0;
  orchestratorRun.mockReset();
});

async function enqueue() {
  return jobs.create({ tenantId, numberId, userId, requestText: 'cadastra a tarefa X' });
}

describe('runWhatsappAgentJob', () => {
  it('runs to done and sends the final status message', async () => {
    orchestratorRun.mockResolvedValue({
      content: 'Tudo feito! Criei a tarefa X.',
      followUps: [],
      sources: [],
      toolCalls: [],
      proposals: [],
      attachments: [],
      provider: 'mock',
      model: 'mock',
    });
    const job = await enqueue();
    await runWhatsappAgentJob(tenantId, job.id);

    const fresh = await jobs.findById({ tenantId, id: job.id });
    expect(fresh?.status).toBe('done');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Tudo feito');
    // channel context reached the orchestrator
    expect(orchestratorRun.mock.calls[0]![0].channel).toMatchObject({ contactName: 'João', contactRole: 'Gerente' });
  });

  it('marks failed and sends a failure reply when the orchestrator throws', async () => {
    orchestratorRun.mockRejectedValue(new Error('boom'));
    const job = await enqueue();
    await runWhatsappAgentJob(tenantId, job.id);

    const fresh = await jobs.findById({ tenantId, id: job.id });
    expect(fresh?.status).toBe('failed');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/não consegui concluir/i);
  });

  it('suppresses the success message when cancelled mid-run', async () => {
    const job = await enqueue();
    orchestratorRun.mockImplementation(async () => {
      // Simulate the user cancelling while the orchestrator is working.
      await jobs.requestCancel({ tenantId, id: job.id });
      return {
        content: 'Tudo feito!',
        followUps: [],
        sources: [],
        toolCalls: [],
        proposals: [],
        attachments: [],
        provider: 'mock',
        model: 'mock',
      };
    });
    await runWhatsappAgentJob(tenantId, job.id);

    const fresh = await jobs.findById({ tenantId, id: job.id });
    expect(fresh?.status).toBe('cancelled');
    expect(sent).toHaveLength(0);
  });

  it('does not run a job already cancelled before pickup', async () => {
    const job = await enqueue();
    await jobs.requestCancel({ tenantId, id: job.id });
    await runWhatsappAgentJob(tenantId, job.id);
    expect(orchestratorRun).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});
