'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/feedback';
import { Field, FormInput, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/app/page-header';
import { errorMessage, formatCurrency, formatInteger, metricLabel } from '@/lib/format';

type GoalRow = {
  id: string;
  metricKey: string;
  scope: string;
  periodType: string;
  periodStart: string;
  target: number;
  achieved: number;
  progress: number;
  requiredDailyPace: number | null;
  onTrack: boolean | null;
};

const METRIC_OPTIONS = [
  ['revenue', 'Receita'],
  ['sales_count', 'Vendas'],
  ['average_ticket', 'Ticket médio'],
  ['new_customers', 'Novos clientes'],
  ['operating_profit', 'Lucro operacional'],
] as const;

const PERIOD_OPTIONS = [
  ['month', 'Mês'],
  ['quarter', 'Trimestre'],
  ['year', 'Ano'],
] as const;

function formatValue(metricKey: string, value: number) {
  if (metricKey === 'sales_count' || metricKey === 'new_customers') return formatInteger(value);
  return formatCurrency(value);
}

export function GoalsSettings({ goals }: { goals: GoalRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState<Date | undefined>();

  async function create(form: FormData) {
    setPending(true);
    setError(null);
    const periodStartValue = String(form.get('periodStart') ?? '');
    const response = await fetch('/api/v1/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metricKey: form.get('metricKey'),
        periodType: form.get('periodType'),
        periodStart: periodStartValue
          ? new Date(`${periodStartValue}T00:00:00.000Z`).toISOString()
          : undefined,
        target: Number(form.get('target')),
        scope: 'tenant',
      }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return false;
    }
    router.refresh();
    return true;
  }

  async function remove(id: string) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/goals/${id}`, { method: 'DELETE' });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Metas"
        description="A Tactia compara o realizado com o ritmo necessário e avisa quando a meta está atrasada."
      />

      <Card className="p-5">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void create(new FormData(form)).then((ok) => {
              if (ok) {
                form.reset();
                setPeriodStart(undefined);
              }
            });
          }}
        >
          <Field htmlFor="metricKey" label="Métrica">
            <Select id="metricKey" name="metricKey" defaultValue="revenue">
              {METRIC_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="periodType" label="Período">
            <Select id="periodType" name="periodType" defaultValue="month">
              {PERIOD_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="periodStart" label="Início">
            <DatePicker
              id="periodStart"
              name="periodStart"
              value={periodStart}
              onChange={setPeriodStart}
              required
              placeholder="dd/mm/aaaa"
            />
          </Field>
          <Field htmlFor="target" label="Alvo">
            <FormInput id="target" name="target" type="number" min="0" step="0.01" required />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" loading={pending}>
              Criar meta
            </Button>
          </div>
        </form>
      </Card>

      {goals.length === 0 ? (
        <EmptyState title="Nenhuma meta" description="Crie a primeira meta de receita do mês." />
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((goal) => (
            <li key={goal.id}>
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {metricLabel(goal.metricKey)} · {formatValue(goal.metricKey, goal.target)}
                    </p>
                    <p
                      className={
                        goal.onTrack === false
                          ? 'text-xs text-danger'
                          : goal.onTrack
                            ? 'text-xs text-success'
                            : 'text-xs text-muted-foreground'
                      }
                    >
                      {formatValue(goal.metricKey, goal.achieved)} atingidos (
                      {Math.round(goal.progress * 100)}%)
                      {goal.onTrack == null ? '' : goal.onTrack ? ' · no ritmo' : ' · abaixo do ritmo'}
                      {goal.requiredDailyPace != null
                        ? ` · precisa de ${formatValue(goal.metricKey, goal.requiredDailyPace)}/dia`
                        : ''}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => void remove(goal.id)}>
                    Remover
                  </Button>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={Math.round(Math.min(goal.progress, 1) * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Progresso de ${metricLabel(goal.metricKey)}`}
                >
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-300"
                    style={{ width: `${Math.min(Math.max(goal.progress, 0), 1) * 100}%` }}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
