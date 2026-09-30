import { ZodError, z } from 'zod';
import type { CommandCenterRepository } from '@tactia/database';
import { AppError, ErrorCode } from '@tactia/shared';
import { decimalToNumber } from '../utils/serialize';

export const CYCLE_REVIEW_DEFAULT_DAYS = 7;
export const CYCLE_REVIEW_MAX_DAYS = 90;

const MS_PER_DAY = 86_400_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const querySchema = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
});

export type CycleReviewAvailability = 'ready' | 'empty' | 'partial';

export type CycleReviewPlan = {
  planId: string;
  title: string;
  status: string;
  version: number;
  nextReviewAt: string | null;
  goalId: string;
  goalTitle: string | null;
  goalStatus: string;
};

export type CycleReviewDecision = {
  id: string;
  kind: 'plan_review' | 'approval';
  choice: string;
  planId: string;
  planTitle: string;
  fromVersion: number | null;
  toVersion: number | null;
  reason: string | null;
  createdAt: string;
};

export type CycleReviewExecution = {
  id: string;
  planId: string;
  planTitle: string;
  planStatus: string;
  stepId: string;
  stepTitle: string;
  actionName: string;
  actionType: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
};

export type CycleReviewGap = {
  id: string;
  subject: string;
  reason: string;
  impact: string;
  status: string;
  planId: string | null;
  planTitle: string | null;
};

export type CycleReviewObservation = {
  definitionId: string;
  planId: string;
  planTitle: string;
  planStatus: string;
  goalStatus: string;
  metricKey: string;
  indicator: string;
  unit: string;
  baseline: number | null;
  target: number | null;
  observed: number | null;
  availability: CycleReviewAvailability;
  status: string;
  attribution: string;
  limitation: string | null;
  windowFrom: string;
  windowTo: string;
  version: number;
  sources: unknown;
  reviews: Array<{
    id: string;
    status: string;
    observed: number | null;
    operationalResults: unknown;
    references: unknown;
    limitation: string | null;
    reviewedAt: string | null;
    createdAt: string;
  }>;
};

export type CycleReview = {
  tenantId: string;
  period: { from: string; to: string };
  periodInclusive: { from: string; to: string };
  inProgress: CycleReviewPlan[];
  decisions: CycleReviewDecision[];
  executions: CycleReviewExecution[];
  gaps: CycleReviewGap[];
  observations: CycleReviewObservation[];
};

type CycleReadings = Awaited<ReturnType<CommandCenterRepository['listCycleReadings']>>;
type CyclePlan = CycleReadings['plans'][number];

function validation(message: string, details?: unknown): never {
  throw new AppError(ErrorCode.VALIDATION_ERROR, message, details);
}

function parseBoundary(value: string, role: 'from' | 'to'): Date {
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const start = Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return new Date(role === 'to' ? start + MS_PER_DAY : start);
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    validation('from e to precisam ser datas ISO válidas.');
  }
  return instant;
}

function utcDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function defaultWindow(now: Date) {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const to = new Date(startOfToday + MS_PER_DAY);
  const from = new Date(to.getTime() - CYCLE_REVIEW_DEFAULT_DAYS * MS_PER_DAY);
  return { from, to };
}

export function resolveCycleReviewWindow(
  raw: { from?: string; to?: string },
  now = new Date(),
) {
  if (!raw.from && !raw.to) return defaultWindow(now);
  if (!raw.from || !raw.to) {
    validation('Informe from e to juntos, como datas ISO.');
  }
  const from = parseBoundary(raw.from, 'from');
  const to = parseBoundary(raw.to, 'to');
  const durationMs = to.getTime() - from.getTime();
  if (durationMs <= 0) {
    validation('Informe um intervalo com início anterior ao fim.');
  }
  if (durationMs > CYCLE_REVIEW_MAX_DAYS * MS_PER_DAY) {
    validation(`O intervalo não pode passar de ${CYCLE_REVIEW_MAX_DAYS} dias.`);
  }
  return { from, to };
}

export function parseCycleReviewQuery(
  raw: Record<string, string | undefined>,
  now = new Date(),
) {
  let parsed: z.infer<typeof querySchema>;
  try {
    parsed = querySchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      validation('Parâmetros inválidos para a revisão consolidada.', error.flatten());
    }
    throw error;
  }
  return resolveCycleReviewWindow(parsed, now);
}

function nullableDecimalToNumber(value: unknown): number | null {
  return value == null ? null : decimalToNumber(value);
}

function belongsToTenant<T extends { tenantId: string }>(
  value: T | null | undefined,
  tenantId: string,
): value is T {
  return value != null && value.tenantId === tenantId;
}

function serializePlan(plan: CyclePlan, tenantId: string): CycleReviewPlan | null {
  if (!belongsToTenant(plan, tenantId) || !belongsToTenant(plan.goal, tenantId)) {
    return null;
  }
  return {
    planId: plan.id,
    title: plan.title,
    status: plan.status,
    version: plan.version,
    nextReviewAt: plan.nextReviewAt?.toISOString() ?? null,
    goalId: plan.goal.id,
    goalTitle: plan.goal.title,
    goalStatus: plan.goal.status,
  };
}

function observationAvailability(
  status: string,
  observed: number | null,
): CycleReviewAvailability {
  if (status === 'measured' && observed != null) return 'ready';
  if (status === 'not_measurable') return 'empty';
  if (status === 'review_needed' && observed != null) return 'partial';
  return 'empty';
}

