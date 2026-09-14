import { PageHeader } from '@/components/app/page-header';
import { CreateOperatorForm, DisableOperatorButton } from '@/components/app/operator-forms';
import { Badge, statusTone } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { formatDateTime } from '@/lib/format';
import { requireOperator } from '@/lib/server-context';
import { operatorService } from '@/lib/services';

export const metadata = { title: 'Operadores · Tactia Ops' };

export default async function OperatorsPage() {
  const { ctx, operator } = await requireOperator('/operators');
  const operators = await operatorService.list(ctx);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Operadores"
        description="Identidade própria do backoffice. Não compartilham login com o app dos clientes."
      />
      <CreateOperatorForm />
      <DataTable
        caption="Operadores"
        columns={[
          { key: 'name', header: 'Nome', render: (row: (typeof operators)[number]) => row.name },
          { key: 'email', header: 'E-mail', render: (row) => row.email },
          {
            key: 'status',
            header: 'Status',
            render: (row) => <Badge tone={statusTone(row.status)}>{row.status === 'active' ? 'Ativo' : 'Desativado'}</Badge>,
          },
          {
            key: 'created',
            header: 'Criado em',
            render: (row) => formatDateTime(row.createdAt),
          },
          {
            key: 'actions',
            header: 'Ações',
            render: (row) => (
              <DisableOperatorButton
                operatorId={row.id}
                disabled={row.status === 'disabled' || row.id === operator.id}
              />
            ),
          },
        ]}
        rows={operators}
        rowKey={(row) => row.id}
      />
    </div>
  );
}
