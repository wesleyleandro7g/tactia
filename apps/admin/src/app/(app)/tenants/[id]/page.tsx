import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app/page-header';
import {
  AddUserForm,
  MembershipControls,
  ReprocessButton,
  ResetPasswordButton,
  SyncButton,
  TenantActions,
  TenantProfileForm,
} from '@/components/app/tenant-actions';
import { Badge, severityTone, statusTone } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardLabel } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import {
  formatDateTime,
  formatInteger,
  SEVERITY_LABELS,
  SYNC_STATUS_LABELS,
  TENANT_STATUS_LABELS,
} from '@/lib/format';
import { requireOperator } from '@/lib/server-context';
import { backofficeService } from '@/lib/services';
import { sourceKindDisplayLabel, sourceKindHasConnector } from '@tactia/domain';

export const metadata = { title: 'Empresa · Tactia Ops' };

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireOperator(`/tenants/${id}`);
  const detail = await backofficeService.getTenant(ctx, id).catch(() => null);
  if (!detail) notFound();

  const { tenant, users, dataSources, syncJobs, imports, insights, auditLogs } = detail;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/" className="font-mono text-xs text-primary hover:underline">
          ← Empresas
        </Link>
        <PageHeader
          className="mt-2"
          title={tenant.name}
          description={
            <>
              <span className="font-mono">{tenant.slug}</span> · {tenant.currency} · {tenant.timezone} ·{' '}
              <Badge tone={statusTone(tenant.status)}>{TENANT_STATUS_LABELS[tenant.status] ?? tenant.status}</Badge>
            </>
          }
          actions={<TenantActions tenantId={tenant.id} status={tenant.status} />}
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">Cadastro</h2>
        <TenantProfileForm
          tenantId={tenant.id}
          name={tenant.name}
          timezone={tenant.timezone}
          currency={tenant.currency}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">Usuários</h2>
        <AddUserForm tenantId={tenant.id} />
        <DataTable
          caption={`Usuários de ${tenant.name}`}
          columns={[
            { key: 'name', header: 'Nome', render: (row: (typeof users)[number]) => row.user.name },
            { key: 'email', header: 'E-mail', render: (row) => row.user.email },
            {
              key: 'role',
              header: 'Papel / status',
              render: (row) => (
                <MembershipControls
                  tenantId={tenant.id}
                  membershipId={row.id}
                  role={row.role}
                  status={row.status}
                />
              ),
            },
            {
              key: 'password',
              header: 'Senha',
              render: (row) => <ResetPasswordButton tenantId={tenant.id} userId={row.userId} />,
            },
          ]}
          rows={users}
          rowKey={(row) => row.id}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">Fontes de dados</h2>
          <Link href={`/tenants/${tenant.id}/data-sources/new`} className={buttonVariants()}>
            Nova fonte
          </Link>
        </div>
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
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">Sync jobs</h2>
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
              render: (row) =>
                row.error ? <span className="text-danger">{row.error}</span> : '—',
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

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">Imports</h2>
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
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">Insights recentes</h2>
        {insights.length === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">Nenhum insight gerado.</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {insights.map((insight) => (
              <li key={insight.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p>{insight.title}</p>
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

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">Audit log</h2>
        <DataTable
          caption={`Audit log de ${tenant.name}`}
          columns={[
            {
              key: 'when',
              header: 'Quando',
              render: (row: (typeof auditLogs)[number]) => formatDateTime(row.createdAt),
            },
            { key: 'action', header: 'Ação', render: (row) => <span className="font-mono text-xs">{row.action}</span> },
            { key: 'actor', header: 'Ator', render: (row) => row.actorType },
            { key: 'entity', header: 'Entidade', render: (row) => `${row.entityType} · ${row.entityId.slice(0, 8)}` },
          ]}
          rows={auditLogs}
          rowKey={(row) => row.id}
          emptyLabel="Nenhum evento."
        />
      </section>
    </div>
  );
}
