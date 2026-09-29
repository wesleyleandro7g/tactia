import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ActionExecutionRepository,
  ActionRepository,
  ActivityRepository,
  ApprovalRepository,
  CommandCenterRepository,
  CustomerRepository,
  LeadRepository,
  SellerRepository,
  prisma,
} from '@tactia/database';
import { CommandCenterService } from '@tactia/domain';
import {
  ExecutionEngine,
  MemoryEmailSender,
  createDefaultActionRegistry,
} from '@tactia/execution';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { refreshPlanMeasurements } from '@/lib/services';

const tenantId = createId();
const goalId = createId();
const insightId = createId();
const recommendationId = createId();
const commandRepository = new CommandCenterRepository(prisma);
const commandCenter = new CommandCenterService(commandRepository);
const actions = new ActionRepository(prisma);
const executions = new ActionExecutionRepository(prisma);
const approvals = new ApprovalRepository(prisma);
const registry = createDefaultActionRegistry({
  activities: new ActivityRepository(prisma),
  customers: new CustomerRepository(prisma),
  leads: new LeadRepository(prisma),
  sellers: new SellerRepository(prisma),
  emailSender: new MemoryEmailSender(),
});
const executionEngine = new ExecutionEngine({
  actions,
  executions,
  approvals,
  registry,
  auditLogs: { record: async () => undefined } as never,
  episodes: { record: async () => undefined },
});
const ctx: RequestContext = {
  requestId: 'command-cycle',
  tenantId,
  userId: createId(),
  role: 'owner',
};

