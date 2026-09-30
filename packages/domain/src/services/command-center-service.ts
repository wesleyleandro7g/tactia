import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { CommandCenterRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertOwnerOrAdmin, assertOperator, assertTenantContext, assertTenantUser } from '../authz';
import { decimalToNumber } from '../utils/serialize';
import { parseCycleReviewQuery, serializeCycleReview } from './command-center-cycle-review';

export {
  CYCLE_REVIEW_DEFAULT_DAYS,
  CYCLE_REVIEW_MAX_DAYS,
  parseCycleReviewQuery,
  resolveCycleReviewWindow,
  serializeCycleReview,
} from './command-center-cycle-review';
export type {
  CycleReview,
  CycleReviewAvailability,
  CycleReviewDecision,
  CycleReviewExecution,
  CycleReviewGap,
  CycleReviewObservation,
  CycleReviewPlan,
} from './command-center-cycle-review';

const planStatusSchema = z.enum(['draft', 'active', 'paused', 'completed', 'closed']);
const measurementStatusSchema = z.enum(['measuring', 'measured', 'not_measurable', 'review_needed']);
const gapStatusSchema = z.enum(['new', 'in_progress', 'waiting_source', 'waiting_response', 'resolved', 'unresolved']);

export const createPlanSchema = z.object({
  goalId: z.string().uuid(),
  insightId: z.string().uuid().nullable().optional(),
  recommendationId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().max(1200).nullable().optional(),
  scope: z.record(z.string(), z.unknown()).default({}),
  responsibleLabel: z.string().trim().max(160).nullable().optional(),
  nextReviewAt: z.coerce.date().nullable().optional(),
  steps: z.array(z.object({
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(1000).nullable().optional(),
  })).min(1).max(20),
  measurement: z.object({
    metricKey: z.string().trim().min(1).max(120),
    indicator: z.string().trim().min(2).max(160),
    unit: z.string().trim().min(1).max(40),
    cohort: z.record(z.string(), z.unknown()).optional(),
    windowFrom: z.coerce.date(),
    windowTo: z.coerce.date(),
    baseline: z.number().finite().nullable().optional(),
    target: z.number().finite().nullable().optional(),
    sources: z.array(z.record(z.string(), z.unknown())).default([]),
    attribution: z.string().trim().min(3).max(500),
  }).refine((value) => value.windowTo >= value.windowFrom, {
    message: 'windowTo must be on or after windowFrom',
    path: ['windowTo'],
  }).optional(),
});

export const updatePlanStatusSchema = z.object({
  version: z.number().int().positive(),
  status: planStatusSchema,
});

export const decidePlanReviewSchema = z.object({
  version: z.number().int().positive(),
  reviewId: z.string().uuid(),
  choice: z.enum(['adjust', 'continue', 'close']),
  reason: z.string().trim().min(3).max(500).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.choice === 'adjust' && !value.reason) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Explain what should change' });
  }
});

export const createMeasurementReviewSchema = z.object({
  measurementDefinitionId: z.string().uuid(),
  status: measurementStatusSchema,
  observed: z.number().finite().nullable().optional(),
  operationalResults: z.array(z.record(z.string(), z.unknown())).default([]),
  references: z.array(z.record(z.string(), z.unknown())).default([]),
  limitation: z.string().trim().max(1000).nullable().optional(),
  reviewedAt: z.coerce.date().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.status === 'measured' && value.observed == null) {
    ctx.addIssue({ code: 'custom', path: ['observed'], message: 'observed is required when measured' });
  }
  if (value.status === 'not_measurable' && !value.limitation) {
    ctx.addIssue({ code: 'custom', path: ['limitation'], message: 'limitation is required when not measurable' });
  }
});

export const preparePlanFromRecommendationSchema = z.object({
  goalId: z.string().uuid(),
});

