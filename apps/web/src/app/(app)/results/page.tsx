import Link from 'next/link';
import { OutcomeReview } from '@/components/app/command-center/outcome-review';
import { ReviewDecisionAction } from '@/components/app/command-center/review-decision-action';
import type { PlanView } from '@/components/app/command-center/types';
import { WeeklyCycleReview } from '@/components/app/command-center/weekly-cycle-review';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/ui/feedback';
import { requireTenant } from '@/lib/server-context';
import { commandCenterService } from '@/lib/services';

export const metadata = { title: 'Resultados · Tactia' };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  const ctx = await requireTenant('/results');
  const query = await searchParams;
  const [review, planResult] = await Promise.all([
    commandCenterService.getWeeklyCycleReview(ctx, {
      from: first(query.from),
      to: first(query.to),
    }),
    commandCenterService.listPlans(ctx),
  ]);
  const plans = planResult.items as PlanView[];
  const definitions = plans.flatMap((plan) =>
    plan.measurementDefinitions.map((definition) => ({ plan, definition })),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Resultados"
        description="O acompanhamento consolidado do ciclo, com baseline, janela, fontes e limites de atribuição."
        actions={
          <Link href="/briefings" className="text-sm text-primary underline-offset-4 hover:underline">
            Ver resumos anteriores
          </Link>
        }
      />
      <WeeklyCycleReview review={review} />
      <section aria-labelledby="plan-reviews" className="flex flex-col gap-4">
        <div>
          <h2 id="plan-reviews" className="font-display text-2xl tracking-tight">Revisões por plano</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada definição permanece disponível para continuar, ajustar ou encerrar, sem declarar impacto causal.
          </p>
        </div>
        {definitions.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {definitions.map(({ plan, definition }) => (
              <section key={definition.id} aria-label={`Resultado de ${plan.title}`} className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  Plano:{' '}
                  <Link href={`/operations/plans/${plan.id}`} className="text-primary underline-offset-4 hover:underline">
                    {plan.title}
                  </Link>
                </p>
                <OutcomeReview definition={definition} />
                {plan.status !== 'closed' && definition.reviews[0] && (ctx.role === 'owner' || ctx.role === 'admin') ? (
                  <ReviewDecisionAction
                    planId={plan.id}
                    version={plan.version}
                    reviewId={definition.reviews[0].id}
                  />
                ) : null}
                {plan.reviewDecisions[0] ? (
                  <p className="text-xs text-muted-foreground">
                    Última decisão:{' '}
                    {plan.reviewDecisions[0].choice === 'adjust'
                      ? 'ajustar'
                      : plan.reviewDecisions[0].choice === 'close'
                        ? 'encerrar'
                        : 'continuar'}
                    {' · '}
                    versão {plan.reviewDecisions[0].toVersion}
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nenhum resultado mensurável ainda"
            description="A Tactia prepara a definição e coleta evidências nas fontes. Ausência de dados não será apresentada como zero."
          />
        )}
      </section>
    </div>
  );
}
