import Link from 'next/link';
import { hasMinRole } from '@tactia/domain';
import { ExecutionTimeline } from '@/components/app/command-center/execution-timeline';
import { EvidencePanel } from '@/components/app/command-center/evidence-panel';
import { OutcomeReview } from '@/components/app/command-center/outcome-review';
import { PlanExecutionAction, type SuggestedPlanAction } from '@/components/app/command-center/plan-execution-action';
import type { PlanView } from '@/components/app/command-center/types';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/ui/feedback';
import { requireTenant } from '@/lib/server-context';
import { commandCenterService } from '@/lib/services';

function suggestedAction(scope: unknown): SuggestedPlanAction | null {
  if (!scope || typeof scope !== 'object') return null;
  const candidate = (scope as { suggestedAction?: unknown }).suggestedAction;
  if (!candidate || typeof candidate !== 'object') return null;
  const row = candidate as Record<string, unknown>;
  if (
    (row.actionType !== 'create_task' && row.actionType !== 'send_email') ||
    !row.input ||
    typeof row.input !== 'object' ||
    typeof row.reason !== 'string'
  ) return null;
  return {
    actionType: row.actionType,
    input: row.input as Record<string, unknown>,
    reason: row.reason,
  };
}

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant(`/operations/plans/${id}`);
  const plan = await commandCenterService.getPlan(ctx, id) as PlanView;
  const firstStep = plan.steps[0] ?? null;
  const action = suggestedAction(plan.scope);
  const canPropose = hasMinRole(ctx.role, 'admin');

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={plan.title}
        description={plan.summary ?? 'Plano preparado e acompanhado pela Tactia nas fontes existentes.'}
        actions={
          <Link
            href={`/chat?contextType=plan&contextId=${plan.id}`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Conversar sobre este plano
          </Link>
        }
      />
      {firstStep && action && firstStep.executions.length === 0 && canPropose ? (
        <section aria-labelledby="prepared-action" className="max-w-2xl">
          <h2 id="prepared-action" className="mb-3 font-display text-2xl">Próxima decisão</h2>
          <PlanExecutionAction
            planId={plan.id}
            planVersion={plan.version}
            stepId={firstStep.id}
            action={action}
          />
        </section>
      ) : null}
      <ExecutionTimeline plan={plan} />
      <EvidencePanel
        title="Evidências do plano"
        definition="Fatos observados, relatos identificados e inferências preservadas com sua proveniência."
        availability={plan.evidence.length ? 'ready' : plan.gaps.length ? 'partial' : 'empty'}
        items={plan.evidence}
        limitation={plan.gaps[0]?.reason ?? (plan.evidence.length ? null : 'Ainda não há evidência operacional vinculada. Nenhum status manual é solicitado.')}
      />
      <section aria-labelledby="plan-results" className="flex flex-col gap-4">
        <h2 id="plan-results" className="font-display text-2xl">Resultados</h2>
        {plan.measurementDefinitions.length ? (
          plan.measurementDefinitions.map((definition) => (
            <OutcomeReview key={definition.id} definition={definition} />
          ))
        ) : (
          <EmptyState
            title="Medição em preparação"
            description="A definição de resultado e suas fontes serão configuradas antes de qualquer conclusão."
          />
        )}
      </section>
    </div>
  );
}
