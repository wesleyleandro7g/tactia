import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommandCenterRepository, prisma } from '@tactia/database';
import { CommandCenterService } from '@tactia/domain';
import { createId, type RequestContext } from '@tactia/shared';

const tenantId = createId();
const otherTenantId = createId();
const emptyTenantId = createId();
const userId = createId();
const authId = createId();
const goalId = createId();
const otherGoalId = createId();
const emptyGoalId = createId();
const actionId = createId();
const otherActionId = createId();
const service = new CommandCenterService(new CommandCenterRepository(prisma));
const ctx: RequestContext = { requestId: 'cycle-review-int', tenantId, userId, role: 'owner' };
const otherCtx: RequestContext = { requestId: 'cycle-review-other', tenantId: otherTenantId, userId, role: 'owner' };
const emptyCtx: RequestContext = { requestId: 'cycle-review-empty', tenantId: emptyTenantId, userId, role: 'owner' };
const window = { from: '2026-09-01', to: '2026-09-07' };

beforeAll(async () => {
  await prisma.tenant.createMany({ data: [
    { id: tenantId, name: 'Cycle Review Co', slug: `cycle-${tenantId}` },
    { id: otherTenantId, name: 'Other Cycle Co', slug: `cycle-${otherTenantId}` },
    { id: emptyTenantId, name: 'Empty Cycle Co', slug: `cycle-${emptyTenantId}` },
  ] });
  await prisma.authUser.create({ data: {
    id: authId, name: 'Owner', email: `cycle-${authId}@test.local`, emailVerified: true,
  } });
  await prisma.user.create({ data: {
    id: userId, externalAuthId: authId, name: 'Owner', email: `cycle-${authId}@test.local`,
  } });
  await prisma.membership.createMany({ data: [
    { id: createId(), tenantId, userId, role: 'owner' },
    { id: createId(), tenantId: otherTenantId, userId, role: 'owner' },
    { id: createId(), tenantId: emptyTenantId, userId, role: 'owner' },
  ] });
  await prisma.goal.createMany({ data: [
    {
      id: goalId, tenantId, title: 'Receita', metricKey: 'revenue', periodType: 'month',
      periodStart: new Date('2026-09-01T00:00:00Z'), target: 10000, status: 'active',
    },
    {
      id: otherGoalId, tenantId: otherTenantId, title: 'Receita alheia', metricKey: 'revenue',
      periodType: 'month', periodStart: new Date('2026-09-01T00:00:00Z'), target: 5000, status: 'active',
    },
    {
      id: emptyGoalId, tenantId: emptyTenantId, title: 'Receita vazia', metricKey: 'revenue',
      periodType: 'month', periodStart: new Date('2026-09-01T00:00:00Z'), target: 1000, status: 'active',
    },
  ] });
  await prisma.action.createMany({ data: [
    {
      id: actionId, tenantId, type: 'create_task', name: 'Criar tarefa',
      description: 'Cria tarefa no processo existente.', configuration: {}, requiresApproval: false,
    },
    {
      id: otherActionId, tenantId: otherTenantId, type: 'create_task', name: 'Tarefa alheia',
      description: 'Não deve aparecer.', configuration: {}, requiresApproval: false,
    },
  ] });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId, emptyTenantId] } } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.authUser.delete({ where: { id: authId } });
  await prisma.$disconnect();
});

async function prepareMeasuredPlan(owner: RequestContext, ownerGoalId: string, title: string) {
  const plan = await service.createPlan(owner, {
    goalId: ownerGoalId,
    title,
    steps: [{ title: 'Acompanhar fonte' }],
    measurement: {
      metricKey: 'revenue',
      indicator: 'Receita observada',
      unit: 'BRL',
      windowFrom: '2026-09-01T00:00:00Z',
      windowTo: '2026-09-30T00:00:00Z',
      baseline: 8000,
      sources: [{ type: 'sales' }],
      attribution: 'Variação observada sem prova causal.',
    },
  });
  const review = await service.createReview(owner, {
    measurementDefinitionId: plan.measurementDefinitions[0]!.id,
    status: 'measured',
    observed: 9000,
    references: [{ source: 'sales' }],
    reviewedAt: '2026-09-03T12:00:00Z',
  });
  return { plan, review };
}