export const preparedPlanActionSchema = z.object({
  actionType: z.enum(['create_task', 'send_email']),
  input: z.record(z.string(), z.unknown()),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const linkPlanExecutionSchema = preparedPlanActionSchema.extend({
  actionExecutionId: z.string().uuid(),
});

type SuggestedAction = {
  actionType: 'create_task' | 'send_email';
  input: Record<string, unknown>;
  reason: string;
};

function suggestedActionOf(metadata: unknown, title: string, description: string): SuggestedAction {
  if (metadata && typeof metadata === 'object') {
    const candidate = (metadata as { suggestedAction?: unknown }).suggestedAction;
    if (candidate && typeof candidate === 'object') {
      const row = candidate as Record<string, unknown>;
      if (
        (row.actionType === 'create_task' || row.actionType === 'send_email') &&
        row.input &&
        typeof row.input === 'object' &&
        typeof row.reason === 'string'
      ) {
        return {
          actionType: row.actionType,
          input: row.input as Record<string, unknown>,
          reason: row.reason,
        };
      }
    }
  }
  return {
    actionType: 'create_task',
    input: { title, description },
    reason: title,
  };
}

function goalWindow(periodType: string, periodStart: Date) {
  const from = new Date(periodStart);
  const to = new Date(periodStart);
  if (periodType === 'year') to.setUTCFullYear(to.getUTCFullYear() + 1);
  else if (periodType === 'quarter') to.setUTCMonth(to.getUTCMonth() + 3);
  else to.setUTCMonth(to.getUTCMonth() + 1);
  return { from, to };
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : decimalToNumber(value);
}

type GoalRecord = Awaited<ReturnType<CommandCenterRepository['listGoals']>>[number];
type GoalForDto = Omit<GoalRecord, 'plans'> & { plans?: GoalRecord['plans'] };
type PlanRecord = Awaited<ReturnType<CommandCenterRepository['listPlans']>>[number];
type EvidenceRecord = PlanRecord['evidence'][number];

function nullableDecimalToNumber(value: unknown): number | null {
  return value == null ? null : decimalToNumber(value);
}

function serializeGoal(goal: GoalForDto) {
  return {
    ...goal,
    target: decimalToNumber(goal.target),
    baselineValue: nullableDecimalToNumber(goal.baselineValue),
    periodStart: goal.periodStart.toISOString(),
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    plans: goal.plans?.map((plan) => ({
      id: plan.id,
      title: plan.title,
      status: plan.status,
      version: plan.version,
      updatedAt: plan.updatedAt.toISOString(),
    })) ?? [],
  };
}

function serializePlan(plan: PlanRecord) {
  return {
    ...plan,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    nextReviewAt: plan.nextReviewAt?.toISOString() ?? null,
    reviewDecisions: plan.reviewDecisions.map((decision) => ({
      ...decision,
      createdAt: decision.createdAt.toISOString(),
    })),
    goal: serializeGoal({ ...plan.goal, plans: [] }),
    steps: plan.steps.map((step) => ({
      ...step,
      createdAt: step.createdAt.toISOString(),
      updatedAt: step.updatedAt.toISOString(),
      executions: step.executions.map((link) => ({
        ...link,
        createdAt: link.createdAt.toISOString(),
        actionExecution: {
          ...link.actionExecution,
          createdAt: link.actionExecution.createdAt.toISOString(),
          updatedAt: link.actionExecution.updatedAt.toISOString(),
          startedAt: link.actionExecution.startedAt?.toISOString() ?? null,
          finishedAt: link.actionExecution.finishedAt?.toISOString() ?? null,
        },
      })),
      evidence: step.evidence.map(serializeEvidence),
    })),
    evidence: plan.evidence.map(serializeEvidence),
    measurementDefinitions: plan.measurementDefinitions.map((definition) => ({
      ...definition,
      baseline: nullableDecimalToNumber(definition.baseline),
      target: nullableDecimalToNumber(definition.target),
      windowFrom: definition.windowFrom.toISOString(),
      windowTo: definition.windowTo.toISOString(),
      createdAt: definition.createdAt.toISOString(),
      updatedAt: definition.updatedAt.toISOString(),
      reviews: definition.reviews.map((review) => ({
        ...review,
        observed: nullableDecimalToNumber(review.observed),
        reviewedAt: review.reviewedAt?.toISOString() ?? null,
        createdAt: review.createdAt.toISOString(),
        updatedAt: review.updatedAt.toISOString(),
      })),
    })),
    gaps: plan.gaps.map((gap) => ({
      ...gap,
      createdAt: gap.createdAt.toISOString(),
      updatedAt: gap.updatedAt.toISOString(),
      nextAttemptAllowedAt: gap.nextAttemptAllowedAt?.toISOString() ?? null,
      resolvedAt: gap.resolvedAt?.toISOString() ?? null,
    })),
  };
}

function serializeEvidence(item: EvidenceRecord) {
  return {
    ...item,
    eventAt: item.eventAt?.toISOString() ?? null,
    ingestedAt: item.ingestedAt.toISOString(),
    validUntil: item.validUntil?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

export class CommandCenterService {
  constructor(private readonly repository: CommandCenterRepository) {}

  async listObjectives(ctx: RequestContext) {
    assertTenantContext(ctx);
    const items = await this.repository.listGoals(ctx.tenantId);
    return { items: items.map(serializeGoal) };
  }

  async listPlans(ctx: RequestContext, query: Record<string, string | undefined> = {}) {
    assertTenantContext(ctx);
    const status = query.status ? planStatusSchema.parse(query.status) : undefined;
    const items = await this.repository.listPlans(ctx.tenantId, status);
    return { items: items.map(serializePlan) };
  }

  async getWeeklyCycleReview(
    ctx: RequestContext,
    query: Record<string, string | undefined> = {},
    now = new Date(),
  ) {
    assertTenantContext(ctx);
    const window = parseCycleReviewQuery(query, now);
    const readings = await this.repository.listCycleReadings(ctx.tenantId, window.from, window.to);
    return serializeCycleReview(ctx.tenantId, window, readings);
  }

  async getPlan(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const plan = await this.repository.findPlan(ctx.tenantId, id);
    if (!plan) throw new AppError(ErrorCode.NOT_FOUND, 'Plan not found');
    return serializePlan(plan);
  }

  async createPlan(ctx: RequestContext, raw: unknown, options: { publish?: boolean } = {}) {
    assertOwnerOrAdmin(ctx);
    const input = createPlanSchema.parse(raw);
    const [goal, insight, recommendation] = await Promise.all([
      this.repository.findGoal(ctx.tenantId, input.goalId),
      input.insightId ? this.repository.findInsight(ctx.tenantId, input.insightId) : null,
      input.recommendationId
        ? this.repository.findRecommendation(ctx.tenantId, input.recommendationId)
        : null,
    ]);
    if (!goal) throw new AppError(ErrorCode.NOT_FOUND, 'Goal not found');
    if (input.insightId && !insight) throw new AppError(ErrorCode.NOT_FOUND, 'Insight not found');
    if (input.recommendationId && !recommendation) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Recommendation not found');
    }
    const plan = await this.repository.createPlan({ tenantId: ctx.tenantId, ...input, publish: options.publish });
    return serializePlan(plan);
  }

  async updatePlanStatus(ctx: RequestContext, id: string, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = updatePlanStatusSchema.parse(raw);
    const plan = await this.repository.updatePlanStatus(
      ctx.tenantId,
      id,
      input.version,
      input.status,
    );
    if (!plan) {
      throw new AppError(ErrorCode.CONFLICT, 'Plan changed since it was reviewed');
    }
    return serializePlan(plan);
  }

  async decidePlanReview(ctx: RequestContext, id: string, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    assertTenantUser(ctx);
    const input = decidePlanReviewSchema.parse(raw);
    const result = await this.repository.decidePlanReview({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      planId: id,
      ...input,
    });
    if (result === 'not_found' || result === 'review_not_found') {
      throw new AppError(ErrorCode.NOT_FOUND, 'Plan or review not found');
    }
    if (result === 'pending_approval') {
      throw new AppError(ErrorCode.CONFLICT, 'Resolve the pending approval before reviewing this plan');
    }
    if (result === 'conflict') {
      throw new AppError(ErrorCode.CONFLICT, 'Plan changed since it was reviewed');
    }
    return {
      id: result.decision.id,
      choice: result.decision.choice,
      fromVersion: result.decision.fromVersion,
      toVersion: result.decision.toVersion,
      status: result.status,
    };
  }

  async createReview(ctx: RequestContext, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = createMeasurementReviewSchema.parse(raw);
    const review = await this.repository.createReview({ tenantId: ctx.tenantId, ...input });
    if (!review) throw new AppError(ErrorCode.NOT_FOUND, 'Measurement definition not found');
    return {
      ...review,
      observed: nullableDecimalToNumber(review.observed),
      reviewedAt: review.reviewedAt?.toISOString() ?? null,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  async prepareFromRecommendation(ctx: RequestContext, recommendationId: string, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const { goalId } = preparePlanFromRecommendationSchema.parse(raw);
    const existing = await this.repository.findPlanByRecommendation(ctx.tenantId, recommendationId);
    if (existing) return serializePlan(existing);

    const [goal, recommendation] = await Promise.all([
      this.repository.findGoal(ctx.tenantId, goalId),
      this.repository.findRecommendationForPlan(ctx.tenantId, recommendationId),
    ]);
    if (!goal) throw new AppError(ErrorCode.NOT_FOUND, 'Goal not found');
    if (!recommendation) throw new AppError(ErrorCode.NOT_FOUND, 'Recommendation not found');

    const action = suggestedActionOf(
      recommendation.metadata,
      recommendation.title,
      recommendation.description,
    );
    const window = goalWindow(goal.periodType, goal.periodStart);
    const unit = goal.metricKey === 'revenue' || goal.metricKey.includes('amount') ? 'BRL' : 'count';
    const evidence = Array.isArray(recommendation.insight.evidence)
      ? recommendation.insight.evidence
      : [];

    try {
      const plan = await this.repository.createPlan({
        tenantId: ctx.tenantId,
        goalId,
        insightId: recommendation.insightId,
        recommendationId,
        title: recommendation.title,
        summary: recommendation.description,
        scope: {
          origin: 'recommendation',
          suggestedAction: action,
          evidenceSnapshot: evidence,
          insightId: recommendation.insightId,
        },
        responsibleLabel: 'Responsável definido no processo existente',
        nextReviewAt: window.to,
        steps: [
          {
            title: action.actionType === 'send_email' ? 'Realizar envio autorizado' : 'Criar tarefa no processo existente',
            description: recommendation.description,
          },
          {
            title: 'Acompanhar execução e resultado',
            description: 'A Tactia consulta as fontes conectadas; nenhuma atualização manual é necessária.',
          },
        ],
        measurement: {
          metricKey: goal.metricKey,
          indicator: goal.title ?? goal.metricKey,
          unit,
          windowFrom: window.from,
          windowTo: window.to,
          baseline: nullableNumber(goal.baselineValue),
          target: decimalToNumber(goal.target),
          sources: evidence,
          attribution: 'Variação observada na janela do plano; não implica causalidade da Tactia.',
        },
      });
      return serializePlan(plan);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code === 'P2002') {
        const concurrent = await this.repository.findPlanByRecommendation(
          ctx.tenantId,
          recommendationId,
        );
        if (concurrent) return serializePlan(concurrent);
      }
      throw error;
    }
  }

  async validatePreparedExecution(
    ctx: RequestContext,
    planId: string,
    planStepId: string,
    raw: unknown,
  ) {
    assertOwnerOrAdmin(ctx);
    const input = preparedPlanActionSchema.parse(raw);
    const plan = await this.repository.findPlan(ctx.tenantId, planId);
    if (!plan) throw new AppError(ErrorCode.NOT_FOUND, 'Plan not found');
    const step = plan.steps.find((item) => item.id === planStepId);
    if (!step) throw new AppError(ErrorCode.NOT_FOUND, 'Plan step not found');
    if (step.position !== 1) {
      throw new AppError(ErrorCode.CONFLICT, 'This plan step is not executable');
    }
    const prepared = suggestedActionOf(plan.scope, plan.title, plan.summary ?? plan.title);
    if (
      input.actionType !== prepared.actionType ||
      !isDeepStrictEqual(input.input, prepared.input) ||
      (input.reason ?? null) !== prepared.reason
    ) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Requested action differs from the prepared plan version',
      );
    }
    return input;
  }

  async linkExecution(
    ctx: RequestContext,
    planId: string,
    planStepId: string,
    raw: unknown,
  ) {
    assertOwnerOrAdmin(ctx);
    const input = linkPlanExecutionSchema.parse(raw);
    await this.validatePreparedExecution(ctx, planId, planStepId, input);
    const plan = await this.repository.findPlan(ctx.tenantId, planId);
    if (!plan) throw new AppError(ErrorCode.NOT_FOUND, 'Plan not found');
    const step = plan.steps.find((item) => item.id === planStepId);
    if (!step) throw new AppError(ErrorCode.NOT_FOUND, 'Plan step not found');

    const linked = await this.repository.linkExecution({
      tenantId: ctx.tenantId,
      planId,
      planStepId,
      actionExecutionId: input.actionExecutionId,
      decisionSnapshot: {
        plan: { id: plan.id, title: plan.title, version: plan.version },
        goal: { id: plan.goal.id, title: plan.goal.title, metricKey: plan.goal.metricKey },
        step: { id: step.id, title: step.title, position: step.position },
        action: { type: input.actionType, input: input.input, reason: input.reason ?? null },
        evidence: plan.scope,
        capturedAt: new Date().toISOString(),
      },
    });
    if (!linked) throw new AppError(ErrorCode.NOT_FOUND, 'Execution or plan step not found');
    return {
      id: linked.id,
      planId,
      planStepId,
      actionExecutionId: linked.actionExecutionId,
      planVersion: linked.planVersion,
      decisionSnapshot: linked.decisionSnapshot,
      executionStatus: linked.actionExecution.status,
      approvalId:
        linked.actionExecution.approvals.find((approval) => approval.status === 'pending')?.id ?? null,
    };
  }

  async listDecisionContexts(ctx: RequestContext, approvalIds: string[]) {
    assertTenantContext(ctx);
    const contexts = await this.repository.listDecisionContexts(ctx.tenantId, approvalIds);
    return contexts.map((item) => {
      const approval = item.actionExecution.approvals.find((candidate) =>
        approvalIds.includes(candidate.id),
      );
      return {
        approvalId: approval?.id ?? null,
        planId: item.planStep.plan.id,
        planTitle: item.planStep.plan.title,
        planVersion: item.planVersion,
        currentVersion: item.planStep.plan.version,
        decisionSnapshot: item.decisionSnapshot,
      };
    }).filter((item) => item.approvalId !== null);
  }

  async assertDecisionCurrent(ctx: RequestContext, approvalId: string) {
    assertOwnerOrAdmin(ctx);
    const decision = await this.repository.findDecisionContext(ctx.tenantId, approvalId);
    if (!decision) return null;
    if (decision.planVersion !== decision.planStep.plan.version) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Plan changed from version ${decision.planVersion} to ${decision.planStep.plan.version}`,
      );
    }
    return {
      planId: decision.planStep.plan.id,
      planVersion: decision.planVersion,
      decisionSnapshot: decision.decisionSnapshot,
      actionExecutionId: decision.actionExecutionId,
    };
  }

  async recordApprovalDecision(ctx: RequestContext, approvalId: string, choice: 'approved' | 'rejected') {
    assertTenantContext(ctx);
    await this.repository.recordApprovalDecision(ctx.tenantId, approvalId, choice);
  }

  async reconcileExecution(ctx: RequestContext, actionExecutionId: string) {
    assertTenantContext(ctx);
    const plan = await this.repository.reconcileExecution(ctx.tenantId, actionExecutionId);
    return plan ? serializePlan(plan) : null;
  }
}

const listGapsSchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: gapStatusSchema.optional(),
  impact: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const updateGapSchema = z.object({
  status: gapStatusSchema.optional(),
  assigneeOperatorId: z.string().uuid().nullable().optional(),
  nextStep: z.string().trim().max(1000).nullable().optional(),
  resolution: z.record(z.string(), z.unknown()).nullable().optional(),
  incrementAttempts: z.boolean().optional(),
  nextAttemptAllowedAt: z.coerce.date().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one change is required');

export class EvidenceGapService {
  constructor(private readonly repository: CommandCenterRepository) {}

  async list(ctx: RequestContext, raw: Record<string, string | undefined>) {
    assertOperator(ctx);
    const query = listGapsSchema.parse(raw);
    return this.repository.listGaps(query);
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertOperator(ctx);
    const input = updateGapSchema.parse(raw);
    const gap = await this.repository.updateGap({ id, ...input });
    if (!gap) throw new AppError(ErrorCode.NOT_FOUND, 'Evidence gap not found');
    return gap;
  }
}
