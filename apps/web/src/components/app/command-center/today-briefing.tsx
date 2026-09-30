import { ExecutiveSummary } from '@/components/app/command-center/executive-summary';
import { ObjectiveProgress } from '@/components/app/command-center/objective-progress';
import { PriorityCard } from '@/components/app/command-center/priority-card';
import { ExecutionTimeline } from '@/components/app/command-center/execution-timeline';
import { WeeklyCycleExcerpt } from '@/components/app/command-center/weekly-cycle-review';
import { EmptyState } from '@/components/ui/feedback';
import { evidenceLines, type TodayBriefingView } from '@/lib/command-center-today-view';
import { metricLabel } from '@/lib/format';

export function TodayBriefing({ briefing }: { briefing: TodayBriefingView }) {
  const { objective, progress, priorities, plans, activePlans, availability, updatedAt, limitation, cycleReview, hasAnyData, chatHref, evidenceHref } = briefing;
  const planByRecommendation = new Map(
    plans
      .filter((plan) => plan.recommendationId)
      .map((plan) => [plan.recommendationId, plan]),
  );

  return (
    <div className="flex flex-col gap-8">
      {!hasAnyData ? (
        <EmptyState
          title="Seu primeiro diagnóstico está em preparação"
          description="A equipe Tactia está conectando e validando as fontes. Você não precisa cadastrar tarefas nem atualizar status para que o acompanhamento comece."
        />
      ) : null}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]" aria-label="Síntese e objetivo">
        <ExecutiveSummary
          objectiveTitle={objective?.title ?? (objective ? metricLabel(objective.metricKey) : null)}
          periodLabel={briefing.periodLabel}
          summary={
            objective
              ? `A Tactia acompanha ${metricLabel(objective.metricKey)} em relação à meta definida e prepara as decisões que exigem sua autoridade.`
              : null
          }
          attention={priorities[0]?.title ?? null}
          availability={availability}
          limitation={limitation}
          updatedAt={updatedAt}
          evidenceHref={evidenceHref}
          chatHref={chatHref}
        />
        {objective ? (
          <ObjectiveProgress
            objective={objective}
            actual={progress?.achieved ?? null}
            availability={availability}
            updatedAt={updatedAt}
            limitation={limitation}
          />
        ) : null}
      </section>
      <section aria-labelledby="today-priorities" className="flex flex-col gap-4">
        <div>
          <h2 id="today-priorities" className="font-display text-2xl tracking-tight">Prioridades</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Até três próximos passos, ordenados pelo impacto, urgência e possibilidade real de agir.
          </p>
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
                  rankReason={
                    index === 0
                      ? 'Maior combinação atual de impacto, urgência e evidência disponível.'
                      : 'Relacionada ao objetivo e pronta para revisão após a prioridade anterior.'
                  }
                  evidence={evidenceLines(recommendation.insight.evidence)}
                  action={
                    existingPlan
                      ? { label: 'Acompanhar plano', href: `/operations/plans/${existingPlan.id}` }
                      : objective
                        ? null
                        : { label: 'Ver objetivos', href: '/objectives' }
                  }
                  prepare={!existingPlan && objective
                    ? { recommendationId: recommendation.id, goalId: objective.id }
                    : null}
                />
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="Nenhuma decisão necessária agora"
            description="A operação continua acompanhada. Novas decisões aparecem aqui quando houver evidência e uma ação concreta."
          />
        )}
      </section>
      <section aria-labelledby="delegated-work" className="flex flex-col gap-4">
        <div>
          <h2 id="delegated-work" className="font-display text-2xl tracking-tight">Trabalho delegado</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Andamento obtido das fontes e execuções existentes, sem check-in manual.
          </p>
        </div>
        {activePlans.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {activePlans.map((plan) => <ExecutionTimeline key={plan.id} plan={plan} />)}
          </div>
        ) : (
          <EmptyState
            title="Nenhum plano em andamento"
            description="Planos preparados e autorizados aparecerão aqui com o próximo evento esperado."
          />
        )}
      </section>
      {cycleReview ? (
        <section aria-labelledby="today-recent-results" className="flex flex-col gap-4">
          <div>
            <h2 id="today-recent-results" className="font-display text-2xl tracking-tight">Resultados recentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Recorte da janela em curso. A revisão completa permanece em Resultados, sem substituir a medição por indicadores operacionais.
            </p>
          </div>
          <WeeklyCycleExcerpt review={cycleReview} />
        </section>
      ) : null}
    </div>
  );
}
