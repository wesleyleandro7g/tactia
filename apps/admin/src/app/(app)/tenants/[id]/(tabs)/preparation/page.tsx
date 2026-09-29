import { CommandCenterPreparationEditor } from '@/components/app/command-center-preparation-editor';
import { TabSection } from '@/components/app/tab-section';
import { PREPARATION_METRICS, listPreparation } from '@/lib/command-center-preparation';
import { loadOperator } from '@/lib/tenant-loaders';

export const metadata = { title: 'Preparação · Empresa · Tactia Ops' };

export default async function TenantPreparationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await loadOperator(id);
  const preparation = await listPreparation(ctx, id);

  return (
    <TabSection title="Central de Comando">
      <CommandCenterPreparationEditor tenantId={id} {...preparation} metrics={PREPARATION_METRICS} />
    </TabSection>
  );
}
