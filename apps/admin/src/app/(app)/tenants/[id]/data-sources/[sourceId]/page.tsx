import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataSourceManagePanel } from '@/components/app/data-source-manage-panel';
import { BrowserIntegrationPanel } from '@/components/app/browser-integration-panel';
import { PageHeader } from '@/components/app/page-header';
import { Badge, statusTone } from '@/components/ui/badge';
import { sourceKindDisplayLabel } from '@tactia/domain';
import { ErrorCode, isAppError, type RequestContext } from '@tactia/shared';
import { formatDateTime } from '@/lib/format';
import { requireOperator } from '@/lib/server-context';
import { backofficeService } from '@/lib/services';

export const metadata = { title: 'Fonte de dados · Tactia Ops' };

async function loadDataSourcePage(ctx: RequestContext, tenantId: string, sourceId: string) {
  try {
    return await Promise.all([
      backofficeService.getTenant(ctx, tenantId),
      backofficeService.getDataSource(ctx, tenantId, sourceId),
    ]);
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  }
}

export default async function DataSourceDetailPage({
  params,
}: {
  params: Promise<{ id: string; sourceId: string }>;
}) {
  const { id, sourceId } = await params;
  const { ctx } = await requireOperator(`/tenants/${id}/data-sources/${sourceId}`);
  const [tenant, source] = await loadDataSourcePage(ctx, id, sourceId);

  const kindLabel = sourceKindDisplayLabel(
    source.dataSource.type,
    source.dataSource.configuration,
  );
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
              {kindLabel} ·{' '}
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
        moduleRuns={source.moduleRuns.map((run) => ({
          id: run.id,
          moduleKey: run.moduleKey,
          status: run.status,
          attempt: run.attempt,
          workflowVersion: run.workflowVersion,
          parserVersion: run.parserVersion,
          recordsRead: run.recordsRead,
          recordsFailed: run.recordsFailed,
          safeMessage: run.safeMessage,
          startedAt: run.startedAt?.toISOString() ?? null,
          finishedAt: run.finishedAt?.toISOString() ?? null,
          artifactCount: run.artifacts.length,
          artifactIds: run.artifacts.map((artifact) => artifact.id),
        }))}
        connectorAvailable={source.connectorAvailable}
      />
      {source.dataSource.type === 'torge' ? (
        <section className="flex flex-col gap-4">
          <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
            Integração dinâmica (Figranium)
          </h2>
          <BrowserIntegrationPanel tenantId={id} />
        </section>
      ) : null}
    </div>
  );
}

type MappingRow = {
  configuration: { fields?: Array<{ source: string; target: string }> };
};
