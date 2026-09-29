import Link from 'next/link';
import { ObjectiveProgress } from '@/components/app/command-center/objective-progress';
import type { ObjectiveView } from '@/components/app/command-center/types';
import { PageHeader } from '@/components/app/page-header';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { requireTenant } from '@/lib/server-context';
import { analyticsService, commandCenterService } from '@/lib/services';

export const metadata = { title: 'Objetivos · Tactia' };

export default async function ObjectivesPage() {
  const ctx = await requireTenant('/objectives');
  const [{ items }, progress] = await Promise.all([
    commandCenterService.listObjectives(ctx),
    analyticsService.getGoalsProgress(ctx).catch(() => null),
  ]);
  const objectives = items as ObjectiveView[];
  const progressById = new Map((progress ?? []).map((item) => [item.id, item]));
  return <div className="flex flex-col gap-8"><PageHeader title="Objetivos" description="Aonde queremos chegar e como a Tactia acompanha o plano pelas fontes existentes." />{objectives.length ? <div className="grid gap-4 lg:grid-cols-2">{objectives.map((objective) => { const stats = progressById.get(objective.id); return <div key={objective.id} className="flex flex-col gap-3"><ObjectiveProgress objective={objective} actual={stats?.achieved ?? null} availability={stats ? 'ready' : 'error'} limitation={stats ? null : 'O realizado não está disponível. A equipe Tactia está verificando a fonte.'} /><Link href={`/objectives/${objective.id}`} className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'self-start')}>Ver objetivo e planos</Link></div>; })}</div> : <EmptyState title="Objetivo em preparação" description="A Tactia reutiliza o contexto da empresa e das fontes para propor o primeiro objetivo. Nenhum cadastro operacional é necessário." />}</div>;
}
