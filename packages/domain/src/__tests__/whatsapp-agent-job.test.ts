/**
 * WhatsApp agent job lifecycle: queued → running → done, plus cancellation and
 * active-job detection per number.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MembershipRepository,
  prisma,
  TenantRepository,
  UserRepository,
  WhatsappAgentJobRepository,
  WhatsappAuthorizedNumberRepository,
} from '@tactia/database';
import { createId } from '@tactia/shared';
import { WhatsappAgentJobService } from '../services/whatsapp-agent-job-service';

const SLUGS = ['wa-job-a'];

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const numbers = new WhatsappAuthorizedNumberRepository(prisma);
const service = new WhatsappAgentJobService(new WhatsappAgentJobRepository(prisma));

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
  const authUsers = await prisma.authUser.findMany({
    where: { email: { endsWith: '@wa-jobs.test' } },
  });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  if (ids.length > 0) await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

describe('WhatsappAgentJobService', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await cleanUp();
    const tenant = await tenants.create({ name: 'wa-job-a', slug: 'wa-job-a' });
    tenantId = tenant.id;
    const auth = await prisma.authUser.create({
      data: { id: createId(), name: 'wa-job-owner', email: 'owner@wa-jobs.test', emailVerified: true },
    });
    const user = await users.create({
      externalAuthId: auth.id,
      name: 'wa-job-owner',
      email: 'owner@wa-jobs.test',
    });
    userId = user.id;
    await memberships.create({ tenantId, userId, role: 'owner' });
    const number = await numbers.create({ tenantId, userId, phone: '5511977770000' });
    numberId = number.id;
  });

  afterAll(async () => {
    await cleanUp();
    await prisma.$disconnect();
  });

  it('goes queued → running → done and clears the active job', async () => {
    const job = await service.enqueue({
      tenantId,
      numberId,
      userId,
      requestText: 'cadastra a tarefa X',
      plan: 'Vou criar a tarefa X',
    });
    expect(job.status).toBe('queued');

    const active = await service.findActiveByNumber({ tenantId, numberId });
    expect(active?.id).toBe(job.id);

    expect(await service.markRunning({ tenantId, id: job.id })).toBe(true);
    // second markRunning is a no-op (already running)
    expect(await service.markRunning({ tenantId, id: job.id })).toBe(false);

    const stillActive = await service.findActiveByNumber({ tenantId, numberId });
    expect(stillActive?.status).toBe('running');

    await service.markDone({ tenantId, id: job.id });
    expect(await service.findActiveByNumber({ tenantId, numberId })).toBeNull();
  });

  it('cancels an active job', async () => {
    const job = await service.enqueue({
      tenantId,
      numberId,
      userId,
      requestText: 'envia email',
    });
    expect(await service.requestCancel({ tenantId, id: job.id })).toBe(true);
    // cancelling again is a no-op (no longer active)
    expect(await service.requestCancel({ tenantId, id: job.id })).toBe(false);
    const reread = await service.findById({ tenantId, id: job.id });
    expect(reread?.status).toBe('cancelled');
    expect(reread?.cancelRequestedAt).toBeTruthy();
  });

  it('marks failure with a truncated error', async () => {
    const job = await service.enqueue({
      tenantId,
      numberId,
      userId,
      requestText: 'faz algo',
    });
    await service.markRunning({ tenantId, id: job.id });
    await service.markFailed({ tenantId, id: job.id, error: 'boom' });
    const reread = await service.findById({ tenantId, id: job.id });
    expect(reread?.status).toBe('failed');
    expect(reread?.error).toBe('boom');
  });
});
