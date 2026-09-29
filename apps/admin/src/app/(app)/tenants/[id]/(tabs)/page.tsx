import { CustomFieldsPanel } from '@/components/app/custom-fields-panel';
import { TenantProfileForm } from '@/components/app/tenant-actions';
import { CommandCenterRelease } from '@/components/app/command-center-release';
import { TabSection } from '@/components/app/tab-section';
import { loadTenantCustomFields, loadTenantHeader } from '@/lib/tenant-loaders';
import { getCommandCenterRelease } from '@/lib/command-center-release';
import { loadOperator } from '@/lib/tenant-loaders';

export const metadata = { title: 'Cadastro · Empresa · Tactia Ops' };

export default async function TenantProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await loadOperator(id);
  const [{ tenant }, customFields, release] = await Promise.all([
    loadTenantHeader(id), loadTenantCustomFields(id), getCommandCenterRelease(ctx, id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <TabSection title="Dados da empresa">
        <TenantProfileForm
          tenantId={tenant.id}
          name={tenant.name}
          timezone={tenant.timezone}
          currency={tenant.currency}
        />
      </TabSection>

      <TabSection title="Central de Comando">
        <CommandCenterRelease tenantId={tenant.id} enabled={release.enabled} />
      </TabSection>

      <CustomFieldsPanel tenantId={tenant.id} fields={customFields.items} />
    </div>
  );
}
