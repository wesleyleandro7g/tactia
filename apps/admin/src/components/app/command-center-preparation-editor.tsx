'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { errorMessage } from '@/lib/format';

type Objective = {
  id: string;
  title: string;
  metricKey: string;
  status: string;
  target: number;
  baselineValue: number | null;
  periodStart: string;
};
type Source = { id: string; name: string; type: string; lastSyncAt: string | null };
type Plan = { id: string; goalId: string; title: string; status: string; version: number; measurementCount: number };
type Metric = { key: string; label: string; unit: string };

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as {
    data?: T;
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok || !payload?.data) {
    throw new Error(errorMessage(payload?.error?.code, payload?.error?.message));
  }
  return payload.data;
}

function optionalNumber(value: FormDataEntryValue | null): number | null {
  return value === null || value === '' ? null : Number(value);
}

export function CommandCenterPreparationEditor({
  tenantId, objectives, plans, sources, metrics,
}: {
  tenantId: string;
  objectives: Objective[];
  plans: Plan[];
  sources: Source[];
  metrics: readonly Metric[];
}) {
  const router = useRouter();
  const availableGoals = objectives.filter((goal) =>
    ['preparing', 'active'].includes(goal.status) && metrics.some((metric) => metric.key === goal.metricKey));
  const [goalId, setGoalId] = useState(availableGoals[0]?.id ?? '');
  const [goalPending, setGoalPending] = useState(false);
  const [planPending, setPlanPending] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeGoalId = goalId || availableGoals[0]?.id || '';
  const selectedGoal = availableGoals.find((goal) => goal.id === activeGoalId);

  async function createObjective(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setGoalPending(true);
    setGoalError(null);
    setNotice(null);
    try {
      const created = await post<{ id: string }>(`/api/v1/tenants/${tenantId}/command-center/objectives`, {
        title: data.get('title'),
        metricKey: data.get('metricKey'),
        periodType: data.get('periodType'),
        periodStart: data.get('periodStart'),
        target: Number(data.get('target')),
        baselineValue: optionalNumber(data.get('baselineValue')),
      });
      setGoalId(created.id);
      setNotice('Objetivo preparado. Defina o plano e sua medição abaixo.');
      form.reset();
      router.refresh();
    } catch (cause) {
      setGoalError(cause instanceof Error ? cause.message : 'Não foi possível criar o objetivo.');
    } finally {
      setGoalPending(false);
    }
  }

  async function createPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPlanPending(true);
    setPlanError(null);
    setNotice(null);
    try {
      await post<{ id: string }>(`/api/v1/tenants/${tenantId}/command-center/plans`, {
        goalId: activeGoalId,
        sourceId: data.get('sourceId'),
        title: data.get('title'),
        summary: data.get('summary'),
        cohort: data.get('cohort'),
        responsibleLabel: data.get('responsibleLabel'),
        actionTitle: data.get('actionTitle'),
        actionDescription: data.get('actionDescription'),
        actionReason: data.get('actionReason'),
        windowFrom: data.get('windowFrom'),
        windowTo: data.get('windowTo'),
      });
      setNotice('Plano e medição preparados. A decisão de executar ficará com a empresa.');
      form.reset();
      router.refresh();
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : 'Não foi possível preparar o plano.');
    } finally {
      setPlanPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <section className="flex flex-col gap-3" aria-labelledby="prepare-goal-title">
        <h3 id="prepare-goal-title" className="font-display text-xl">1. Objetivo</h3>
        <p className="text-sm text-muted-foreground">Prepare o objetivo de negócio. O valor inicial pode ficar vazio quando ainda não há dado confiável.</p>
        <form onSubmit={(event) => void createObjective(event)} className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Field htmlFor="goal-title" label="Objetivo" className="sm:col-span-2">
            <Input id="goal-title" name="title" required minLength={3} maxLength={160} placeholder="Ex.: Recuperar receita de clientes inativos" />
          </Field>
          <Field htmlFor="goal-metric" label="Indicador">
            <Select id="goal-metric" name="metricKey" required>
              {metrics.map((metric) => <option key={metric.key} value={metric.key}>{metric.label} · {metric.unit}</option>)}
            </Select>
          </Field>
          <Field htmlFor="goal-period-type" label="Período">
            <Select id="goal-period-type" name="periodType" required>
              <option value="month">Mês</option><option value="quarter">Trimestre</option><option value="year">Ano</option>
            </Select>
          </Field>
          <Field htmlFor="goal-period-start" label="Início do período">
            <Input id="goal-period-start" name="periodStart" type="date" required />
          </Field>
          <Field htmlFor="goal-target" label="Alvo">
            <Input id="goal-target" name="target" type="number" step="any" required />
          </Field>
          <Field htmlFor="goal-baseline" label="Valor inicial" hint="Deixe vazio se ainda não há medição confiável.">
            <Input id="goal-baseline" name="baselineValue" type="number" step="any" />
          </Field>
          <div className="flex items-end"><Button type="submit" loading={goalPending} disabled={goalPending}>Preparar objetivo</Button></div>
          {goalError ? <div className="sm:col-span-2"><Alert tone="danger">{goalError}</Alert></div> : null}
        </form>
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-6" aria-labelledby="prepare-plan-title">
        <h3 id="prepare-plan-title" className="font-display text-xl">2. Plano e medição</h3>
        <p className="text-sm text-muted-foreground">O plano define a ação a apresentar para decisão no app da empresa. A medição usa uma fonte ativa e mantém limitações explícitas quando não houver dados.</p>
        {availableGoals.length === 0 ? <Alert tone="info">Prepare um objetivo para continuar.</Alert> : null}
        {sources.length === 0 ? <Alert tone="warning">Conecte uma fonte ativa antes de preparar a medição.</Alert> : null}
        <form onSubmit={(event) => void createPlan(event)} className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Field htmlFor="plan-goal" label="Objetivo" className="sm:col-span-2">
            <Select id="plan-goal" name="goalId" value={activeGoalId} onChange={(event) => setGoalId(event.target.value)} required>
              {availableGoals.length === 0 ? <option value="">Nenhum objetivo disponível</option> : null}
              {availableGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title} · {goal.metricKey}</option>)}
            </Select>
          </Field>
          {selectedGoal ? <p className="text-xs text-muted-foreground sm:col-span-2">Alvo: {selectedGoal.target.toLocaleString('pt-BR')} · Valor inicial: {selectedGoal.baselineValue === null ? 'indisponível' : selectedGoal.baselineValue.toLocaleString('pt-BR')}</p> : null}
          <Field htmlFor="plan-title" label="Título do plano" className="sm:col-span-2">
            <Input id="plan-title" name="title" required minLength={3} maxLength={160} />
          </Field>
          <Field htmlFor="plan-summary" label="Motivo e contexto" className="sm:col-span-2">
            <Textarea id="plan-summary" name="summary" required minLength={3} maxLength={1200} />
          </Field>
          <Field htmlFor="plan-cohort" label="Escopo ou coorte" hint="Quem ou o que entra no plano?" className="sm:col-span-2">
            <Input id="plan-cohort" name="cohort" required minLength={3} maxLength={300} />
          </Field>
          <Field htmlFor="plan-responsible" label="Responsável no processo existente" className="sm:col-span-2">
            <Input id="plan-responsible" name="responsibleLabel" required minLength={3} maxLength={160} />
          </Field>
          <Field htmlFor="plan-action-title" label="Ação preparada" className="sm:col-span-2">
            <Input id="plan-action-title" name="actionTitle" required minLength={3} maxLength={160} placeholder="Ex.: Criar tarefa de contato" />
          </Field>
          <Field htmlFor="plan-action-description" label="Descrição da ação" className="sm:col-span-2">
            <Textarea id="plan-action-description" name="actionDescription" required minLength={3} maxLength={1000} />
          </Field>
          <Field htmlFor="plan-action-reason" label="Por que executar?" className="sm:col-span-2">
            <Input id="plan-action-reason" name="actionReason" required minLength={3} maxLength={500} />
          </Field>
          <Field htmlFor="plan-source" label="Fonte de referência">
            <Select id="plan-source" name="sourceId" required>
              {sources.length === 0 ? <option value="">Nenhuma fonte ativa</option> : null}
              {sources.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.type}</option>)}
            </Select>
          </Field>
          <div className="flex items-end text-xs text-muted-foreground">A métrica usa os registros canônicos da empresa; esta fonte orienta a verificação de cobertura.</div>
          <Field htmlFor="plan-window-from" label="Início da medição">
            <Input id="plan-window-from" name="windowFrom" type="date" min={selectedGoal?.periodStart.slice(0, 10)} required />
          </Field>
          <Field htmlFor="plan-window-to" label="Fim da medição">
            <Input id="plan-window-to" name="windowTo" type="date" required />
          </Field>
          <div className="sm:col-span-2"><Button type="submit" loading={planPending} disabled={planPending || !selectedGoal || sources.length === 0}>Preparar plano e medição</Button></div>
          {planError ? <div className="sm:col-span-2"><Alert tone="danger">{planError}</Alert></div> : null}
        </form>
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-6" aria-labelledby="prepared-plans-title">
        <h3 id="prepared-plans-title" className="font-display text-xl">Planos preparados</h3>
        {plans.length ? <ul className="divide-y divide-border rounded-lg border border-border">
          {plans.map((plan) => <li key={plan.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
            <span>{plan.title}</span><span className="text-muted-foreground">{plan.status} · versão {plan.version} · {plan.measurementCount} medição(ões)</span>
          </li>)}
        </ul> : <p className="text-sm text-muted-foreground">Ainda não há planos preparados para esta empresa.</p>}
      </section>
    </div>
  );
}
