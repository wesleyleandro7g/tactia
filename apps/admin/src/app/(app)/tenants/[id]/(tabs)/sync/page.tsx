import { CancelSyncButton, ReprocessButton } from '@/components/app/tenant-actions';
import { TabSection } from '@/components/app/tab-section';
import { Badge, statusTone } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { formatDateTime, formatInteger, SYNC_STATUS_LABELS } from '@/lib/format';
import { loadTenantHeader, loadTenantSyncHistory } from '@/lib/tenant-loaders';

export const metadata = { title: 'Sincronização · Empresa · Tactia Ops' };

export default async function TenantSyncPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ tenant }, { syncJobs, imports }] = await Promise.all([
    loadTenantHeader(id),
    loadTenantSyncHistory(id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <TabSection title="Sync jobs">
        <DataTable
          caption={`Sync jobs de ${tenant.name}`}
          columns={[
            {
              key: 'status',
              header: 'Status',
              render: (row: (typeof syncJobs)[number]) => (
                <Badge tone={statusTone(row.status)}>{SYNC_STATUS_LABELS[row.status] ?? row.status}</Badge>
              ),
            },
            {
              key: 'counters',
              header: 'Lidos / criados / atualizados / falhas',
              numeric: true,
              render: (row) =>
                `${formatInteger(row.recordsRead)} / ${formatInteger(row.recordsCreated)} / ${formatInteger(row.recordsUpdated)} / ${formatInteger(row.recordsFailed)}`,
            },
            {
              key: 'error',
              header: 'Erro',
              render: (row) => (row.error ? <span className="text-danger">{row.error}</span> : '—'),
            },
            {
              key: 'created',
              header: 'Início',
              render: (row) => formatDateTime(row.createdAt),
            },
            {
              key: 'actions',
              header: 'Ações',
              render: (row) =>
                row.status === 'pending' || row.status === 'running' ? (
                  <CancelSyncButton tenantId={tenant.id} syncJobId={row.id} />
                ) : (
                  '—'
                ),
            },
          ]}
          rows={syncJobs}
          rowKey={(row) => row.id}
          emptyLabel="Nenhum sync executado."
        />
      </TabSection>

      <TabSection title="Imports">
        <DataTable
          caption={`Imports de ${tenant.name}`}
          columns={[
            { key: 'entity', header: 'Entidade', render: (row: (typeof imports)[number]) => row.entityType },
            {
              key: 'status',
              header: 'Status',
              render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>,
            },
            {
              key: 'records',
              header: 'Registros',
              numeric: true,
              render: (row) => formatInteger(row.totalRecords),
            },
            {
              key: 'created',
              header: 'Quando',
              render: (row) => formatDateTime(row.createdAt),
            },
            {
              key: 'actions',
              header: 'Ações',
              render: (row) => <ReprocessButton tenantId={tenant.id} importId={row.id} />,
            },
          ]}
          rows={imports}
          rowKey={(row) => row.id}
          emptyLabel="Nenhum import registrado."
        />
      </TabSection>
    </div>
  );
}
