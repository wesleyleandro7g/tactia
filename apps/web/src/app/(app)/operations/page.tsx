import Link from 'next/link';
import { hasMinRole } from '@tactia/domain';
import { DecisionCard, type DecisionView } from '@/components/app/command-center/decision-card';
import { ExecutionTimeline } from '@/components/app/command-center/execution-timeline';
import type { PlanView } from '@/components/app/command-center/types';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { requireTenant } from '@/lib/server-context';
import { approvalService, commandCenterService } from '@/lib/services';

export const metadata = { title: 'Operação · Tactia' };
const TABS = [{ value: 'decisions', label: 'Decisões' }, { value: 'in-progress', label: 'Em andamento' }, { value: 'routines', label: 'Rotinas' }, { value: 'history', label: 'Histórico' }] as const;

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireTenant('/operations');
  const query = await searchParams;
  const tab = TABS.some((item) => item.value === query.tab) ? query.tab! : 'decisions';
  const [plansResult, pendingApprovals] = await Promise.all([
    commandCenterService.listPlans(ctx),
    approvalService.list(ctx, { status: tab === 'history' ? 'approved' : 'pending', page: '1', pageSize: '30' }),
  ]);
  const plans = plansResult.items as PlanView[];
  const decisionContexts = await commandCenterService.listDecisionContexts(
    ctx,
    pendingApprovals.items.map((approval) => approval.id),
  );
  const contextByApproval = new Map(
    decisionContexts.map((item) => [item.approvalId, item]),
  );
  const decisions: DecisionView[] = pendingApprovals.items.map((approval) => {
    const decisionContext = contextByApproval.get(approval.id);
    return ({ id: approval.id, status: approval.status, reason: approval.reason, createdAt: approval.createdAt.toISOString(), versionLabel: decisionContext ? `${decisionContext.planTitle} · plano v${decisionContext.planVersion}` : `decisão ${approval.id.slice(0, 8)}`, canDecide: hasMinRole(ctx.role, 'admin'), execution: { status: approval.actionExecution.status, actionType: approval.actionExecution.action.type, actionName: approval.actionExecution.action.name, input: (approval.actionExecution.input ?? {}) as Record<string, unknown> } });
  });
  const visiblePlans = tab === 'history' ? plans.filter((plan) => ['completed', 'closed'].includes(plan.status)) : plans.filter((plan) => ['active', 'paused'].includes(plan.status));
  return <div className="flex flex-col gap-8"><PageHeader title="Operação" description="O que está sendo feito, o que depende de você e o que a Tactia acompanha automaticamente." actions={<Link href="/approvals" className="text-sm text-primary underline-offset-4 hover:underline">Abrir fila anterior</Link>} /><nav aria-label="Seções da operação" className="flex gap-2 overflow-x-auto pb-1">{TABS.map((item) => <Link key={item.value} href={`/operations?tab=${item.value}`} aria-current={tab === item.value ? 'page' : undefined} className={cn('min-h-10 whitespace-nowrap rounded-full border px-4 py-2 text-sm', tab === item.value ? 'border-primary/30 bg-accent-soft text-primary' : 'border-border text-muted-foreground hover:bg-muted')}>{item.label}</Link>)}</nav>{tab === 'decisions' ? <section aria-labelledby="operation-decisions" className="flex flex-col gap-4"><h2 id="operation-decisions" className="sr-only">Decisões</h2>{decisions.length ? decisions.map((decision) => <DecisionCard key={decision.id} decision={decision} />) : <EmptyState title="Nenhuma decisão necessária agora" description="A operação continua acompanhada. Novas decisões aparecem somente com alcance e evidência suficientes." />}</section> : tab === 'routines' ? <EmptyState title="Rotinas autorizadas" description="Somente rotinas com política persistida aparecerão aqui. Esta interface não amplia autonomia por conta própria." /> : <section aria-labelledby="operation-plans" className="grid gap-4 xl:grid-cols-2"><h2 id="operation-plans" className="sr-only">Planos</h2>{visiblePlans.length ? visiblePlans.map((plan) => <ExecutionTimeline key={plan.id} plan={plan} />) : <EmptyState title={tab === 'history' ? 'Nenhum plano concluído' : 'Nenhum plano em andamento'} description="Os estados são atualizados pelas execuções e fontes existentes, sem manutenção de um quadro pelo cliente." />}</section>}</div>;
}
