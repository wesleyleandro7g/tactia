import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app/page-header';
import { hasAutomations } from '@/lib/automations-flag';
import { automationService } from '@/lib/automations';
import { requireTenant } from '@/lib/server-context';
import { statusLabel } from '@/components/automations/status-label';

export const metadata = { title: 'Automações · Tactia' };

export default async function AutomationsPage() {
  const ctx = await requireTenant('/automations');
  if (!(await hasAutomations(ctx.tenantId))) notFound();
  const { items } = await automationService.list(ctx);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Automações" description="Rotinas publicadas para esta empresa." />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma automação publicada ainda.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-base font-medium">
                <Link className="underline-offset-4 hover:underline" href={`/automations/${item.id}`}>
                  {item.name}
                </Link>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{item.purpose}</p>
              <p className="mt-3 text-sm">Situação: {statusLabel(item.status)}</p>
              <p className="text-sm">
                Última execução:{' '}
                {item.lastRun ? statusLabel(item.lastRun.status) : 'nenhuma'}
              </p>
              <p className="text-sm">
                Próximo disparo:{' '}
                {item.nextSchedule
                  ? `${item.nextSchedule.name} · ${item.nextSchedule.frequency}${item.nextSchedule.localTime ? ` às ${item.nextSchedule.localTime}` : ''}`
                  : 'sem agendamento'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
