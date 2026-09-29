import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommandCenterRepository, prisma } from '@tactia/database';
import { CommandCenterService } from '@tactia/domain';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';

const tenantId = createId();
const otherTenantId = createId();
const userId = createId();
const authId = createId();
const goalId = createId();
const service = new CommandCenterService(new CommandCenterRepository(prisma));
const ctx: RequestContext = { requestId: 'review-decision', tenantId, userId, role: 'owner' };

beforeAll(async () => {
  await prisma.tenant.createMany({ data: [
    { id: tenantId, name: 'Review Company', slug: `review-${tenantId}` },
    { id: otherTenantId, name: 'Other Review Company', slug: `review-${otherTenantId}` },
  ] });
  await prisma.authUser.create({ data: {
    id: authId, name: 'Owner', email: `review-${authId}@test.local`, emailVerified: true,
  } });
  await prisma.user.create({ data: {
    id: userId, externalAuthId: authId, name: 'Owner', email: `review-${authId}@test.local`,
  } });
  await prisma.membership.create({ data: { id: createId(), tenantId, userId, role: 'owner' } });
  await prisma.goal.create({ data: {
    id: goalId, tenantId, title: 'Receita', metricKey: 'revenue', periodType: 'month',
    periodStart: new Date('2026-09-01T00:00:00Z'), target: 10000,
  } });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.authUser.delete({ where: { id: authId } });
  await prisma.$disconnect();
});

async function preparedPlan() {
  const plan = await service.createPlan(ctx, {
    goalId, title: 'Recuperar receita', steps: [{ title: 'Acompanhar fonte' }],
    measurement: {
      metricKey: 'revenue', indicator: 'Receita observada', unit: 'BRL',
      windowFrom: '2026-09-01T00:00:00Z', windowTo: '2026-09-30T00:00:00Z',
      baseline: 8000, sources: [{ type: 'sales' }],
      attribution: 'Variação observada sem prova causal.',
    },
  });
  const review = await service.createReview(ctx, {
    measurementDefinitionId: plan.measurementDefinitions[0]!.id,
    status: 'measured', observed: 9000,
    references: [{ source: 'sales' }], reviewedAt: '2026-09-29T12:00:00Z',
  });
  return { plan, review };
}

describe('guided result decisions', () => {
  it('records a versioned adjustment, immutable measurement snapshot and Ops work', async () => {
    const { plan, review } = await preparedPlan();
    const decision = await service.decidePlanReview(ctx, plan.id, {
      version: plan.version, reviewId: review.id, choice: 'adjust', reason: 'Rever a coorte atendida.',
    });
    expect(decision).toMatchObject({ choice: 'adjust', fromVersion: 1, toVersion: 2, status: 'paused' });
    const current = await service.getPlan(ctx, plan.id);
    expect(current.reviewDecisions[0]).toMatchObject({
      choice: 'adjust', reviewSnapshot: { baseline: '8000', observed: '9000' },
    });
    expect(current.gaps[0]).toMatchObject({ subject: 'Ajustar plano: Recuperar receita', status: 'new' });
    const events = await prisma.commandCenterEvent.findMany({ where: { tenantId, entityId: { in: [plan.id, decision.id] } } });
    expect(events.map((event) => event.name).sort()).toEqual(['decision_resolved', 'plan_created']);
    expect(events.find((event) => event.name === 'decision_resolved')?.metadata)
      .toEqual({ kind: 'plan_review', choice: 'adjust', planVersion: 2 });
    await expect(service.decidePlanReview(ctx, plan.id, {
      version: 1, reviewId: review.id, choice: 'close',
    })).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    await expect(service.decidePlanReview({ ...ctx, tenantId: otherTenantId }, plan.id, {
      version: 2, reviewId: review.id, choice: 'close',
    })).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    await service.createReview(ctx, {
      measurementDefinitionId: plan.measurementDefinitions[0]!.id,
      status: 'measured', observed: 9500,
    });
    await expect(service.decidePlanReview(ctx, plan.id, {
      version: 2, reviewId: review.id, choice: 'continue',
    })).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('continues monitoring and then closes without changing the measured result', async () => {
    const { plan, review } = await preparedPlan();
    await service.decidePlanReview(ctx, plan.id, {
      version: 1, reviewId: review.id, choice: 'continue',
    });
    const continued = await service.getPlan(ctx, plan.id);
    expect(continued).toMatchObject({ status: 'active', version: 2 });
    expect(continued.nextReviewAt).not.toBeNull();
    await service.decidePlanReview(ctx, plan.id, {
      version: 2, reviewId: review.id, choice: 'close',
    });
    const closed = await service.getPlan(ctx, plan.id);
    expect(closed).toMatchObject({ status: 'closed', version: 3 });
    expect(closed.measurementDefinitions[0]!.reviews[0]!.observed).toBe(9000);
    expect(closed.reviewDecisions).toHaveLength(2);
    await expect(service.decidePlanReview(ctx, plan.id, {
      version: 3, reviewId: review.id, choice: 'continue',
    })).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });
});
