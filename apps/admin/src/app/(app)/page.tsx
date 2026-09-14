import Link from 'next/link';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/app/page-header';
import { formatDateTime, formatInteger, TENANT_STATUS_LABELS } from '@/lib/format';
import { requireOperator } from '@/lib/server-context';
import { backofficeService } from '@/lib/services';

export const metadata = { title: 'Empresas · Tactia Ops' };

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { ctx } = await requireOperator('/');
  const params = await searchParams;
  const result = await backofficeService.listTenants(ctx, {
    q: params.q,
    status: params.status,
    page: params.page,
    pageSize: '20',
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Empresas"
        description="Clientes Tactia (tenants). Provisionar, suspender e diagnosticar — sem entrar no produto."
        actions={
          <Link
            href="/tenants/new"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 font-mono text-xs font-medium uppercase tracking-wide text-primary-foreground hover:opacity-90"
          >
            Nova empresa
          </Link>
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Busca</span>
          <Input name="q" defaultValue={params.q ?? ''} placeholder="Nome, slug ou e-mail do owner" />
        </label>
        <label className="flex w-40 flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Status</span>
          <select
            name="status"
            defaultValue={params.status ?? ''}
            className="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm"
          >
            <option value="">Todas</option>
            <option value="active">Ativas</option>
            <option value="suspended">Suspensas</option>
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </form>

      <DataTable
        caption="Empresas cadastradas"
        columns={[
          {
            key: 'name',
            header: 'Empresa',
            render: (row: (typeof result.items)[number]) => (
              <Link href={`/tenants/${row.id}`} className="text-primary hover:underline">
                {row.name}
              </Link>
            ),
          },
          { key: 'slug', header: 'Slug', render: (row) => <span className="font-mono text-xs">{row.slug}</span> },
          {
            key: 'status',
            header: 'Status',
            render: (row) => <Badge tone={statusTone(row.status)}>{TENANT_STATUS_LABELS[row.status] ?? row.status}</Badge>,
          },
          {
            key: 'users',
            header: 'Usuários',
            numeric: true,
            render: (row) => formatInteger(row._count.memberships),
          },
          {
            key: 'sources',
            header: 'Fontes',
            numeric: true,
            render: (row) => formatInteger(row._count.dataSources),
          },
          {
            key: 'sales',
            header: 'Vendas',
            numeric: true,
            render: (row) => formatInteger(row._count.sales),
          },
          {
            key: 'created',
            header: 'Criada em',
            render: (row) => formatDateTime(row.createdAt),
          },
        ]}
        rows={result.items}
        rowKey={(row) => row.id}
        emptyLabel="Nenhuma empresa cadastrada."
      />

      <p className="font-mono text-xs text-muted-foreground">
        Página {result.pagination.page} · {formatInteger(result.total)} empresa(s)
      </p>
    </div>
  );
}
