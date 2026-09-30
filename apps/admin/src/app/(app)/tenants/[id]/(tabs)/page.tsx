import { CustomFieldsPanel } from '@/components/app/custom-fields-panel';
import { TenantProfileForm } from '@/components/app/tenant-actions';
import { TabSection } from '@/components/app/tab-section';
import { loadTenantCustomFields, loadTenantHeader } from '@/lib/tenant-loaders';

export const metadata = { title: 'Cadastro · Empresa · Tactia Ops' };

export default async function TenantProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ tenant }, customFields] = await Promise.all([
    loadTenantHeader(id), loadTenantCustomFields(id),
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

      <CustomFieldsPanel tenantId={tenant.id} fields={customFields.items} />
    </div>
  );
}
