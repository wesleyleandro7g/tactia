import { TabSection } from '@/components/app/tab-section';
import { Badge, severityTone, statusTone } from '@/components/ui/badge';
import { Card, CardLabel } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { formatDateTime, SEVERITY_LABELS } from '@/lib/format';
import { loadTenantActivity, loadTenantHeader } from '@/lib/tenant-loaders';

export const metadata = { title: 'Atividade · Empresa · Tactia Ops' };

export default async function TenantActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ tenant }, { insights, auditLogs }] = await Promise.all([
    loadTenantHeader(id),
    loadTenantActivity(id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <TabSection title="Insights recentes">
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
      </TabSection>

      <TabSection title="Audit log">
        <DataTable
          caption={`Audit log de ${tenant.name}`}
          columns={[
            {
              key: 'when',
              header: 'Quando',
              render: (row: (typeof auditLogs)[number]) => formatDateTime(row.createdAt),
            },
            {
              key: 'action',
              header: 'Ação',
              render: (row) => <span className="font-mono text-xs">{row.action}</span>,
            },
            { key: 'actor', header: 'Ator', render: (row) => row.actorType },
            {
              key: 'entity',
              header: 'Entidade',
              render: (row) => `${row.entityType} · ${row.entityId.slice(0, 8)}`,
            },
          ]}
          rows={auditLogs}
          rowKey={(row) => row.id}
          emptyLabel="Nenhum evento."
        />
      </TabSection>
    </div>
  );
}
