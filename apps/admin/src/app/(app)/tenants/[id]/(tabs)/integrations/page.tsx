import Link from 'next/link';
import { SyncButton } from '@/components/app/tenant-actions';
import { TabSection } from '@/components/app/tab-section';
import { Badge, statusTone } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { formatDateTime } from '@/lib/format';
import { loadTenantDataSources, loadTenantHeader } from '@/lib/tenant-loaders';
import { sourceKindDisplayLabel, sourceKindHasConnector } from '@tactia/domain';

export const metadata = { title: 'Integrações · Empresa · Tactia Ops' };

export default async function TenantIntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ tenant }, dataSources] = await Promise.all([loadTenantHeader(id), loadTenantDataSources(id)]);

  return (
    <div className="flex flex-col gap-8">
      <TabSection
        title="Fontes de dados"
        actions={
          <Link href={`/tenants/${tenant.id}/data-sources/new`} className={buttonVariants()}>
            Nova fonte
          </Link>
        }
      >
        <DataTable
          caption={`Fontes de ${tenant.name}`}
          columns={[
            {
              key: 'name',
              header: 'Fonte',
              render: (row: (typeof dataSources)[number]) => (
                <Link href={`/tenants/${tenant.id}/data-sources/${row.id}`} className="text-primary hover:underline">
                  {row.name}
                </Link>
              ),
            },
            {
              key: 'type',
              header: 'Tipo',
              render: (row) => sourceKindDisplayLabel(row.type, row.configuration),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>,
            },
            {
              key: 'lastSync',
              header: 'Último sync',
              render: (row) => (row.lastSyncAt ? formatDateTime(row.lastSyncAt) : '—'),
            },
            {
              key: 'actions',
              header: 'Ações',
              render: (row) =>
                sourceKindHasConnector(row.type) ? (
                  <SyncButton tenantId={tenant.id} dataSourceId={row.id} />
                ) : (
                  <span className="text-xs text-muted-foreground">Sem conector</span>
                ),
            },
          ]}
          rows={dataSources}
          rowKey={(row) => row.id}
          emptyLabel="Nenhuma fonte configurada."
        />
      </TabSection>

    </div>
  );
}
