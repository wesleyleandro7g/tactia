import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, statusTone } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/app/page-header';
import { formatDateTime, formatInteger } from '@/lib/format';
import { listTenantsOverview } from '@/lib/admin';
import { isOperator } from '@/lib/operator';
import { requireUser } from '@/lib/server-context';

export const metadata = { title: 'Admin · Tactia' };

/**
 * Painel interno do operador (spec §54). Fora da allowlist, a rota simplesmente
 * não existe (404) — não expõe 403.
 */
export default async function AdminPage() {
  const ctx = await requireUser('/admin');
  if (!(await isOperator(ctx))) notFound();

  const tenants = await listTenantsOverview(ctx);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Admin interno"
        description="Visão cross-tenant para diagnóstico. Toda ação daqui fica registrada no audit log do tenant afetado."
      />

      <Alert tone="warning" title="Acesso privilegiado">
        Liberado por <code>TACTIA_OPERATOR_EMAILS</code>. Use apenas para operar e diagnosticar.
      </Alert>

      <DataTable
        caption="Tenants cadastrados"
        captionVisible
        columns={[
          {
            key: 'name',
            header: 'Empresa',
            render: (row: (typeof tenants)[number]) => (
              <Link href={`/admin/tenants/${row.id}`} className="text-primary hover:underline">
                {row.name}
              </Link>
            ),
          },
          { key: 'slug', header: 'Slug', render: (row) => row.slug },
          {
            key: 'status',
            header: 'Status',
            render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>,
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
            key: 'insights',
            header: 'Insights',
            numeric: true,
            render: (row) => formatInteger(row._count.insights),
          },
          {
            key: 'created',
            header: 'Criado em',
            render: (row) => formatDateTime(row.createdAt),
          },
        ]}
        rows={tenants}
        rowKey={(row) => row.id}
        emptyLabel="Nenhum tenant cadastrado."
      />
    </div>
  );
}
