import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient } from '../client';
import { recordCommandCenterEvent } from './command-center-events';

const planInclude = {
  goal: true,
  insight: true,
  recommendation: true,
  steps: {
    orderBy: { position: 'asc' as const },
    include: {
      executions: { include: { actionExecution: { include: { action: true, approvals: true } } } },
      evidence: { orderBy: { eventAt: 'desc' as const } },
    },
  },
  measurementDefinitions: {
    include: { reviews: { orderBy: { createdAt: 'desc' as const } } },
  },
  evidence: { orderBy: { eventAt: 'desc' as const } },
  gaps: { orderBy: { createdAt: 'desc' as const } },
  reviewDecisions: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.PlanInclude;

export type CreatePlanInput = {
  tenantId: string;
  goalId: string;
  insightId?: string | null;
  recommendationId?: string | null;
  title: string;
  summary?: string | null;
  scope?: unknown;
  responsibleLabel?: string | null;
  nextReviewAt?: Date | null;
  steps: Array<{ title: string; description?: string | null }>;
  measurement?: {
    metricKey: string;
    indicator: string;
    unit: string;
    cohort?: unknown;
    windowFrom: Date;
    windowTo: Date;
    baseline?: number | null;
    target?: number | null;
    sources: unknown;
    attribution: string;
  };
};

export type CreateEvidenceGapInput = {
  tenantId: string;
  planId?: string | null;
  subject: string;
  reason: string;
  impact?: string;
  dedupeKey: string;
  sourcesAttempted?: unknown;
  nextStep?: string | null;
};

export class CommandCenterRepository {
  constructor(private readonly db: PrismaClient) {}

  findGoal(tenantId: string, id: string) {
    return this.db.goal.findFirst({ where: { tenantId, id } });
  }

  findInsight(tenantId: string, id: string) {
    return this.db.insight.findFirst({ where: { tenantId, id }, select: { id: true } });
  }

  findRecommendation(tenantId: string, id: string) {
    return this.db.recommendation.findFirst({ where: { tenantId, id }, select: { id: true } });
  }

  findRecommendationForPlan(tenantId: string, id: string) {
    return this.db.recommendation.findFirst({
      where: { tenantId, id },
      include: { insight: true },
    });
  }

  findPlanByRecommendation(tenantId: string, recommendationId: string) {
    return this.db.plan.findFirst({
      where: { tenantId, recommendationId },
      include: planInclude,
    });
  }

  listGoals(tenantId: string) {
    return this.db.goal.findMany({
      where: { tenantId },
      include: { plans: { orderBy: { updatedAt: 'desc' }, take: 5 } },
      orderBy: [{ status: 'asc' }, { periodStart: 'desc' }],
    });
  }

  async createPlan(input: CreatePlanInput) {
    return this.db.$transaction(async (tx) => {
      const plan = await tx.plan.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        goalId: input.goalId,
        insightId: input.insightId ?? null,
        recommendationId: input.recommendationId ?? null,
        title: input.title,
        summary: input.summary ?? null,
        scope: (input.scope ?? {}) as Prisma.InputJsonValue,
        responsibleLabel: input.responsibleLabel ?? null,
        nextReviewAt: input.nextReviewAt ?? null,
        steps: {
          create: input.steps.map((step, index) => ({
            id: createId(),
            tenantId: input.tenantId,
            position: index + 1,
            title: step.title,
            description: step.description ?? null,
          })),
        },
        ...(input.measurement
          ? {
              measurementDefinitions: {
                create: {
                  id: createId(),
                  tenantId: input.tenantId,
                  metricKey: input.measurement.metricKey,
                  indicator: input.measurement.indicator,
                  unit: input.measurement.unit,
                  cohort: input.measurement.cohort as Prisma.InputJsonValue | undefined,
                  windowFrom: input.measurement.windowFrom,
                  windowTo: input.measurement.windowTo,
                  baseline: input.measurement.baseline ?? null,
                  target: input.measurement.target ?? null,
                  sources: input.measurement.sources as Prisma.InputJsonValue,
                  attribution: input.measurement.attribution,
                },
              },
            }
          : {}),
      },
      include: planInclude,
      });
      await recordCommandCenterEvent(tx, {
        tenantId: input.tenantId,
        eventKey: `plan-created:${plan.id}`,
        name: 'plan_created',
        entityId: plan.id,
        metadata: { version: plan.version },
      });
      return plan;
    });
  }

  listPlans(tenantId: string, status?: string) {
    return this.db.plan.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: planInclude,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  findPlan(tenantId: string, id: string) {
    return this.db.plan.findFirst({ where: { tenantId, id }, include: planInclude });
  }

  async updatePlanStatus(tenantId: string, id: string, version: number, status: string) {
    const result = await this.db.plan.updateMany({
      where: { tenantId, id, version },
      data: { status, version: { increment: 1 } },
    });
    if (result.count !== 1) return null;
    return this.findPlan(tenantId, id);
  }

  async decidePlanReview(input: {
    tenantId: string;
    userId: string;
    planId: string;
    reviewId: string;
    version: number;
    choice: 'adjust' | 'continue' | 'close';
    reason?: string | null;
  }) {
    return this.db.$transaction(async (tx) => {
      const plan = await tx.plan.findFirst({
        where: { tenantId: input.tenantId, id: input.planId },
        include: {
          measurementDefinitions: { include: { reviews: { orderBy: { createdAt: 'desc' } } } },
          steps: { include: { executions: { include: { actionExecution: { include: { approvals: true } } } } } },
        },
      });
      if (!plan) return 'not_found' as const;
      if (plan.version !== input.version || plan.status === 'closed') return 'conflict' as const;
      if (plan.steps.some((step) => step.executions.some((link) =>
        link.actionExecution.approvals.some((approval) => approval.status === 'pending')))) {
        return 'pending_approval' as const;
      }
      const definition = plan.measurementDefinitions.find((item) =>
        item.reviews.some((review) => review.id === input.reviewId));
      const review = definition?.reviews.find((item) => item.id === input.reviewId);
      if (!definition || !review || definition.reviews[0]?.id !== review.id) return 'review_not_found' as const;
      const status = input.choice === 'close' ? 'closed' : input.choice === 'adjust' ? 'paused' : 'active';
      const updated = await tx.plan.updateMany({
        where: { tenantId: input.tenantId, id: input.planId, version: input.version, status: { not: 'closed' } },
        data: { status, version: { increment: 1 }, nextReviewAt: input.choice === 'continue' ? new Date(Date.now() + 7 * 86400000) : null },
      });
      if (updated.count !== 1) return 'conflict' as const;

      const decision = await tx.planReviewDecision.create({
        data: {
          id: createId(),
          tenantId: input.tenantId,
          planId: input.planId,
          reviewId: input.reviewId,
          userId: input.userId,
          choice: input.choice,
          reason: input.reason ?? null,
          fromVersion: input.version,
          toVersion: input.version + 1,
          reviewSnapshot: {
            definitionId: definition.id,
            definitionVersion: definition.version,
            indicator: definition.indicator,
            unit: definition.unit,
            baseline: definition.baseline?.toString() ?? null,
            observed: review.observed?.toString() ?? null,
            status: review.status,
            windowFrom: definition.windowFrom.toISOString(),
            windowTo: definition.windowTo.toISOString(),
            sources: definition.sources,
            references: review.references,
            attribution: definition.attribution,
            limitation: review.limitation,
          } as Prisma.InputJsonValue,
        },
      });
      await recordCommandCenterEvent(tx, {
        tenantId: input.tenantId,
        eventKey: `review-decision:${decision.id}`,
        name: 'decision_resolved',
        entityId: decision.id,
        metadata: { kind: 'plan_review', choice: input.choice, planVersion: decision.toVersion },
      });
      if (input.choice === 'adjust') {
        await tx.evidenceGap.create({
          data: {
            id: createId(),
            tenantId: input.tenantId,
            planId: input.planId,
            subject: `Ajustar plano: ${plan.title}`,
            reason: input.reason ?? 'Revisão do resultado solicitou ajuste do plano.',
            impact: 'medium',
            dedupeKey: `plan-review-adjust:${input.planId}:v${input.version}`,
            nextStep: 'Ops revisa o plano e prepara uma nova versão para decisão.',
          },
        });
      }
      return { decision, status };
    });
  }

  async recordApprovalDecision(tenantId: string, approvalId: string, choice: 'approved' | 'rejected') {
    await recordCommandCenterEvent(this.db, {
      tenantId,
      eventKey: `approval-decision:${approvalId}`,
      name: 'decision_resolved',
      entityId: approvalId,
      metadata: { kind: 'approval', choice },
    });
  }

  async createReview(input: {
    tenantId: string;
    measurementDefinitionId: string;
    status: string;
    observed?: number | null;
    operationalResults?: unknown;
    references?: unknown;
    limitation?: string | null;
    reviewedAt?: Date | null;
  }) {
    const definition = await this.db.measurementDefinition.findFirst({
      where: { id: input.measurementDefinitionId, tenantId: input.tenantId },
    });
    if (!definition) return null;
    return this.db.measurementReview.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        measurementDefinitionId: input.measurementDefinitionId,
        status: input.status,
        observed: input.observed ?? null,
        operationalResults: (input.operationalResults ?? []) as Prisma.InputJsonValue,
        references: (input.references ?? []) as Prisma.InputJsonValue,
        limitation: input.limitation ?? null,
        reviewedAt: input.reviewedAt ?? null,
      },
      include: { measurementDefinition: { include: { plan: { include: { goal: true } } } } },
    });
  }

  async createGap(input: CreateEvidenceGapInput) {
    return this.db.evidenceGap.upsert({
      where: { tenantId_dedupeKey: { tenantId: input.tenantId, dedupeKey: input.dedupeKey } },
      create: {
        id: createId(),
        tenantId: input.tenantId,
        planId: input.planId ?? null,
        subject: input.subject,
        reason: input.reason,
        impact: input.impact ?? 'medium',
        dedupeKey: input.dedupeKey,
        sourcesAttempted: (input.sourcesAttempted ?? []) as Prisma.InputJsonValue,
        nextStep: input.nextStep ?? null,
      },
      update: {
        reason: input.reason,
        impact: input.impact ?? 'medium',
        sourcesAttempted: (input.sourcesAttempted ?? []) as Prisma.InputJsonValue,
        nextStep: input.nextStep ?? null,
        ...(input.planId ? { planId: input.planId } : {}),
      },
    });
  }

  async resolveGapByDedupe(tenantId: string, dedupeKey: string, resolution: unknown) {
    return this.db.evidenceGap.updateMany({
      where: {
        tenantId,
        dedupeKey,
        status: { notIn: ['resolved', 'unresolved'] },
      },
      data: {
        status: 'resolved',
        resolution: resolution as Prisma.InputJsonValue,
        nextStep: null,
        resolvedAt: new Date(),
      },
    });
  }

  async listGaps(query: {
    tenantId?: string;
    status?: string;
    impact?: string;
    page: number;
    pageSize: number;
  }) {
    const where = {
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.impact ? { impact: query.impact } : {}),
    };
    const [total, items] = await Promise.all([
      this.db.evidenceGap.count({ where }),
      this.db.evidenceGap.findMany({
        where,
        include: {
          tenant: true,
          plan: true,
          assignee: true,
          clarifications: {
            include: { number: { select: { id: true, contactName: true, label: true } } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: [{ status: 'asc' }, { impact: 'asc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { total, items, page: query.page, pageSize: query.pageSize };
  }

  async updateGap(input: {
    id: string;
    status?: string;
    assigneeOperatorId?: string | null;
    nextStep?: string | null;
    resolution?: unknown;
    incrementAttempts?: boolean;
    nextAttemptAllowedAt?: Date | null;
  }) {
    const existing = await this.db.evidenceGap.findUnique({ where: { id: input.id } });
    if (!existing) return null;
    return this.db.evidenceGap.update({
      where: { id: input.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.assigneeOperatorId !== undefined
          ? { assigneeOperatorId: input.assigneeOperatorId }
          : {}),
        ...(input.nextStep !== undefined ? { nextStep: input.nextStep } : {}),
        ...(input.resolution !== undefined
          ? { resolution: input.resolution === null ? Prisma.JsonNull : input.resolution as Prisma.InputJsonValue }
          : {}),
        ...(input.incrementAttempts ? { attempts: { increment: 1 } } : {}),
        ...(input.nextAttemptAllowedAt !== undefined
          ? { nextAttemptAllowedAt: input.nextAttemptAllowedAt }
          : {}),
        ...(input.status === 'resolved' || input.status === 'unresolved'
          ? { resolvedAt: new Date() }
          : {}),
      },
      include: { tenant: true, plan: true, assignee: true },
    });
  }

  async linkExecution(input: {
    tenantId: string;
    planId: string;
    planStepId: string;
    actionExecutionId: string;
    decisionSnapshot: unknown;
  }) {
    const [step, execution] = await Promise.all([
      this.db.planStep.findFirst({
        where: { id: input.planStepId, tenantId: input.tenantId, planId: input.planId },
        include: { plan: true },
      }),
      this.db.actionExecution.findFirst({
        where: { id: input.actionExecutionId, tenantId: input.tenantId },
      }),
    ]);
    if (!step || !execution) return null;
    return this.db.planStepExecution.upsert({
      where: { actionExecutionId: input.actionExecutionId },
      create: {
        id: createId(),
        tenantId: input.tenantId,
        planStepId: input.planStepId,
        actionExecutionId: input.actionExecutionId,
        planVersion: step.plan.version,
        decisionSnapshot: input.decisionSnapshot as Prisma.InputJsonValue,
      },
      update: {},
      include: {
        planStep: { include: { plan: true } },
        actionExecution: { include: { action: true, approvals: true } },
      },
    });
  }

  findDecisionContext(tenantId: string, approvalId: string) {
    return this.db.planStepExecution.findFirst({
      where: {
        tenantId,
        actionExecution: { approvals: { some: { id: approvalId, tenantId } } },
      },
      include: {
        planStep: { include: { plan: true } },
        actionExecution: { include: { action: true, approvals: true } },
      },
    });
  }

  listDecisionContexts(tenantId: string, approvalIds: string[]) {
    if (approvalIds.length === 0) return Promise.resolve([]);
    return this.db.planStepExecution.findMany({
      where: {
        tenantId,
        actionExecution: { approvals: { some: { id: { in: approvalIds }, tenantId } } },
      },
      include: {
        planStep: { include: { plan: true } },
        actionExecution: { include: { approvals: true } },
      },
    });
  }

  async reconcileExecution(tenantId: string, actionExecutionId: string) {
    const link = await this.db.planStepExecution.findFirst({
      where: { tenantId, actionExecutionId },
      include: {
        actionExecution: { include: { action: true, approvals: true } },
        planStep: {
          include: {
            plan: {
              include: {
                measurementDefinitions: { include: { reviews: true } },
              },
            },
          },
        },
      },
    });
    if (!link) return null;

    const execution = link.actionExecution;
    const plan = link.planStep.plan;
    const stepStatus =
      execution.status === 'completed'
        ? 'completed'
        : execution.status === 'failed'
          ? 'failed'
          : execution.status === 'cancelled'
            ? 'cancelled'
            : ['running', 'approved', 'pending'].includes(execution.status)
              ? 'running'
              : 'pending';

    await this.db.planStep.update({
      where: { id: link.planStepId },
      data: { status: stepStatus },
    });
    await recordCommandCenterEvent(this.db, {
      tenantId,
      eventKey: `execution-state:${execution.id}:${execution.status}:${execution.updatedAt.toISOString()}`,
      name: 'execution_state_changed',
      entityId: execution.id,
      metadata: { status: execution.status, planId: plan.id },
    });
    if (
      plan.status === 'draft' &&
      ['approved', 'pending', 'running', 'completed'].includes(execution.status)
    ) {
      await this.db.plan.update({ where: { id: plan.id }, data: { status: 'active' } });
    }

    if (execution.status === 'completed' || execution.status === 'failed') {
      const evidence = await this.db.operationalEvidence.upsert({
        where: {
          tenantId_externalRef: {
            tenantId,
            externalRef: `action-execution:${execution.id}`,
          },
        },
        create: {
          id: createId(),
          tenantId,
          planId: plan.id,
          planStepId: link.planStepId,
          kind: 'observed',
          origin: 'action_execution',
          summary:
            execution.status === 'completed'
              ? `${execution.action.name} concluída pelo executor.`
              : `${execution.action.name} falhou durante a execução.`,
          sourceLabel: 'Motor de execução Tactia',
          externalRef: `action-execution:${execution.id}`,
          eventAt: execution.finishedAt ?? execution.updatedAt,
          payload: (execution.status === 'completed' ? execution.output ?? {} : { error: execution.error }) as Prisma.InputJsonValue,
        },
        update: {
          summary:
            execution.status === 'completed'
              ? `${execution.action.name} concluída pelo executor.`
              : `${execution.action.name} falhou durante a execução.`,
          eventAt: execution.finishedAt ?? execution.updatedAt,
          payload: (execution.status === 'completed' ? execution.output ?? {} : { error: execution.error }) as Prisma.InputJsonValue,
        },
      });

      if (execution.status === 'failed') {
        await this.createGap({
          tenantId,
          planId: plan.id,
          subject: `Falha em ${execution.action.name}`,
          reason: execution.error ?? 'A execução falhou sem detalhe adicional.',
          impact: 'high',
          dedupeKey: `action-execution:${execution.id}:failed`,
          sourcesAttempted: [{ source: 'execution_engine', at: new Date().toISOString() }],
          nextStep: 'Revisar a falha e reconciliar o estado antes de tentar novamente.',
        });
      }

      if (execution.status === 'completed') {
        for (const definition of plan.measurementDefinitions) {
          if (definition.reviews.length > 0) continue;
          await this.db.measurementReview.create({
            data: {
              id: createId(),
              tenantId,
              measurementDefinitionId: definition.id,
              status: 'measuring',
              observed: null,
              operationalResults: [{
                actionExecutionId: execution.id,
                status: execution.status,
                evidenceId: evidence.id,
              }],
              references: [{ evidenceId: evidence.id, kind: 'observed' }],
              limitation: 'Resultado comercial ainda em observação na janela definida.',
            },
          });
        }
      }
    }

    return this.findPlan(tenantId, plan.id);
  }

  listMeasurementDefinitions(tenantId: string, statuses: string[] = ['active']) {
    return this.db.measurementDefinition.findMany({
      where: { tenantId, plan: { status: { in: statuses } } },
      include: {
        plan: true,
        reviews: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { windowTo: 'asc' },
    });
  }

  async upsertAutomaticReview(input: {
    tenantId: string;
    measurementDefinitionId: string;
    observed: number | null;
    status: string;
    references: unknown;
    limitation?: string | null;
    reviewedAt?: Date | null;
  }) {
    const current = await this.db.measurementReview.findFirst({
      where: {
        tenantId: input.tenantId,
        measurementDefinitionId: input.measurementDefinitionId,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (current) {
      return this.db.measurementReview.update({
        where: { id: current.id },
        data: {
          observed: input.observed,
          status: input.status,
          references: input.references as Prisma.InputJsonValue,
          limitation: input.limitation ?? null,
          reviewedAt: input.reviewedAt ?? null,
        },
      });
    }
    return this.db.measurementReview.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        measurementDefinitionId: input.measurementDefinitionId,
        observed: input.observed,
        status: input.status,
        operationalResults: [],
        references: input.references as Prisma.InputJsonValue,
        limitation: input.limitation ?? null,
        reviewedAt: input.reviewedAt ?? null,
      },
    });
  }

}
