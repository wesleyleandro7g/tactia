import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@tactia/database';
import { createId, type RequestContext } from '@tactia/shared';
import { AcquisitionLeadService } from '../services/acquisition-lead-service';

const service = new AcquisitionLeadService(prisma);
const run = createId();
const operatorId = createId();
const authId = createId();
const ids: string[] = [];
const tenantIds: string[] = [];
const ctx: RequestContext = {
  requestId: createId(),
  operatorId,
  userId: null,
  tenantId: null,
  role: null,
};
const publicCtx: RequestContext = {
  requestId: createId(),
  userId: null,
  tenantId: null,
  role: null,
};
const credentials = { hashPassword: async () => 'test-hash', issuer: 'credential' };
function input() {
  const submissionId = createId();
  ids.push(submissionId);
  return {
    submissionId,
    name: 'Teste Lead',
    email: submissionId + '@acquisition.test',
    whatsapp: '11999991234',
    company: run,
    segment: 'Serviços',
    employeeRange: '2–10',
    revenueRange: 'Prefiro não informar',
    systems: ['CRM'],
  };
}
function provision(email: string) {
  return {
    name: 'Cliente ' + run,
    slug: 'acquisition-' + createId(),
    ownerName: 'Teste Owner',
    ownerEmail: email,
    ownerPassword: 'temporary-test-password',
  };
}
beforeAll(async () => {
  await prisma.operatorAuthUser.create({
    data: { id: authId, name: 'Test', email: run + '@acquisition-ops.test', emailVerified: true },
  });
  await prisma.operator.create({
    data: {
      id: operatorId,
      externalAuthId: authId,
      name: 'Test',
      email: run + '@acquisition-ops.test',
    },
  });
});
afterAll(async () => {
  const converted = await prisma.acquisitionLead.findMany({
    where: { submissionId: { in: ids } },
    select: { tenantId: true },
  });
  tenantIds.push(...converted.flatMap((lead) => (lead.tenantId ? [lead.tenantId] : [])));
  const users = await prisma.user.findMany({
    where: { memberships: { some: { tenantId: { in: tenantIds } } } },
    select: { id: true, externalAuthId: true },
  });
  await prisma.acquisitionLead.deleteMany({ where: { submissionId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.authUser.deleteMany({
    where: { id: { in: users.map((user) => user.externalAuthId) } },
  });
  await prisma.operator.deleteMany({ where: { id: operatorId } });
  await prisma.operatorAuthUser.deleteMany({ where: { id: authId } });
  await prisma.$disconnect();
});
describe('Tactia acquisition leads', () => {
  it('captures short leads once with attribution, unknown qualification and server-owned source', async () => {
    const {
      segment: _segment,
      employeeRange: _employees,
      revenueRange: _revenue,
      systems: _systems,
      ...data
    } = input();
    const payload = {
      ...data,
      source: 'forged',
      attribution: { utm_source: 'search', utm_campaign: 'consultoria' },
    };
    await Promise.all([service.captureConsultation(payload), service.captureConsultation(payload)]);
    const lead = await prisma.acquisitionLead.findUniqueOrThrow({
      where: { submissionId: data.submissionId },
    });
    expect(lead).toMatchObject({
      source: 'landing',
      status: 'new',
      segment: null,
      employeeRange: null,
      revenueRange: null,
      systems: [],
      attribution: payload.attribution,
    });
    expect(await prisma.acquisitionLead.count({ where: { submissionId: data.submissionId } })).toBe(
      1,
    );
    expect((await service.list(ctx, { q: run })).items.map((item) => item.id)).toContain(lead.id);
    const converted = await service.convert(ctx, lead.id, provision(data.email), credentials);
    expect(converted.tenant.id).toBeTruthy();
  });
  it('discards short-form honeypots and rejects missing contact', async () => {
    const data = input();
    await service.captureConsultation({ ...data, website: 'spam' });
    expect(await prisma.acquisitionLead.count({ where: { submissionId: data.submissionId } })).toBe(
      0,
    );
    await expect(service.captureConsultation({ ...data, email: '' })).rejects.toThrow();
  });
  it('saves once under concurrent retries without overwriting the original', async () => {
    const data = input();
    await Promise.all([service.capture(data), service.capture(data)]);
    expect(await service.capture({ ...data, name: 'Changed' })).toEqual({ received: true });
    expect(await prisma.acquisitionLead.count({ where: { submissionId: data.submissionId } })).toBe(
      1,
    );
    expect(
      (
        await prisma.acquisitionLead.findUniqueOrThrow({
          where: { submissionId: data.submissionId },
        })
      ).name,
    ).toBe('Teste Lead');
  });
  it('discards honeypot submissions without creating a contact', async () => {
    const data = input();
    expect(await service.capture({ ...data, website: 'spam' })).toEqual({ received: true });
    expect(await prisma.acquisitionLead.count({ where: { submissionId: data.submissionId } })).toBe(
      0,
    );
  });
  it('allows only operators to read, change status or convert', async () => {
    const data = input();
    await service.capture(data);
    const lead = await prisma.acquisitionLead.findUniqueOrThrow({
      where: { submissionId: data.submissionId },
    });
    for (const forbidden of [
      publicCtx,
      { ...publicCtx, userId: createId(), tenantId: createId(), role: 'owner' as const },
    ]) {
      await expect(service.list(forbidden, {})).rejects.toMatchObject({ statusCode: 401 });
      await expect(service.get(forbidden, lead.id)).rejects.toMatchObject({ statusCode: 401 });
      await expect(
        service.updateStatus(forbidden, lead.id, { status: 'contacted' }),
      ).rejects.toMatchObject({ statusCode: 401 });
      await expect(
        service.convert(forbidden, lead.id, provision(data.email), credentials),
      ).rejects.toMatchObject({ statusCode: 401 });
    }
    await service.updateStatus(ctx, lead.id, { status: 'scheduled' });
    expect(
      (await service.list(ctx, { q: run, status: 'scheduled' })).items.map((item) => item.id),
    ).toContain(lead.id);
    await expect(service.updateStatus(ctx, lead.id, { status: 'converted' })).rejects.toThrow();
  });
  it('converts atomically and rejects concurrent conversion with different company data', async () => {
    const data = input();
    await service.capture(data);
    const lead = await prisma.acquisitionLead.findUniqueOrThrow({
      where: { submissionId: data.submissionId },
    });
    const results = await Promise.allSettled([
      service.convert(ctx, lead.id, provision(data.email), credentials),
      service.convert(ctx, lead.id, provision('other-' + data.email), credentials),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const converted = await service.get(ctx, lead.id);
    expect(converted.status).toBe('converted');
    const owner = await prisma.membership.findFirstOrThrow({
      where: { tenantId: converted.tenantId!, role: 'owner' },
      include: { user: true },
    });
    expect(await prisma.authAccount.count({ where: { userId: owner.user.externalAuthId } })).toBe(
      1,
    );
    expect(await prisma.auditLog.count({ where: { tenantId: converted.tenantId! } })).toBe(4);
    await expect(service.updateStatus(ctx, lead.id, { status: 'closed' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });
  it('rolls back every created record when a later operation fails', async () => {
    const data = input();
    await service.capture(data);
    const lead = await prisma.acquisitionLead.findUniqueOrThrow({
      where: { submissionId: data.submissionId },
    });
    const payload = provision(data.email);
    // Missing operator FK fails at audit insertion, after credentials and tenant were created.
    await expect(
      service.convert({ ...ctx, operatorId: createId() }, lead.id, payload, credentials),
    ).rejects.toThrow();
    expect(await prisma.tenant.count({ where: { slug: payload.slug } })).toBe(0);
    expect(await prisma.authUser.count({ where: { email: data.email } })).toBe(0);
    expect(await prisma.user.count({ where: { email: data.email } })).toBe(0);
    expect(await service.get(ctx, lead.id)).toMatchObject({ status: 'new', tenantId: null });
  });
});
