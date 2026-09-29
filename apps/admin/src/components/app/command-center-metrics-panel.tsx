import Link from 'next/link';
import type { CommandCenterMetricsService } from '@tactia/domain';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardLabel } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/input';
import { TabSection } from '@/components/app/tab-section';
import {
  COMMAND_CENTER_EVENT_LABELS,
  METRIC_AVAILABILITY_LABELS,
  formatDateTime,
  formatInteger,
  formatMetricValue,
} from '@/lib/format';

type Metrics = Awaited<ReturnType<CommandCenterMetricsService['summarize']>>;

const EVENT_FILTERS = [
  { value: '', label: 'Todos os eventos' },
  ...Object.entries(COMMAND_CENTER_EVENT_LABELS).map(([value, label]) => ({ value, label })),
] as const;

function metricsHref(
  tenantId: string,
  query: { from: string; to: string; name?: string | null; page?: number },
) {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.name) params.set('name', query.name);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  return `/tenants/${encodeURIComponent(tenantId)}/metrics?${params}`;
}

function breakdownRows(title: string, counts: Record<string, number>) {
  return Object.entries(counts).map(([key, count]) => ({ group: title, key, count }));
}

export function CommandCenterMetricsPanel({
  tenantId,
  metrics,
  error,
}: {
  tenantId: string;
  metrics?: Metrics;
  error?: string;
}) {
  const from = metrics?.periodInclusive.from ?? '';
  const to = metrics?.periodInclusive.to ?? '';
  const name = metrics?.filter.name ?? '';

  return (
    <div className="flex flex-col gap-8">
      <TabSection title="Janela do piloto">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <div>
            <label htmlFor="from" className="mb-2 block font-mono text-xs uppercase text-muted-foreground">
              De
            </label>
            <Input id="from" name="from" type="date" defaultValue={from} required />
          </div>
          <div>
            <label htmlFor="to" className="mb-2 block font-mono text-xs uppercase text-muted-foreground">
              Até
            </label>
            <Input id="to" name="to" type="date" defaultValue={to} required />
          </div>
          <div>
            <label htmlFor="name" className="mb-2 block font-mono text-xs uppercase text-muted-foreground">
              Evento no detalhe
            </label>
            <Select id="name" name="name" defaultValue={name}>
              {EVENT_FILTERS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" size="md">
            Consultar
          </Button>
        </form>
        {error ? <Alert tone="danger" title="Intervalo inválido">{error}</Alert> : null}
      </TabSection>

      {metrics ? (
        <>
          <Alert tone="info" title="O que estes números medem">
            <p>
              Contagens e taxas dos eventos da Central já gravados para esta empresa. Sem eventos, o
              valor aparece como ausência, não como zero de desempenho.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {metrics.unsupported.map((item) => (
                <li key={item.key}>{item.reason}</li>
              ))}
            </ul>
          </Alert>

          <TabSection title="Indicadores">
            <ul className="grid gap-3 md:grid-cols-2">
              {metrics.metrics.map((metric) => (
                <li key={metric.key}>
                  <Card className="flex h-full flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardLabel>{metric.key}</CardLabel>
                      <Badge tone={metric.availability === 'empty' ? 'warning' : 'info'}>
                        {METRIC_AVAILABILITY_LABELS[metric.availability] ?? metric.availability}
                      </Badge>
                    </div>
                    <p className="font-mono text-2xl tabular tracking-tight">
                      {formatMetricValue(metric.value, metric.unit)}
                    </p>
                    <p>{metric.definition}</p>
                    <p className="text-muted-foreground">
                      Período {from} a {to} (UTC, dias inclusive)
                      {metric.denominator
                        ? ` · Denominador: ${formatInteger(metric.denominator.value)} (${metric.denominator.definition})`
                        : null}
                    </p>
                    <p className="text-muted-foreground">{metric.limitation}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </TabSection>

          <TabSection title="Tendência diária">
            <DataTable
              caption="Eventos por dia no período, apenas dias com registro"
              columns={[
                { key: 'day', header: 'Dia', render: (row) => row.day },
                {
                  key: 'name',
                  header: 'Evento',
                  render: (row) => COMMAND_CENTER_EVENT_LABELS[row.name] ?? row.name,
                },
                { key: 'count', header: 'Quantidade', numeric: true, render: (row) => formatInteger(row.count) },
              ]}
              rows={metrics.daily}
              rowKey={(row) => `${row.day}:${row.name}`}
              emptyLabel="Nenhum evento neste período."
            />
          </TabSection>

          <TabSection title="Detalhe por tipo">
            <DataTable
              caption="Composição dos eventos, sem conteúdo pessoal"
              columns={[
                { key: 'group', header: 'Grupo', render: (row) => row.group },
                { key: 'key', header: 'Estado', render: (row) => row.key },
                { key: 'count', header: 'Quantidade', numeric: true, render: (row) => formatInteger(row.count) },
              ]}
              rows={[
                ...breakdownRows('Decisão · tipo', metrics.breakdowns.decisions.kind),
                ...breakdownRows('Decisão · escolha', metrics.breakdowns.decisions.choice),
                ...breakdownRows('Execução · estado', metrics.breakdowns.executions.status),
                ...(metrics.breakdowns.clarifications.clear + metrics.breakdowns.clarifications.unclear > 0
                  ? [
                      { group: 'Esclarecimento · clareza', key: 'clara', count: metrics.breakdowns.clarifications.clear },
                      { group: 'Esclarecimento · clareza', key: 'ambígua', count: metrics.breakdowns.clarifications.unclear },
                    ]
                  : []),
              ]}
              rowKey={(row) => `${row.group}:${row.key}`}
              emptyLabel="Sem composição para exibir. Isso não é zero de desempenho."
            />
          </TabSection>

          <TabSection title="Eventos">
            <DataTable
              caption="Detalhe paginado dos eventos da empresa na janela"
              columns={[
                { key: 'when', header: 'Quando', render: (row) => formatDateTime(row.occurredAt) },
                {
                  key: 'name',
                  header: 'Evento',
                  render: (row) => COMMAND_CENTER_EVENT_LABELS[row.name] ?? row.name,
                },
                {
                  key: 'entity',
                  header: 'Entidade',
                  render: (row) => <span className="font-mono text-xs">{row.entityId}</span>,
                },
                {
                  key: 'meta',
                  header: 'Estados',
                  render: (row) =>
                    Object.entries(row.metadata)
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join(' · ') || '—',
                },
              ]}
              rows={metrics.events.items}
              rowKey={(row) => row.id}
              emptyLabel="Nenhum evento neste período."
            />
            <nav aria-label="Paginação dos eventos" className="flex justify-between text-sm">
              {metrics.events.page > 1 ? (
                <Link
                  href={metricsHref(tenantId, {
                    from,
                    to,
                    name,
                    page: metrics.events.page - 1,
                  })}
                  className="text-primary"
                >
                  Anterior
                </Link>
              ) : (
                <span />
              )}
              {metrics.events.page * metrics.events.pageSize < metrics.events.total ? (
                <Link
                  href={metricsHref(tenantId, {
                    from,
                    to,
                    name,
                    page: metrics.events.page + 1,
                  })}
                  className="text-primary"
                >
                  Próxima
                </Link>
              ) : (
                <span />
              )}
            </nav>
            <p className="font-mono text-xs text-muted-foreground">
              {metrics.events.total} evento(s) · página {metrics.events.page}
            </p>
          </TabSection>
        </>
      ) : null}
    </div>
  );
}