describe('weekly cycle review', () => {
  it('isolates companies, honors the window and keeps axes independent', async () => {
    const { plan, review } = await prepareMeasuredPlan(ctx, goalId, 'Recuperar receita');
    const decision = await service.decidePlanReview(ctx, plan.id, {
      version: plan.version,
      reviewId: review.id,
      choice: 'continue',
    });
    await prisma.planReviewDecision.update({
      where: { id: decision.id },
      data: { createdAt: new Date('2026-09-03T15:00:00Z') },
    });

    const execution = await prisma.actionExecution.create({
      data: {
        id: createId(),
        tenantId,
        actionId,
        status: 'completed',
        origin: 'system',
        input: { title: 'Contatar clientes inativos' },
        output: {},
        startedAt: new Date('2026-09-04T10:00:00Z'),
        finishedAt: new Date('2026-09-04T10:05:00Z'),
        createdAt: new Date('2026-09-04T10:00:00Z'),
      },
    });
    await service.linkExecution(ctx, plan.id, plan.steps[0]!.id, {
      actionExecutionId: execution.id,
      actionType: 'create_task',
      input: { title: plan.title, description: plan.summary ?? plan.title },
      reason: plan.title,
    });
    await prisma.actionExecution.update({
      where: { id: execution.id },
      data: {
        status: 'completed',
        startedAt: new Date('2026-09-04T10:00:00Z'),
        finishedAt: new Date('2026-09-04T10:05:00Z'),
      },
    });

    const outsideReview = await service.createReview(ctx, {
      measurementDefinitionId: plan.measurementDefinitions[0]!.id,
      status: 'measured',
      observed: 12000,
      references: [{ source: 'sales' }],
      reviewedAt: '2026-09-20T12:00:00Z',
    });
    await prisma.measurementReview.update({
      where: { id: outsideReview.id },
      data: {
        createdAt: new Date('2026-09-20T12:00:00Z'),
        reviewedAt: new Date('2026-09-20T12:00:00Z'),
      },
    });

    const other = await prepareMeasuredPlan(otherCtx, otherGoalId, 'Plano de outra empresa');
    const otherDecision = await service.decidePlanReview(otherCtx, other.plan.id, {
      version: other.plan.version,
      reviewId: other.review.id,
      choice: 'close',
    });
    await prisma.planReviewDecision.update({
      where: { id: otherDecision.id },
      data: { createdAt: new Date('2026-09-03T16:00:00Z') },
    });
    const otherExecution = await prisma.actionExecution.create({
      data: {
        id: createId(),
        tenantId: otherTenantId,
        actionId: otherActionId,
        status: 'completed',
        origin: 'system',
        input: { title: 'Segredo' },
        createdAt: new Date('2026-09-04T10:00:00Z'),
        finishedAt: new Date('2026-09-04T10:05:00Z'),
      },
    });
    await service.linkExecution(otherCtx, other.plan.id, other.plan.steps[0]!.id, {
      actionExecutionId: otherExecution.id,
      actionType: 'create_task',
      input: { title: other.plan.title, description: other.plan.summary ?? other.plan.title },
      reason: other.plan.title,
    });

    const foreignPlanGapId = createId();
    await prisma.evidenceGap.create({
      data: {
        id: foreignPlanGapId,
        tenantId,
        planId: other.plan.id,
        subject: 'Lacuna com plano de outra empresa',
        reason: 'A relação opcional precisa ser revalidada.',
        impact: 'high',
        dedupeKey: `foreign-plan:${tenantId}`,
      },
    });

    const consolidated = await service.getWeeklyCycleReview(ctx, {
      ...window,
      tenantId: otherTenantId,
    });

    expect(consolidated.tenantId).toBe(tenantId);
    expect(consolidated.inProgress.map((item) => item.planId)).toEqual([plan.id]);
    expect(consolidated.inProgress[0]).toMatchObject({
      status: 'active',
      goalStatus: 'active',
    });
    expect(consolidated.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: decision.id, kind: 'plan_review', choice: 'continue', planId: plan.id }),
    ]));
    expect(consolidated.decisions.some((item) => item.planId === other.plan.id)).toBe(false);
    expect(consolidated.executions).toEqual([
      expect.objectContaining({
        id: execution.id,
        status: 'completed',
        planId: plan.id,
        planStatus: 'active',
        actionName: 'Criar tarefa',
      }),
    ]);
    expect(consolidated.executions.some((item) => item.id === otherExecution.id)).toBe(false);
    expect(consolidated.observations).toEqual([
      expect.objectContaining({
        observed: 9000,
        availability: 'ready',
        goalStatus: 'active',
        planStatus: 'active',
      }),
    ]);
    expect(consolidated.observations.some((item) => item.observed === 12000)).toBe(false);
    const revalidated = consolidated.gaps.find((item) => item.id === foreignPlanGapId);
    expect(revalidated).toMatchObject({ planId: null, planTitle: null });
    expect(JSON.stringify(consolidated)).not.toMatch(/Segredo|Receita alheia|Tarefa alheia/);

    const later = await service.getWeeklyCycleReview(ctx, { from: '2026-09-20', to: '2026-09-21' });
    expect(later.decisions).toEqual([]);
    expect(later.executions).toEqual([]);
    expect(later.observations).toEqual([
      expect.objectContaining({ observed: 12000 }),
    ]);

    const otherReview = await service.getWeeklyCycleReview(otherCtx, window);
    expect(otherReview.inProgress.map((item) => item.planId)).toEqual([other.plan.id]);
    expect(otherReview.decisions[0]).toMatchObject({ choice: 'close', planId: other.plan.id });
    expect(otherReview.inProgress.some((item) => item.planId === plan.id)).toBe(false);
  });

  it('returns an empty state without treating absence as a commercial zero', async () => {
    const review = await service.getWeeklyCycleReview(emptyCtx, window);
    expect(review).toMatchObject({
      tenantId: emptyTenantId,
      inProgress: [],
      decisions: [],
      executions: [],
      gaps: [],
      observations: [],
    });
    expect(review.observations.some((item) => item.observed === 0)).toBe(false);
  });

  it('does not treat a completed execution as an achieved objective or causal impact', async () => {
    const plan = await service.createPlan(ctx, {
      goalId,
      title: 'Execução sem resultado atribuído',
      steps: [{ title: 'Criar tarefa' }],
      measurement: {
        metricKey: 'revenue',
        indicator: 'Receita observada',
        unit: 'BRL',
        windowFrom: '2026-09-01T00:00:00Z',
        windowTo: '2026-09-30T00:00:00Z',
        sources: [{ type: 'sales' }],
        attribution: 'Variação observada; não implica causalidade.',
      },
    });
    const execution = await prisma.actionExecution.create({
      data: {
        id: createId(),
        tenantId,
        actionId,
        status: 'completed',
        origin: 'system',
        input: { title: 'Criar tarefa' },
        createdAt: new Date('2026-09-05T09:00:00Z'),
        finishedAt: new Date('2026-09-05T09:02:00Z'),
      },
    });
    await service.linkExecution(ctx, plan.id, plan.steps[0]!.id, {
      actionExecutionId: execution.id,
      actionType: 'create_task',
      input: { title: plan.title, description: plan.summary ?? plan.title },
      reason: plan.title,
    });
    await service.createReview(ctx, {
      measurementDefinitionId: plan.measurementDefinitions[0]!.id,
      status: 'measuring',
      observed: null,
      limitation: 'Ainda sem cobertura da fonte.',
      reviewedAt: '2026-09-05T09:03:00Z',
    });

    const review = await service.getWeeklyCycleReview(ctx, window);
    const executionRow = review.executions.find((item) => item.id === execution.id);
    const observation = review.observations.find((item) => item.planId === plan.id);
    const inProgress = review.inProgress.find((item) => item.planId === plan.id);
    expect(executionRow).toMatchObject({ status: 'completed', planStatus: 'draft' });
    expect(inProgress).toMatchObject({ status: 'draft', goalStatus: 'active' });
    expect(observation).toMatchObject({
      observed: null,
      availability: 'empty',
      status: 'measuring',
      goalStatus: 'active',
    });
    expect(observation?.attribution).toMatch(/não implica causalidade/i);
  });
});
