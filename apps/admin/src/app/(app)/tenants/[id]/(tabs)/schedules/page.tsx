import { notFound } from 'next/navigation';
import { SchedulesPanel } from '@/components/app/schedules-panel';
import { TabSection } from '@/components/app/tab-section';
import { listTenantSchedules } from '@/lib/tenant-schedules';
import { loadOperator } from '@/lib/tenant-loaders';
import { ErrorCode, isAppError } from '@tactia/shared';

export const metadata = { title: 'Agendamentos · Empresa · Tactia Ops' };

export default async function TenantSchedulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await loadOperator(id);

  let items: Awaited<ReturnType<typeof listTenantSchedules>>['items'];
  try {
    ({ items } = await listTenantSchedules(ctx, id));
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  }

  return (
    <TabSection title="Agendamentos">
      <p className="text-sm text-muted-foreground">
        Agendamentos por empresa que disparam o agente de IA ou uma ação. A execução automática
        ocorre no tick do app; você pode disparar um agora ou desativá-lo aqui.
      </p>
      <SchedulesPanel
        apiBasePath={`/api/v1/tenants/${id}/schedules`}
        schedules={items.map((schedule) => ({
          id: schedule.id,
          name: schedule.name,
          target: schedule.target,
          effectMode: schedule.effectMode,
          frequency: schedule.frequency,
          enabled: schedule.enabled,
          repeatMode: schedule.repeatMode,
          maxOccurrences: schedule.maxOccurrences,
          successCount: schedule.successCount,
        }))}
      />
    </TabSection>
  );
}
