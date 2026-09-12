import { GoalsSettings } from '@/components/app/goals-settings';
import { requireTenant } from '@/lib/server-context';
import { analyticsService, goalService } from '@/lib/services';

export const metadata = { title: 'Metas · Tactia' };

export default async function GoalsSettingsPage() {
  const ctx = await requireTenant('/settings/goals');
  const [{ items }, progress] = await Promise.all([
    goalService.list(ctx),
    analyticsService.getGoalsProgress(ctx),
  ]);
  const byId = new Map(progress.map((goal) => [goal.id, goal]));

  return (
    <GoalsSettings
      goals={items.map((goal) => {
        const stats = byId.get(goal.id);
        return {
          id: goal.id,
          metricKey: goal.metricKey,
          scope: goal.scope,
          periodType: goal.periodType,
          periodStart: typeof goal.periodStart === 'string' ? goal.periodStart : goal.periodStart.toISOString(),
          target: Number(goal.target),
          achieved: stats?.achieved ?? 0,
          progress: stats?.progress ?? 0,
          requiredDailyPace: stats?.requiredDailyPace ?? null,
          onTrack: stats?.onTrack ?? null,
        };
      })}
    />
  );
}
