import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataSourceManagePanel } from '@/components/app/data-source-manage-panel';
import { PageHeader } from '@/components/app/page-header';
import { Badge, statusTone } from '@/components/ui/badge';
import { getSourceKind } from '@tactia/domain';
import { formatDateTime } from '@/lib/format';
import { requireOperator } from '@/lib/server-context';
import { backofficeService } from '@/lib/services';

export const metadata = { title: 'Fonte de dados · Tactia Ops' };

export default async function DataSourceDetailPage({
  params,
}: {
  params: Promise<{ id: string; sourceId: string }>;
}) {
  const { id, sourceId } = await params;
  const { ctx } = await requireOperator(`/tenants/${id}/data-sources/${sourceId}`);
  const [tenant, source] = await Promise.all([
    backofficeService.getTenant(ctx, id).catch(() => null),
    backofficeService.getDataSource(ctx, id, sourceId).catch(() => null),
  ]);
  if (!tenant || !source) notFound();

  const kind = getSourceKind(source.dataSource.type);
  const lastSync = source.dataSource.lastSyncAt
    ? formatDateTime(source.dataSource.lastSyncAt)
    : 'nunca';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/tenants/${id}`} className="font-mono text-xs text-primary hover:underline">
          ← {tenant.tenant.name}
        </Link>
        <PageHeader
          className="mt-2"
          title={source.dataSource.name}
          description={
            <>
              {kind?.label ?? source.dataSource.type} ·{' '}
              <Badge tone={statusTone(source.dataSource.status)}>{source.dataSource.status}</Badge> ·
              último sync {lastSync}
            </>
          }
        />
      </div>
      <DataSourceManagePanel
        tenantId={id}
        dataSource={{
          id: source.dataSource.id,
          name: source.dataSource.name,
          type: source.dataSource.type,
          status: source.dataSource.status,
          configuration: (source.dataSource.configuration as Record<string, unknown> | null) ?? null,
          lastSyncAt: source.dataSource.lastSyncAt,
          credential: source.dataSource.credential,
        }}
        mappings={source.mappings.map((row) => ({
          id: row.id,
          sourceEntity: row.sourceEntity,
          targetEntity: row.targetEntity,
          active: row.active,
          configuration: row.configuration as MappingRow['configuration'],
        }))}
        connectorAvailable={source.connectorAvailable}
      />
    </div>
  );
}

type MappingRow = {
  configuration: { fields?: Array<{ source: string; target: string }> };
};
