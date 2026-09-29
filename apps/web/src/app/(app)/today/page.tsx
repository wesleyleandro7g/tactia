import { ExecutiveSummary } from '@/components/app/command-center/executive-summary';
import { ObjectiveProgress } from '@/components/app/command-center/objective-progress';
import { PriorityCard } from '@/components/app/command-center/priority-card';
import { ExecutionTimeline } from '@/components/app/command-center/execution-timeline';
import type { ObjectiveView, PlanView } from '@/components/app/command-center/types';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/ui/feedback';
import { metricLabel } from '@/lib/format';
import { requireTenant } from '@/lib/server-context';
import { analyticsService, commandCenterService, recommendationService } from '@/lib/services';

export const metadata = { title: 'Hoje · Tactia' };

async function safe<T>(load: () => Promise<T>): Promise<T | null> {
  try { return await load(); } catch { return null; }
}

function evidenceLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { key?: string; value?: unknown };
    return row.key && (typeof row.value === 'number' || typeof row.value === 'string')
      ? [`${metricLabel(row.key)}: ${String(row.value)}`]
      : [];
  });
}

export default async function TodayPage() {
  const ctx = await requireTenant('/today');
  const [objectiveResult, planResult, recommendationResult, progressResult, freshnessResult] = await Promise.all([
    safe(() => commandCenterService.listObjectives(ctx)),
    safe(() => commandCenterService.listPlans(ctx)),
    safe(() => recommendationService.list(ctx, { status: 'pending', page: '1', pageSize: '10' })),
    safe(() => analyticsService.getGoalsProgress(ctx)),
    safe(() => analyticsService.getDataFreshness(ctx)),
  ]);

  const objectives = (objectiveResult?.items ?? []) as ObjectiveView[];
  const plans = (planResult?.items ?? []) as PlanView[];
  const objective = objectives.find((item) => item.status === 'active') ?? objectives[0] ?? null;
  const progress = objective ? progressResult?.find((item) => item.id === objective.id) ?? null : null;
  const priorities = (recommendationResult?.items ?? []).slice(0, 3);
  const planByRecommendation = new Map(
    plans
      .filter((plan) => plan.recommendationId)
      .map((plan) => [plan.recommendationId, plan]),
  );
  const activePlans = plans.filter((plan) => ['active', 'paused'].includes(plan.status)).slice(0, 3);
  const hasAnyData = objectives.length || priorities.length || plans.length;
  const sourceDates = (freshnessResult?.sources ?? [])
    .map((source) => source.lastSyncAt ? new Date(source.lastSyncAt) : null)
    .filter((date): date is Date => date !== null);
  const coverageAt =
    freshnessResult &&
    freshnessResult.sources.length > 0 &&
    sourceDates.length === freshnessResult.sources.length
      ? new Date(Math.min(...sourceDates.map((date) => date.getTime())))
      : null;
  const availability = !objective
    ? 'empty' as const
    : !progress
      ? 'error' as const
      : !freshnessResult || freshnessResult.sources.length === 0
        ? 'partial' as const
        : freshnessResult.staleCount > 0
          ? 'stale' as const
          : 'ready' as const;
  const updatedAt = coverageAt
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(coverageAt)
    : null;
  const limitation = !progress
    ? 'Não foi possível atualizar o realizado. A meta continua visível, mas nenhuma conclusão usa zero como substituto.'
    : !freshnessResult || freshnessResult.sources.length === 0
      ? 'A cobertura das fontes ainda não está disponível.'
      : freshnessResult.staleCount > 0
        ? `${freshnessResult.staleCount} fonte(s) estão desatualizadas; conclusões dependentes permanecem limitadas.`
        : null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
      <PageHeader title="Hoje" description="O que mudou, o que depende de você e o que a Tactia continua acompanhando." />
      {!hasAnyData ? <EmptyState title="Seu primeiro diagnóstico está em preparação" description="A equipe Tactia está conectando e validando as fontes. Você não precisa cadastrar tarefas nem atualizar status para que o acompanhamento comece." /> : null}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]" aria-label="Síntese e objetivo">
        <ExecutiveSummary objectiveTitle={objective?.title ?? (objective ? metricLabel(objective.metricKey) : null)} periodLabel="Período atual" summary={objective ? `A Tactia acompanha ${metricLabel(objective.metricKey)} em relação à meta definida e prepara as decisões que exigem sua autoridade.` : null} attention={priorities[0]?.title ?? null} availability={availability} limitation={limitation} updatedAt={updatedAt} evidenceHref={objective ? `/objectives/${objective.id}#evidencias` : null} chatHref={objective ? `/chat?contextType=objective&contextId=${objective.id}` : '/chat'} />
        {objective ? <ObjectiveProgress objective={objective} actual={progress?.achieved ?? null} availability={availability} updatedAt={updatedAt} limitation={limitation} /> : null}
      </section>
      <section aria-labelledby="today-priorities" className="flex flex-col gap-4">
        <div>
          <h2 id="today-priorities" className="font-display text-2xl tracking-tight">Prioridades</h2>
          <p className="mt-1 text-sm text-muted-foreground">Até três próximos passos, ordenados pelo impacto, urgência e possibilidade real de agir.</p>
        </div>
        {priorities.length ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {priorities.map((recommendation, index) => {
              const existingPlan = planByRecommendation.get(recommendation.id);
              return (
                <PriorityCard
                  key={recommendation.id}
                  rank={index + 1}
                  title={recommendation.title}
                  summary={recommendation.description}
                  severity={recommendation.insight.severity}
                  rankReason={index === 0 ? 'Maior combinação atual de impacto, urgência e evidência disponível.' : 'Relacionada ao objetivo e pronta para revisão após a prioridade anterior.'}
                  evidence={evidenceLines(recommendation.insight.evidence)}
                  action={existingPlan
                    ? { label: 'Acompanhar plano', href: `/operations/plans/${existingPlan.id}` }
                    : objective
                      ? null
                      : { label: 'Ver objetivos', href: '/objectives' }}
                  prepare={!existingPlan && objective
                    ? { recommendationId: recommendation.id, goalId: objective.id }
                    : null}
                />
              );
            })}
          </div>
        ) : (
          <EmptyState title="Nenhuma decisão necessária agora" description="A operação continua acompanhada. Novas decisões aparecem aqui quando houver evidência e uma ação concreta." />
        )}
      </section>
      <section aria-labelledby="delegated-work" className="flex flex-col gap-4"><div><h2 id="delegated-work" className="font-display text-2xl tracking-tight">Trabalho delegado</h2><p className="mt-1 text-sm text-muted-foreground">Andamento obtido das fontes e execuções existentes, sem check-in manual.</p></div>{activePlans.length ? <div className="grid gap-4 xl:grid-cols-2">{activePlans.map((plan) => <ExecutionTimeline key={plan.id} plan={plan} />)}</div> : <EmptyState title="Nenhum plano em andamento" description="Planos preparados e autorizados aparecerão aqui com o próximo evento esperado." />}</section>
    </div>
  );
}
