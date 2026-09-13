import Link from 'next/link';
import { hasMinRole } from '@tactia/domain';
import { ApprovalQueue, type ApprovalView } from '@/components/app/approval-queue';
import { PageHeader } from '@/components/app/page-header';
import { Badge, statusTone } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { cn } from '@/lib/cn';
import { ACTION_TYPE_LABELS, EXECUTION_STATUS_LABELS, formatDateTime } from '@/lib/format';
import { requireTenant } from '@/lib/server-context';
import { actionService, approvalService } from '@/lib/services';

export const metadata = { title: 'Aprovações · Tactia' };

type SearchParams = { status?: string };

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pendentes' },
  { value: 'approved', label: 'Aprovadas' },
  { value: 'rejected', label: 'Rejeitadas' },
];

/** Fila de aprovações + histórico recente de execuções (spec §31–32). */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireTenant('/approvals');
  const params = await searchParams;
  const status = STATUS_FILTERS.some((filter) => filter.value === params.status)
    ? params.status!
    : 'pending';

  const [approvalPage, executionPage] = await Promise.all([
    approvalService.list(ctx, { status, page: '1', pageSize: '20' }),
    actionService.listExecutions(ctx, { page: '1', pageSize: '10' }),
  ]);

  const approvals: ApprovalView[] = approvalPage.items.map((approval) => ({
    id: approval.id,
    status: approval.status,
    reason: approval.reason,
    createdAt: approval.createdAt.toISOString(),
    requestedBy: approval.requestedBy,
    execution: {
      id: approval.actionExecution.id,
      status: approval.actionExecution.status,
      origin: approval.actionExecution.origin,
      input: (approval.actionExecution.input ?? {}) as Record<string, unknown>,
      output: (approval.actionExecution.output ?? null) as Record<string, unknown> | null,
      error: approval.actionExecution.error,
      actionType: approval.actionExecution.action.type,
      actionName: approval.actionExecution.action.name,
    },
  }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Aprovações"
        description="Nenhuma ação é executada sem uma decisão humana registrada."
        actions={
          <nav aria-label="Filtrar por status" className="flex gap-2">
            {STATUS_FILTERS.map((filter) => (
              <Link
                key={filter.value}
                href={`/approvals?status=${filter.value}`}
                aria-current={status === filter.value ? 'page' : undefined}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-200',
                  status === filter.value
                    ? 'border-primary/30 bg-accent-soft text-primary'
                    : 'border-border text-muted-foreground hover:bg-card',
                )}
              >
                {filter.label}
              </Link>
            ))}
          </nav>
        }
      />

      <ApprovalQueue approvals={approvals} canDecide={hasMinRole(ctx.role, 'admin')} />

      <section aria-labelledby="executions" className="flex flex-col gap-3">
        <h2 id="executions" className="font-display text-xl tracking-tight">
          Execuções recentes
        </h2>
        <DataTable
          caption="Últimas execuções de ações do tenant"
          columns={[
            {
              key: 'action',
              header: 'Ação',
              render: (row: (typeof executionPage.items)[number]) =>
                ACTION_TYPE_LABELS[row.action.type] ?? row.action.name,
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <Badge tone={statusTone(row.status)}>
                  {EXECUTION_STATUS_LABELS[row.status] ?? row.status}
                </Badge>
              ),
            },
            {
              key: 'origin',
              header: 'Origem',
              render: (row) => (row.origin === 'ai' ? 'Tactia' : 'Usuário'),
            },
            {
              key: 'created',
              header: 'Quando',
              render: (row) => formatDateTime(row.createdAt),
            },
            {
              key: 'result',
              header: 'Resultado',
              render: (row) =>
                row.error ? (
                  <span className="text-danger">{row.error}</span>
                ) : row.output ? (
                  <span className="text-muted-foreground">
                    {Object.entries(row.output as Record<string, unknown>)
                      .slice(0, 2)
                      .map(([key, value]) => `${key}: ${String(value)}`)
                      .join(' · ')}
                  </span>
                ) : (
                  <span className="text-subtle">—</span>
                ),
            },
          ]}
          rows={executionPage.items}
          rowKey={(row) => row.id}
          emptyLabel="Nenhuma execução registrada."
        />
      </section>
    </div>
  );
}
