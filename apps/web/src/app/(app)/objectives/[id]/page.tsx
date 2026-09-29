import { notFound } from 'next/navigation';
import { ObjectiveProgress } from '@/components/app/command-center/objective-progress';
import { ExecutionTimeline } from '@/components/app/command-center/execution-timeline';
import { EvidencePanel } from '@/components/app/command-center/evidence-panel';
import type { ObjectiveView, PlanView } from '@/components/app/command-center/types';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/ui/feedback';
import { requireTenant } from '@/lib/server-context';
import { analyticsService, commandCenterService } from '@/lib/services';

export default async function ObjectivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant(`/objectives/${id}`);
  const [{ items }, plansResult, progress] = await Promise.all([
    commandCenterService.listObjectives(ctx),
    commandCenterService.listPlans(ctx),
    analyticsService.getGoalsProgress(ctx).catch(() => null),
  ]);
  const objective = (items as ObjectiveView[]).find((item) => item.id === id);
  if (!objective) notFound();
  const plans = (plansResult.items as PlanView[]).filter((plan) => plan.goal.id === id);
  const stats = progress?.find((item) => item.id === id) ?? null;
  const evidence = plans.flatMap((plan) => plan.evidence);
  return <div className="flex flex-col gap-8"><PageHeader title={objective.title ?? 'Objetivo'} description="Direção, planos, execução e resultado permanecem ligados à evidência usada em cada decisão." /><ObjectiveProgress objective={objective} actual={stats?.achieved ?? null} availability={stats ? 'ready' : 'error'} limitation={stats ? null : 'O realizado não pôde ser calculado; nenhum zero substituiu o dado ausente.'} /><section aria-labelledby="objective-plans" className="flex flex-col gap-4"><h2 id="objective-plans" className="font-display text-2xl">Planos acompanhados</h2>{plans.length ? plans.map((plan) => <ExecutionTimeline key={plan.id} plan={plan} />) : <EmptyState title="Plano em preparação" description="A Tactia prepara escopo, responsáveis, medição e fontes. Você será chamado apenas para decisões que exijam sua autoridade." />}</section><section id="evidencias"><EvidencePanel title="Evidências do objetivo" definition="Registros observados, relatos identificados e inferências vinculados aos planos deste objetivo." availability={evidence.length ? 'ready' : 'empty'} items={evidence} limitation={evidence.length ? null : 'Ainda não há evidência operacional vinculada. A ausência permanece visível e sob responsabilidade do Ops.'} /></section></div>;
}