beforeAll(async () => {
  await prisma.tenant.create({
    data: { id: tenantId, name: 'Command Cycle', slug: `command-cycle-${tenantId}` },
  });
  await prisma.goal.create({
    data: {
      id: goalId,
      tenantId,
      title: 'Recuperar clientes inativos',
      status: 'active',
      metricKey: 'revenue',
      periodType: 'month',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      target: 10000,
      baselineValue: 8000,
    },
  });
  await prisma.insight.create({
    data: {
      id: insightId,
      tenantId,
      type: 'anomaly',
      severity: 'high',
      status: 'open',
      title: 'Clientes inativos detectados',
      description: 'Há clientes sem compra há 90 dias.',
      ruleKey: 'inactive_customers',
      evidence: [{ key: 'inactive_customers_count', value: 24 }],
      periodFrom: new Date('2026-08-01T00:00:00Z'),
      periodTo: new Date('2026-09-01T00:00:00Z'),
      score: 80,
      fingerprint: `inactive-customers-${tenantId}`,
    },
  });
  await prisma.recommendation.create({
    data: {
      id: recommendationId,
      tenantId,
      insightId,
      priority: 'high',
      status: 'pending',
      title: 'Retomar clientes inativos',
      description: 'Criar uma tarefa de contato no processo comercial existente.',
      actionType: 'create_task',
      metadata: {
        suggestedAction: {
          actionType: 'create_task',
          input: {
            title: 'Contatar clientes inativos',
            description: 'Priorizar clientes sem compra há 90 dias.',
          },
          reason: 'Recuperar relacionamento comercial.',
        },
      },
    },
  });
  await actions.create({
    tenantId,
    type: 'create_task',
    name: 'Criar tarefa',
    description: 'Cria tarefa no processo existente.',
    configuration: {},
    requiresApproval: true,
  });
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('recommendation → plan → decision → execution → evidence → measurement', () => {
  it('completes the transaction without a manual status update', async () => {
    const plan = await commandCenter.prepareFromRecommendation(ctx, recommendationId, { goalId });
    const replay = await commandCenter.prepareFromRecommendation(ctx, recommendationId, { goalId });
    expect(replay.id).toBe(plan.id);
    expect(plan.scope).toMatchObject({ origin: 'recommendation' });
    expect(plan.steps).toHaveLength(2);

    const firstStep = plan.steps[0]!;
    const action = (plan.scope as { suggestedAction: {
      actionType: 'create_task'; input: Record<string, unknown>; reason: string;
    } }).suggestedAction;
    const execution = await executionEngine.propose(ctx, {
      ...action,
      idempotencyKey: `plan:${plan.id}:v${plan.version}:step:${firstStep.id}`,
    });
    const linked = await commandCenter.linkExecution(ctx, plan.id, firstStep.id, {
      actionExecutionId: execution.id,
      actionType: action.actionType,
      input: action.input,
      reason: action.reason,
    });
    expect(linked.planVersion).toBe(plan.version);
    expect(linked.decisionSnapshot).toMatchObject({
      plan: { id: plan.id, version: plan.version },
      action: { type: 'create_task' },
    });

    const approvalId = linked.approvalId!;
    await expect(commandCenter.assertDecisionCurrent(ctx, approvalId)).resolves.toMatchObject({
      planId: plan.id,
      planVersion: plan.version,
    });
    const completed = await executionEngine.approve(ctx, approvalId);
    expect(completed.status).toBe('completed');
    await commandCenter.recordApprovalDecision(ctx, approvalId, 'approved');
    await commandCenter.recordApprovalDecision(ctx, approvalId, 'approved');
    expect(await prisma.commandCenterEvent.count({
      where: { tenantId, entityId: approvalId, name: 'decision_resolved' },
    })).toBe(1);

    const reconciled = await commandCenter.reconcileExecution(ctx, completed.id);
    expect(reconciled?.status).toBe('active');
    expect(reconciled?.steps[0]!.status).toBe('completed');
    expect(reconciled?.evidence[0]).toMatchObject({
      kind: 'observed',
      origin: 'action_execution',
      externalRef: `action-execution:${completed.id}`,
    });
    expect(reconciled?.measurementDefinitions[0]!.reviews[0]).toMatchObject({
      status: 'measuring',
      observed: null,
    });
    expect(await prisma.commandCenterEvent.findFirst({
      where: { tenantId, entityId: completed.id, name: 'execution_state_changed' },
    })).toMatchObject({ metadata: { status: 'completed', planId: plan.id } });

    const measurement = await refreshPlanMeasurements(
      tenantId,
      new Date('2026-09-28T12:00:00Z'),
    );
    expect(measurement).toEqual({ evaluated: 1, measured: 0, unavailable: 1 });
    const afterMeasurement = await commandCenter.getPlan(ctx, plan.id);
    expect(afterMeasurement.measurementDefinitions[0]!.reviews[0]).toMatchObject({
      status: 'measuring',
      observed: null,
      limitation: 'A métrica necessária não está disponível nas fontes atuais.',
    });
    expect(afterMeasurement.gaps).toEqual([
      expect.objectContaining({
        status: 'new',
        subject: 'Medição de Recuperar clientes inativos',
      }),
    ]);
  });

  it('distinguishes a true zero from unavailable data once coverage exists', async () => {
    const customerId = createId();
    await prisma.customer.create({
      data: { id: customerId, tenantId, name: 'Cliente com histórico' },
    });
    await prisma.sale.create({
      data: {
        id: createId(),
        tenantId,
        customerId,
        totalAmount: 500,
        soldAt: new Date('2026-08-10T12:00:00Z'),
      },
    });
    const plan = await commandCenter.prepareFromRecommendation(ctx, recommendationId, { goalId });
    const measurement = await refreshPlanMeasurements(
      tenantId,
      new Date('2026-09-28T13:00:00Z'),
    );
    expect(measurement).toEqual({ evaluated: 1, measured: 1, unavailable: 0 });
    const refreshed = await commandCenter.getPlan(ctx, plan.id);
    expect(refreshed.measurementDefinitions[0]!.reviews[0]).toMatchObject({
      status: 'measuring',
      observed: 0,
    });
    expect(refreshed.gaps[0]).toMatchObject({ status: 'resolved' });
  });

  it('rejects a tampered action before it reaches the executor', async () => {
    const plan = await commandCenter.prepareFromRecommendation(ctx, recommendationId, { goalId });
    const before = await prisma.actionExecution.count({ where: { tenantId } });
    await expect(commandCenter.validatePreparedExecution(ctx, plan.id, plan.steps[0]!.id, {
      actionType: 'create_task',
      input: { title: 'Payload alterado pelo cliente' },
      reason: 'Recuperar relacionamento comercial.',
    })).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(await prisma.actionExecution.count({ where: { tenantId } })).toBe(before);
  });

  it('blocks approval after the plan version changes', async () => {
    const plan = await commandCenter.prepareFromRecommendation(ctx, recommendationId, { goalId });
    const step = plan.steps[0]!;
    const action = (plan.scope as { suggestedAction: {
      actionType: 'create_task'; input: Record<string, unknown>; reason: string;
    } }).suggestedAction;
    const execution = await executionEngine.propose(ctx, {
      ...action,
      idempotencyKey: `plan:${plan.id}:stale-decision`,
    });
    const linked = await commandCenter.linkExecution(ctx, plan.id, step.id, {
      actionExecutionId: execution.id,
      ...action,
    });
    await prisma.plan.update({ where: { id: plan.id }, data: { version: { increment: 1 } } });
    await expect(commandCenter.assertDecisionCurrent(ctx, linked.approvalId!))
      .rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    const approval = await approvals.findById({ tenantId, id: linked.approvalId! });
    expect(approval?.status).toBe('pending');
  });
});
