import type { CycleReview } from '@tactia/domain';
import type {
  Availability,
  ObjectiveView,
  PlanView,
  TodayPriorityView,
  TodaySnapshot,
} from '@/components/app/command-center/types';
import { metricLabel } from '@/lib/format';

export const TODAY_PERIOD_LABEL = 'Período atual';

export type TodayProgressItem = { id: string; achieved: number };

export type TodayFreshness = {
  sources: Array<{ lastSyncAt: string | null }>;
  staleCount: number;
} | null;

export type TodayBriefingView = {
  objective: ObjectiveView | null;
  progress: TodayProgressItem | null;
  priorities: TodayPriorityView[];
  plans: PlanView[];
  activePlans: PlanView[];
  availability: Availability;
  updatedAt: string | null;
  limitation: string | null;
  periodLabel: string;
  hasAnyData: boolean;
  cycleReview: CycleReview | null;
  chatHref: string;
  evidenceHref: string | null;
};

export const DEGRADED_TODAY_SNAPSHOT: TodaySnapshot = {
  availability: 'error',
  periodLabel: TODAY_PERIOD_LABEL,
  attention: null,
  updatedAt: null,
  chatHref: '/chat',
  objectiveTitle: null,
};

export function evidenceLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { key?: string; value?: unknown };
    return row.key && (typeof row.value === 'number' || typeof row.value === 'string')
      ? [`${metricLabel(row.key)}: ${String(row.value)}`]
      : [];
  });
}

export function deriveTodayAvailability(input: {
  hasObjective: boolean;
  hasProgress: boolean;
  freshness: TodayFreshness;
}): Availability {
  if (!input.hasObjective) return 'empty';
  if (!input.hasProgress) return 'error';
  if (!input.freshness || input.freshness.sources.length === 0) return 'partial';
  if (input.freshness.staleCount > 0) return 'stale';
  return 'ready';
}

export function formatCoverageAt(coverageAt: Date | null): string | null {
  if (!coverageAt) return null;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(coverageAt);
}

export function coverageFromFreshness(freshness: TodayFreshness): Date | null {
  const sourceDates = (freshness?.sources ?? [])
    .map((source) => (source.lastSyncAt ? new Date(source.lastSyncAt) : null))
    .filter((date): date is Date => date !== null);
  if (
    !freshness ||
    freshness.sources.length === 0 ||
    sourceDates.length !== freshness.sources.length
  ) {
    return null;
  }
  return new Date(Math.min(...sourceDates.map((date) => date.getTime())));
}

export function todayLimitation(input: {
  hasProgress: boolean;
  freshness: TodayFreshness;
}): string | null {
  if (!input.hasProgress) {
    return 'Não foi possível atualizar o realizado. A meta continua visível, mas nenhuma conclusão usa zero como substituto.';
  }
  if (!input.freshness || input.freshness.sources.length === 0) {
    return 'A cobertura das fontes ainda não está disponível.';
  }
  if (input.freshness.staleCount > 0) {
    return `${input.freshness.staleCount} fonte(s) estão desatualizadas; conclusões dependentes permanecem limitadas.`;
  }
  return null;
}

export function buildTodayBriefingView(input: {
  objectives: ObjectiveView[];
  plans: PlanView[];
  recommendations: TodayPriorityView[];
  progress: TodayProgressItem[] | null;
  freshness: TodayFreshness;
  cycleReview: CycleReview | null;
}): TodayBriefingView {
  const objective = input.objectives.find((item) => item.status === 'active') ?? input.objectives[0] ?? null;
  const progress = objective ? input.progress?.find((item) => item.id === objective.id) ?? null : null;
  const priorities = input.recommendations.slice(0, 3);
  const activePlans = input.plans.filter((plan) => ['active', 'paused'].includes(plan.status)).slice(0, 3);
  const availability = deriveTodayAvailability({
    hasObjective: Boolean(objective),
    hasProgress: Boolean(progress),
    freshness: input.freshness,
  });
  const updatedAt = formatCoverageAt(coverageFromFreshness(input.freshness));

  return {
    objective,
    progress,
    priorities,
    plans: input.plans,
    activePlans,
    availability,
    updatedAt,
    limitation: todayLimitation({ hasProgress: Boolean(progress), freshness: input.freshness }),
    periodLabel: TODAY_PERIOD_LABEL,
    hasAnyData: Boolean(input.objectives.length || priorities.length || input.plans.length),
    cycleReview: input.cycleReview,
    chatHref: objective ? `/chat?contextType=objective&contextId=${objective.id}` : '/chat',
    evidenceHref: objective ? `/objectives/${objective.id}#evidencias` : null,
  };
}

export function toTodaySnapshot(briefing: TodayBriefingView): TodaySnapshot {
  const objectiveTitle = briefing.objective
    ? briefing.objective.title ?? metricLabel(briefing.objective.metricKey)
    : null;
  return {
    availability: briefing.availability,
    periodLabel: briefing.periodLabel,
    attention: briefing.priorities[0]?.title ?? null,
    updatedAt: briefing.updatedAt,
    chatHref: briefing.chatHref,
    objectiveTitle,
  };
}

export function emptyTodayBriefing(): TodayBriefingView {
  return buildTodayBriefingView({
    objectives: [],
    plans: [],
    recommendations: [],
    progress: null,
    freshness: null,
    cycleReview: null,
  });
}