export function serializeCycleReview(
  tenantId: string,
  window: { from: Date; to: Date },
  readings: CycleReadings,
): CycleReview {
  const plansById = new Map<string, CycleReviewPlan>();

  for (const plan of readings.plans) {
    if (!belongsToTenant(plan, tenantId)) continue;
    const serialized = serializePlan(plan, tenantId);
    if (serialized) plansById.set(serialized.planId, serialized);
  }

  const decisions: CycleReviewDecision[] = [];
  for (const decision of readings.decisions) {
    if (!belongsToTenant(decision, tenantId) || !belongsToTenant(decision.plan, tenantId)) continue;
    const serialized = serializePlan(decision.plan, tenantId);
    if (serialized) plansById.set(serialized.planId, serialized);
    decisions.push({
      id: decision.id,
      kind: 'plan_review',
      choice: decision.choice,
      planId: decision.plan.id,
      planTitle: decision.plan.title,
      fromVersion: decision.fromVersion,
      toVersion: decision.toVersion,
      reason: decision.reason,
      createdAt: decision.createdAt.toISOString(),
    });
  }

  for (const approval of readings.approvals) {
    if (!belongsToTenant(approval, tenantId) || !belongsToTenant(approval.actionExecution, tenantId)) {
      continue;
    }
    const plan = approval.actionExecution.planStepLinks
      .filter((link) => belongsToTenant(link, tenantId) && belongsToTenant(link.planStep, tenantId))
      .map((link) => link.planStep.plan)
      .find((item) => belongsToTenant(item, tenantId));
    if (!plan) continue;
    const serialized = serializePlan(plan, tenantId);
    if (serialized) plansById.set(serialized.planId, serialized);
    decisions.push({
      id: approval.id,
      kind: 'approval',
      choice: approval.status,
      planId: plan.id,
      planTitle: plan.title,
      fromVersion: null,
      toVersion: null,
      reason: null,
      createdAt: (approval.resolvedAt ?? approval.createdAt).toISOString(),
    });
  }

  const executions: CycleReviewExecution[] = [];
  for (const link of readings.executions) {
    if (
      !belongsToTenant(link, tenantId)
      || !belongsToTenant(link.planStep, tenantId)
      || !belongsToTenant(link.planStep.plan, tenantId)
      || !belongsToTenant(link.actionExecution, tenantId)
    ) {
      continue;
    }
    const serialized = serializePlan(link.planStep.plan, tenantId);
    if (serialized) plansById.set(serialized.planId, serialized);
    executions.push({
      id: link.actionExecution.id,
      planId: link.planStep.plan.id,
      planTitle: link.planStep.plan.title,
      planStatus: link.planStep.plan.status,
      stepId: link.planStep.id,
      stepTitle: link.planStep.title,
      actionName: link.actionExecution.action.name,
      actionType: link.actionExecution.action.type,
      status: link.actionExecution.status,
      createdAt: link.actionExecution.createdAt.toISOString(),
      finishedAt: link.actionExecution.finishedAt?.toISOString() ?? null,
    });
  }

  const gaps: CycleReviewGap[] = [];
  for (const gap of readings.gaps) {
    if (!belongsToTenant(gap, tenantId)) continue;
    const plan = belongsToTenant(gap.plan, tenantId) ? gap.plan : null;
    gaps.push({
      id: gap.id,
      subject: gap.subject,
      reason: gap.reason,
      impact: gap.impact,
      status: gap.status,
      planId: plan?.id ?? null,
      planTitle: plan?.title ?? null,
    });
  }

  const observationsByDefinition = new Map<string, CycleReviewObservation>();
  for (const review of readings.reviews) {
    const definition = review.measurementDefinition;
    if (
      !belongsToTenant(review, tenantId)
      || !belongsToTenant(definition, tenantId)
      || !belongsToTenant(definition.plan, tenantId)
    ) {
      continue;
    }
    if (observationsByDefinition.has(definition.id)) continue;
    const serialized = serializePlan(definition.plan, tenantId);
    if (serialized) plansById.set(serialized.planId, serialized);
    const observed = nullableDecimalToNumber(review.observed);
    observationsByDefinition.set(definition.id, {
      definitionId: definition.id,
      planId: definition.plan.id,
      planTitle: definition.plan.title,
      planStatus: definition.plan.status,
      goalStatus: definition.plan.goal.status,
      metricKey: definition.metricKey,
      indicator: definition.indicator,
      unit: definition.unit,
      baseline: nullableDecimalToNumber(definition.baseline),
      target: nullableDecimalToNumber(definition.target),
      observed,
      availability: observationAvailability(review.status, observed),
      status: review.status,
      attribution: definition.attribution,
      limitation: review.limitation,
      windowFrom: definition.windowFrom.toISOString(),
      windowTo: definition.windowTo.toISOString(),
      version: definition.version,
      sources: definition.sources,
      reviews: [{
        id: review.id,
        status: review.status,
        observed,
        operationalResults: review.operationalResults,
        references: review.references,
        limitation: review.limitation,
        reviewedAt: review.reviewedAt?.toISOString() ?? null,
        createdAt: review.createdAt.toISOString(),
      }],
    });
  }

  return {
    tenantId,
    period: { from: window.from.toISOString(), to: window.to.toISOString() },
    periodInclusive: {
      from: utcDateString(window.from),
      to: utcDateString(new Date(window.to.getTime() - 1)),
    },
    inProgress: [...plansById.values()],
    decisions,
    executions,
    gaps,
    observations: [...observationsByDefinition.values()],
  };
}
