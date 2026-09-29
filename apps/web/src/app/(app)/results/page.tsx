import Link from 'next/link';
import { OutcomeReview } from '@/components/app/command-center/outcome-review';
import type { PlanView } from '@/components/app/command-center/types';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/ui/feedback';
import { requireTenant } from '@/lib/server-context';
import { commandCenterService } from '@/lib/services';

export const metadata = { title: 'Resultados · Tactia' };

export default async function ResultsPage() {
  const ctx = await requireTenant('/results');
  const { items } = await commandCenterService.listPlans(ctx);
  const plans = items as PlanView[];
  const definitions = plans.flatMap((plan) => plan.measurementDefinitions.map((definition) => ({ plan, definition })));
  return <div className="flex flex-col gap-8"><PageHeader title="Resultados" description="O que mudou no negócio, com baseline, janela, fontes e limites de atribuição." actions={<Link href="/briefings" className="text-sm text-primary underline-offset-4 hover:underline">Ver resumos anteriores</Link>} />{definitions.length ? <div className="grid gap-4 lg:grid-cols-2">{definitions.map(({ plan, definition }) => <section key={definition.id} aria-label={`Resultado de ${plan.title}`} className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">Plano: <Link href={`/operations/plans/${plan.id}`} className="text-primary underline-offset-4 hover:underline">{plan.title}</Link></p><OutcomeReview definition={definition} /></section>)}</div> : <EmptyState title="Nenhum resultado mensurável ainda" description="A Tactia prepara a definição e coleta evidências nas fontes. Ausência de dados não será apresentada como zero." />}</div>;
}
