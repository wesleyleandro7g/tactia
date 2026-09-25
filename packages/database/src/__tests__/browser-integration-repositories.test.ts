import { afterAll, describe, expect, it } from 'vitest';
import { createId } from '@tactia/shared';
import { prisma } from '../client';
import { DataSourceRepository } from '../repositories/data-source-repository';
import { IntegrationModuleRunRepository } from '../repositories/integration-module-run-repository';
import { SyncJobRepository } from '../repositories/sync-job-repository';
import { TenantRepository } from '../repositories/tenant-repository';

const tenants = new TenantRepository(prisma);
const sources = new DataSourceRepository(prisma);
const jobs = new SyncJobRepository(prisma);
const modules = new IntegrationModuleRunRepository(prisma);
const tenantIds: string[] = [];

afterAll(async () => {
  if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('browser integration persistence', () => {
  it('returns one active SyncJob under concurrent requests', async () => {
    const id = createId();
    const tenant = await tenants.create({ name: 'Integration Lock Test', slug: `integration-lock-${id}`, timezone: 'America/Sao_Paulo', currency: 'BRL' });
    tenantIds.push(tenant.id);
    const source = await sources.create({ tenantId: tenant.id, type: 'torge', name: 'Torge synthetic', status: 'active' });
    const [a, b] = await Promise.all([
      jobs.createExclusive({ tenantId: tenant.id, dataSourceId: source.id, idempotencyKey: `manual-a-${id}` }),
      jobs.createExclusive({ tenantId: tenant.id, dataSourceId: source.id, idempotencyKey: `manual-b-${id}` }),
    ]);
    expect(a.job.id).toBe(b.job.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
  });

  it('persists external run id before execution and advances checkpoint explicitly', async () => {
    const tenantId = tenantIds[0]!;
    const source = (await sources.list({ tenantId, skip: 0, take: 1 })).items[0]!;
    const job = await jobs.findActiveByDataSource({ tenantId, dataSourceId: source.id });
    const run = await modules.start({
      tenantId,
      dataSourceId: source.id,
      syncJobId: job!.id,
      moduleKey: 'products',
      workflowKey: 'torge.products',
      workflowVersion: '1',
      parserVersion: '1',
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      externalExecutionId: `${job!.id}-products`,
    });
    expect(run.externalExecutionId).toBe(`${job!.id}-products`);
    expect(run.checkpoint).toBeNull();
    await modules.finish({ syncJobId: job!.id, moduleKey: 'products', status: 'succeeded', recordsRead: 1, recordsFailed: 0 });
    const beforePublish = (await modules.listBySyncJob({ tenantId, syncJobId: job!.id }))[0]!;
    expect(beforePublish.checkpoint).toBeNull();
    await modules.markPublished({ syncJobId: job!.id, moduleKey: 'products', checkpoint: { publishedAt: 'synthetic' } });
    const published = (await modules.listBySyncJob({ tenantId, syncJobId: job!.id }))[0]!;
    expect(published.checkpoint).toEqual({ publishedAt: 'synthetic' });
  });
});
