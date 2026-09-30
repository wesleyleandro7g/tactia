import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@tactia/database';
import { createId } from '@tactia/shared';
import { seedCommandCenter } from '../../scripts/seed-command-center';

const tenantId = createId();
const userId = createId();
const now = new Date('2026-09-29T12:00:00Z');

beforeAll(async () => {
  await prisma.tenant.create({ data: { id: tenantId, name: 'Seed Test', slug: `seed-${tenantId}` } });
  const customerId = createId();
  await prisma.customer.create({ data: { id: customerId, tenantId, name: 'Cliente sintético', status: 'active' } });
  await prisma.sale.createMany({ data: [
    { id: createId(), tenantId, customerId, totalAmount: 1000, status: 'confirmed', soldAt: new Date('2026-08-12T12:00:00Z') },
    { id: createId(), tenantId, customerId, totalAmount: 1200, status: 'confirmed', soldAt: new Date('2026-09-12T12:00:00Z') },
  ] });
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('command center demo seed', () => {
  it('creates a navigable scenario and does not duplicate it on rerun', async () => {
    const first = await seedCommandCenter(tenantId, userId, now);
    const second = await seedCommandCenter(tenantId, userId, now);
    expect(second).toEqual(first);
    expect(await prisma.goal.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.plan.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.dataSource.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.recommendation.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.evidenceGap.count({ where: { tenantId } })).toBe(1);

    const plan = await prisma.plan.findUniqueOrThrow({
      where: { id: first.planId },
      include: { measurementDefinitions: { include: { reviews: true } }, steps: true },
    });
    expect(plan.status).toBe('active');
    expect(plan.recommendationId).toBeNull();
    expect(plan.steps).toHaveLength(2);
    expect(plan.measurementDefinitions).toHaveLength(1);
    expect(plan.measurementDefinitions[0]?.reviews).toHaveLength(1);
    expect(Number(plan.measurementDefinitions[0]?.reviews[0]?.observed)).toBe(1200);
  });
});
