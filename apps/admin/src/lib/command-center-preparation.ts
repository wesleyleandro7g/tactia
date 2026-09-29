import { z } from 'zod';
import { prisma } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { commandCenterService, goalService } from './services';
import { scopedTenant } from './settings-services';

export const PREPARATION_METRICS = [
  { key: 'revenue', label: 'Receita', unit: 'BRL' },
  { key: 'sales_count', label: 'Vendas confirmadas', unit: 'count' },
  { key: 'expense_total', label: 'Despesas', unit: 'BRL' },
  { key: 'complaint_count', label: 'Reclamações', unit: 'count' },
] as const;

const metricKey = z.enum(['revenue', 'sales_count', 'expense_total', 'complaint_count']);
const goalInput = z.object({
  title: z.string().trim().min(3).max(160),
  metricKey,
  periodType: z.enum(['month', 'quarter', 'year']),
  periodStart: z.coerce.date(),
  target: z.number().finite(),
  baselineValue: z.number().finite().nullable().optional(),
});

const planInput = z.object({
  goalId: z.string().uuid(),
  sourceId: z.string().uuid(),
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(3).max(1200),
  cohort: z.string().trim().min(3).max(300),
  responsibleLabel: z.string().trim().min(3).max(160),
  actionTitle: z.string().trim().min(3).max(160),
  actionDescription: z.string().trim().min(3).max(1000),
  actionReason: z.string().trim().min(3).max(500),
  windowFrom: z.coerce.date(),
  windowTo: z.coerce.date(),
}).refine((value) => value.windowTo > value.windowFrom, {
  message: 'A janela deve terminar depois do início.',
  path: ['windowTo'],
});

export async function listPreparation(ctx: RequestContext, tenantId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  const [objectives, plans, sources] = await Promise.all([
    commandCenterService.listObjectives(scoped),
    commandCenterService.listPlans(scoped),
    prisma.dataSource.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true, name: true, type: true, lastSyncAt: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return {
    objectives: objectives.items.map((item) => ({
      id: item.id,
      title: item.title ?? item.metricKey,
      metricKey: item.metricKey,
      status: item.status,
      target: item.target,
      baselineValue: item.baselineValue,
      periodStart: item.periodStart,
    })),
    plans: plans.items.map((item) => ({
      id: item.id,
      goalId: item.goalId,
      title: item.title,
      status: item.status,
      version: item.version,
      measurementCount: item.measurementDefinitions.length,
    })),
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.type,
      lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
    })),
  };
}

export async function createPreparedObjective(ctx: RequestContext, tenantId: string, raw: unknown) {
  const scoped = await scopedTenant(ctx, tenantId);
  const input = goalInput.parse(raw);
  if (Number.isNaN(input.periodStart.getTime())) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Data inicial inválida.');
  }
  return goalService.create(scoped, {
    ...input,
    scope: 'tenant',
    status: 'preparing',
    baselineValue: input.baselineValue ?? null,
  });
}

export async function createPreparedPlan(ctx: RequestContext, tenantId: string, raw: unknown) {
  const scoped = await scopedTenant(ctx, tenantId);
  const input = planInput.parse(raw);
  if (Number.isNaN(input.windowFrom.getTime()) || Number.isNaN(input.windowTo.getTime())) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Janela inválida.');
  }
  const [goal, source] = await Promise.all([
    prisma.goal.findFirst({ where: { id: input.goalId, tenantId } }),
    prisma.dataSource.findFirst({ where: { id: input.sourceId, tenantId, status: 'active' } }),
  ]);
  if (!goal || !['preparing', 'active'].includes(goal.status)) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Objetivo indisponível nesta empresa.');
  }
  if (!source) throw new AppError(ErrorCode.NOT_FOUND, 'Fonte ativa não encontrada nesta empresa.');
  const metric = PREPARATION_METRICS.find((item) => item.key === goal.metricKey);
  if (!metric || goal.scope !== 'tenant') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Objetivo ou escopo incompatível com esta preparação.');
  }
  if (input.windowFrom < goal.periodStart) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'A janela não pode começar antes do objetivo.');
  }

  return commandCenterService.createPlan(scoped, {
    goalId: goal.id,
    title: input.title,
    summary: input.summary,
    responsibleLabel: input.responsibleLabel,
    scope: {
      origin: 'ops',
      cohort: input.cohort,
      suggestedAction: {
        actionType: 'create_task',
        input: { title: input.actionTitle, description: input.actionDescription },
        reason: input.actionReason,
      },
    },
    steps: [
      { title: input.actionTitle, description: input.actionDescription },
      { title: 'Acompanhar execução e resultado', description: 'A Tactia consulta as fontes; nenhum status manual é exigido.' },
    ],
    measurement: {
      metricKey: metric.key,
      indicator: goal.title ?? metric.label,
      unit: metric.unit,
      cohort: { description: input.cohort },
      windowFrom: input.windowFrom,
      windowTo: input.windowTo,
      baseline: goal.baselineValue?.toNumber() ?? null,
      target: goal.target.toNumber(),
      sources: [{ dataSourceId: source.id, label: source.name, type: source.type, role: 'intended' }],
      attribution: 'Variação nos registros canônicos da empresa. A fonte indicada é referência para verificar cobertura, não filtro exclusivo da métrica. Não demonstra causalidade da Tactia.',
    },
  }, { publish: true });
}
