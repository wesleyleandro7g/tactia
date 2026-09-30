import { cache } from 'react';
import type { CycleReview } from '@tactia/domain';
import type { ObjectiveView, PlanView, TodayPriorityView } from '@/components/app/command-center/types';
import {
  buildTodayBriefingView,
  emptyTodayBriefing,
  type TodayBriefingView,
  type TodayFreshness,
  type TodayProgressItem,
} from '@/lib/command-center-today-view';
import type { TenantContext } from '@/lib/server-context';
import { analyticsService, commandCenterService, recommendationService } from '@/lib/services';

async function safe<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

export const loadTodayBriefing = cache(async (ctx: TenantContext): Promise<TodayBriefingView> => {
  const [objectiveResult, planResult, recommendationResult, progressResult, freshnessResult, cycleReview] =
    await Promise.all([
      safe(() => commandCenterService.listObjectives(ctx)),
      safe(() => commandCenterService.listPlans(ctx)),
      safe(() => recommendationService.list(ctx, { status: 'pending', page: '1', pageSize: '10' })),
      safe(() => analyticsService.getGoalsProgress(ctx)),
      safe(() => analyticsService.getDataFreshness(ctx)),
      safe(() => commandCenterService.getWeeklyCycleReview(ctx)),
    ]);

  return buildTodayBriefingView({
    objectives: (objectiveResult?.items ?? []) as ObjectiveView[],
    plans: (planResult?.items ?? []) as PlanView[],
    recommendations: (recommendationResult?.items ?? []) as TodayPriorityView[],
    progress: (progressResult ?? null) as TodayProgressItem[] | null,
    freshness: (freshnessResult ?? null) as TodayFreshness,
    cycleReview: (cycleReview ?? null) as CycleReview | null,
  });
});

export { emptyTodayBriefing, toTodaySnapshot } from '@/lib/command-center-today-view';
export type { TodayBriefingView } from '@/lib/command-center-today-view';
