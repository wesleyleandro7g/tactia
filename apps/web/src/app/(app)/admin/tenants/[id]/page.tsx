import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OperatorActionButton } from '@/components/app/operator-action-button';
import { Badge, severityTone, statusTone } from '@/components/ui/badge';
import { Card, CardLabel } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { SEVERITY_LABELS, SYNC_STATUS_LABELS, formatDateTime, formatInteger } from '@/lib/format';
import { getTenantDetail } from '@/lib/admin';
import { isOperator } from '@/lib/operator';
import { requireUser } from '@/lib/server-context';

export const metadata = { title: 'Tenant · Admin · Tactia' };

export default async function AdminTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser(`/admin/tenants/${id}`);
  if (!(await isOperator(ctx))) notFound();

  const detail = await getTenantDetail(ctx, id).catch(() => null);
  if (!detail) notFound();

  const { tenant, users, dataSources, syncJobs, imports, insights } = detail;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <Link href="/admin" className="text-sm text-accent">
          ← Todos os tenants
        </Link>
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <p className="text-sm text-muted">
          {tenant.slug} · {tenant.currency} · {tenant.timezone} ·{' '}
          <Badge tone={statusTone(tenant.status)}>{tenant.status}</Badge>
        </p>
      </header>

      <section aria-labelledby="users" className="flex flex-col gap-3">
        <h2 id="users" className="text-lg font-medium">
          Usuários
        </h2>
        <DataTable
          caption={`Usuários de ${tenant.name}`}
          columns={[
            { key: 'name', header: 'Nome', render: (row: (typeof users)[number]) => row.user.name },
            { key: 'email', header: 'E-mail', render: (row) => row.user.email },
            { key: 'role', header: 'Papel', render: (row) => row.role },
            {
              key: 'status',
              header: 'Status',
              render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>,
            },
          ]}
          rows={users}
          rowKey={(row) => row.id}
        />
      </section>

      <section aria-labelledby="sources" className="flex flex-col gap-3">
        <h2 id="sources" className="text-lg font-medium">
          Fontes de dados
        </h2>
        <DataTable
          caption={`Fontes de dados de ${tenant.name}`}
          columns={[
            {
              key: 'name',
              header: 'Fonte',
              render: (row: (typeof dataSources)[number]) => row.name,
            },
            { key: 'type', header: 'Tipo', render: (row) => row.type },
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
              render: (row) => (
                <OperatorActionButton
                  endpoint="sync"
                  payload={{ tenantId: tenant.id, dataSourceId: row.id }}
                  label="Disparar sync"
                  pendingLabel="Sincronizando…"
                />
              ),
            },
          ]}
          rows={dataSources}
          rowKey={(row) => row.id}
          emptyLabel="Nenhuma fonte configurada."
        />
      </section>

      <section aria-labelledby="jobs" className="flex flex-col gap-3">
        <h2 id="jobs" className="text-lg font-medium">
          Sync jobs
        </h2>
        <DataTable
          caption={`Últimos sync jobs de ${tenant.name}`}
          columns={[
            {
              key: 'status',
              header: 'Status',
              render: (row: (typeof syncJobs)[number]) => (
                <Badge tone={statusTone(row.status)}>
                  {SYNC_STATUS_LABELS[row.status] ?? row.status}
                </Badge>
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
              render: (row) =>
                row.error ? <span className="text-danger">{row.error}</span> : <span className="text-subtle">—</span>,
            },
            {
              key: 'created',
              header: 'Início',
              render: (row) => formatDateTime(row.createdAt),
            },
          ]}
          rows={syncJobs}
          rowKey={(row) => row.id}
          emptyLabel="Nenhum sync executado."
        />
      </section>

      <section aria-labelledby="imports" className="flex flex-col gap-3">
        <h2 id="imports" className="text-lg font-medium">
          Imports
        </h2>
        <DataTable
          caption={`Imports recentes de ${tenant.name}`}
          columns={[
            {
              key: 'entity',
              header: 'Entidade',
              render: (row: (typeof imports)[number]) => row.entityType,
            },
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
              render: (row) => (
                <OperatorActionButton
                  endpoint="reprocess-import"
                  payload={{ tenantId: tenant.id, importId: row.id }}
                  label="Reprocessar"
                  pendingLabel="Reprocessando…"
                />
              ),
            },
          ]}
          rows={imports}
          rowKey={(row) => row.id}
          emptyLabel="Nenhum import registrado."
        />
      </section>

      <section aria-labelledby="admin-insights" className="flex flex-col gap-3">
        <h2 id="admin-insights" className="text-lg font-medium">
          Insights recentes
        </h2>
        {insights.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">Nenhum insight gerado.</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {insights.map((insight) => (
              <li key={insight.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="text-sm">{insight.title}</p>
                    <CardLabel>
                      {insight.ruleKey} · {formatDateTime(insight.createdAt)}
                    </CardLabel>
                  </div>
                  <div className="flex gap-2">
                    <Badge tone={severityTone(insight.severity)}>
                      {SEVERITY_LABELS[insight.severity] ?? insight.severity}
                    </Badge>
                    <Badge tone={statusTone(insight.status)}>{insight.status}</Badge>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
