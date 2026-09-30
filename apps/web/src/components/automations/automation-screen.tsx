'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PageBlock } from '@tactia/domain';
import { REPORTS_PORTAL_COMPONENT_KEY } from '@tactia/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { statusLabel } from './status-label';

export type AutomationField = {
  key: string;
  label: string;
  type: 'date' | 'email' | 'string' | 'string[]';
  required: boolean;
  enum?: string[];
};

export type AutomationRunView = {
  id: string;
  automationId: string;
  status: string;
  url: string;
  summary: string | null;
  error: string | null;
  origin: string;
  params: Record<string, unknown>;
  steps: Array<{
    key: string;
    status: string;
    attempt: number;
    error: string | null;
    approvalId: string | null;
    reconciliation: { decision: 'confirmed' | 'not_sent'; at: string } | null;
  }>;
  artifacts: Array<{ id: string; name: string; mime: string; byteSize: number }>;
};

const ACTIVE = new Set(['queued', 'running', 'awaiting_approval']);

type ScreenProps = {
  automationId: string;
  name: string;
  purpose: string;
  status: string;
  componentKey: string | null;
  fields: AutomationField[];
  defaults: Record<string, unknown>;
  canExecute: boolean;
  canReconcile: boolean;
  blocks: PageBlock[];
  runs: AutomationRunView[];
  focusRunId?: string;
  layout: 'custom' | 'blocks';
};

export function automationLayout(componentKey: string | null, requested?: string): 'custom' | 'blocks' {
  if (componentKey === REPORTS_PORTAL_COMPONENT_KEY && requested !== 'blocks') return 'custom';
  return 'blocks';
}

export function AutomationScreen(props: ScreenProps) {
  const custom = props.layout === 'custom' && props.componentKey === REPORTS_PORTAL_COMPONENT_KEY;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {custom ? 'Página do piloto de relatórios.' : 'Página padrão da automação.'}{' '}
        {props.componentKey === REPORTS_PORTAL_COMPONENT_KEY ? (
          <Link
            className="underline underline-offset-4"
            href={custom ? `/automations/${props.automationId}?layout=blocks` : `/automations/${props.automationId}`}
          >
            {custom ? 'Ver página padrão' : 'Ver página do piloto'}
          </Link>
        ) : null}
      </p>
      {custom ? (
        <>
          <ExecuteForm {...props} custom />
          <RunList {...props} />
        </>
      ) : (
        <BlockPage {...props} />
      )}
    </div>
  );
}

function BlockPage(props: ScreenProps) {
  const { items, focus } = useRuns(props.automationId, props.runs, props.focusRunId);
  const blocks = props.blocks.length > 0 ? props.blocks : [{ type: 'history' as const, title: 'Histórico' }];
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => (
        <section key={`${block.type}-${index}`} className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-base font-medium">{block.title}</h2>
          <div className="mt-3">
            <BlockBody block={block} items={items} focus={focus} {...props} />
          </div>
        </section>
      ))}
    </div>
  );
}

function BlockBody({
  block,
  items,
  focus,
  ...props
}: ScreenProps & { block: PageBlock; items: AutomationRunView[]; focus: AutomationRunView | undefined }) {
  if (block.type === 'form') {
    const fields = block.fields?.length ? props.fields.filter((field) => block.fields?.includes(field.key)) : props.fields;
    return <ExecuteForm {...props} fields={fields} custom={false} />;
  }
  if (block.type === 'metrics') return <Metrics runs={items} />;
  if (block.type === 'table') return <ParamsTable run={focus} />;
  if (block.type === 'files') return <Files run={focus} />;
  if (block.type === 'progress') return <Progress run={focus} />;
  if (block.type === 'actions') {
    return focus ? <RunDetail automationId={props.automationId} run={focus} canReconcile={props.canReconcile} /> : <p className="text-sm text-muted-foreground">Nenhuma ação disponível.</p>;
  }
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma execução ainda.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((run) => (
        <li key={run.id}>
          <Link className="text-sm underline-offset-4 hover:underline" href={`/automations/${props.automationId}/runs/${run.id}`}>
            {statusLabel(run.status)} · {run.origin}
            {run.summary ? ` · ${run.summary}` : ''}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ExecuteForm({
  automationId,
  fields,
  defaults,
  canExecute,
  status,
  custom,
}: ScreenProps & { custom: boolean }) {
  const router = useRouter();
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const disabled = !canExecute || status !== 'published' || pending;

  function validate(form: FormData): Record<string, unknown> | null {
    const next: Record<string, string> = {};
    const params: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.type === 'string[]') {
        const values = form.getAll(field.key).map(String).filter(Boolean);
        if (field.required && values.length === 0) next[field.key] = 'Selecione ao menos um item.';
        else params[field.key] = values;
      } else {
        const value = String(form.get(field.key) ?? '').trim();
        if (field.required && !value) next[field.key] = 'Preencha este campo.';
        else if (value) params[field.key] = value;
      }
    }
    setFieldErrors(next);
    return Object.keys(next).length ? null : params;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = validate(new FormData(event.currentTarget));
    if (!params) return;
    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/automations/${automationId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params, idempotencyKey: crypto.randomUUID() }),
    });
    const body = (await response.json().catch(() => null)) as { data?: { id: string }; error?: { message?: string } } | null;
    setPending(false);
    if (!response.ok || !body?.data) {
      setError(body?.error?.message ?? 'Não foi possível iniciar a execução.');
      return;
    }
    router.push(`/automations/${automationId}/runs/${body.data.id}`);
    router.refresh();
  }

  return (
    <form id={formId} className={custom ? 'flex flex-col gap-4 rounded-xl border border-border bg-card p-4' : 'flex flex-col gap-4'} onSubmit={onSubmit}>
      {fields.map((field) => {
        const errorId = `${formId}-${field.key}-error`;
        const invalid = Boolean(fieldErrors[field.key]);
        return (
          <label key={field.key} className="flex flex-col gap-1 text-sm" htmlFor={`${formId}-${field.key}`}>
            <span>{field.label}</span>
            {field.type === 'string[]' && custom ? (
              <span className="flex flex-col gap-1">
                {(field.enum ?? []).map((option) => (
                  <label key={option} className="inline-flex items-center gap-2">
                    <input type="checkbox" name={field.key} value={option} disabled={disabled} />
                    {option === 'sales' ? 'Vendas' : option === 'inventory' ? 'Estoque' : option === 'financial' ? 'Financeiro' : option}
                  </label>
                ))}
              </span>
            ) : field.type === 'string[]' ? (
              <select
                id={`${formId}-${field.key}`}
                name={field.key}
                multiple
                disabled={disabled}
                className="min-h-24 rounded-lg border border-border bg-background px-2 py-1"
                defaultValue={Array.isArray(defaults[field.key]) ? (defaults[field.key] as string[]) : []}
              >
                {(field.enum ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={`${formId}-${field.key}`}
                name={field.key}
                type={field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
                defaultValue={typeof defaults[field.key] === 'string' ? String(defaults[field.key]) : ''}
                disabled={disabled}
                aria-invalid={invalid}
                aria-describedby={invalid ? errorId : undefined}
                required={field.required}
              />
            )}
            {invalid ? (
              <span id={errorId} className="text-destructive">
                {fieldErrors[field.key]}
              </span>
            ) : null}
          </label>
        );
      })}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={disabled}>
        {pending ? 'Enviando…' : 'Executar'}
      </Button>
      {status !== 'published' ? <p className="text-sm text-muted-foreground">Esta automação não aceita novos disparos.</p> : null}
    </form>
  );
}

function useRuns(automationId: string, runs: AutomationRunView[], focusRunId?: string) {
  const [items, setItems] = useState(runs);
  const focus = items.find((run) => run.id === focusRunId) ?? items[0];

  useEffect(() => {
    setItems(runs);
  }, [runs]);

  useEffect(() => {
    if (!focus || !ACTIVE.has(focus.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/v1/automations/${automationId}/runs/${focus.id}`);
      if (!response.ok) return;
      const body = (await response.json()) as { data?: AutomationRunView };
      if (!body.data) return;
      setItems((current) => current.map((run) => (run.id === body.data!.id ? body.data! : run)));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [automationId, focus]);

  return { items, focus };
}

function RunList({
  automationId,
  runs,
  focusRunId,
  canReconcile,
  historyOnly,
}: ScreenProps & { historyOnly?: boolean }) {
  const { items, focus } = useRuns(automationId, runs, focusRunId);
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma execução ainda.</p>;
  return (
    <div className="flex flex-col gap-4">
      {focus && !historyOnly ? <RunDetail automationId={automationId} run={focus} canReconcile={canReconcile} /> : null}
      <section>
        <h2 className="text-base font-medium">Histórico</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {items.map((run) => (
            <li key={run.id}>
              <Link className="text-sm underline-offset-4 hover:underline" href={`/automations/${automationId}/runs/${run.id}`}>
                {statusLabel(run.status)} · {run.origin}
                {run.summary ? ` · ${run.summary}` : ''}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Metrics({ runs }: { runs: AutomationRunView[] }) {
  const counts = new Map<string, number>();
  for (const run of runs) counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
  if (counts.size === 0) return <p className="text-sm text-muted-foreground">Sem execuções para resumir.</p>;
  return (
    <ul className="flex flex-wrap gap-3 text-sm">
      {[...counts.entries()].map(([status, count]) => (
        <li key={status} className="rounded-lg border border-border px-3 py-2">
          {statusLabel(status)}: {count}
        </li>
      ))}
    </ul>
  );
}

function ParamsTable({ run }: { run: AutomationRunView | undefined }) {
  if (!run) return <p className="text-sm text-muted-foreground">Nenhum dado desta execução.</p>;
  const rows = Object.entries(run.params);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Esta execução não tem parâmetros.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([key, value]) => (
          <tr key={key} className="border-t border-border">
            <th className="py-1 pr-3 text-left font-medium">{key}</th>
            <td className="py-1">{Array.isArray(value) ? value.join(', ') : String(value ?? '')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Files({ run }: { run: AutomationRunView | undefined }) {
  if (!run || run.artifacts.length === 0) return <p className="text-sm text-muted-foreground">Nenhum arquivo gerado.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {run.artifacts.map((artifact) => (
        <li key={artifact.id}>
          <a className="underline underline-offset-4" href={`/api/v1/automations/artifacts/${artifact.id}`}>
            {artifact.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Progress({ run }: { run: AutomationRunView | undefined }) {
  if (!run) return <p className="text-sm text-muted-foreground">Nenhuma etapa em andamento.</p>;
  return (
    <div className="text-sm">
      <p>Situação: {statusLabel(run.status)}</p>
      {run.error ? <p className="text-destructive">{run.error}</p> : null}
      <ol className="mt-2 flex flex-col gap-1">
        {run.steps.map((step) => (
          <li key={step.key}>
            {step.key}: {statusLabel(step.status)}
            {step.error ? ` — ${step.error}` : ''}
            {step.reconciliation ? ` — ${decisionLabel(step.reconciliation.decision)}` : ''}
          </li>
        ))}
      </ol>
    </div>
  );
}

function decisionLabel(decision: 'confirmed' | 'not_sent'): string {
  return decision === 'confirmed' ? 'Envio confirmado' : 'Envio não ocorrido';
}

function RunDetail({
  automationId,
  run,
  canReconcile,
}: {
  automationId: string;
  run: AutomationRunView;
  canReconcile: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function post(path: string, body?: unknown) {
    setPending(true);
    await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    setPending(false);
    router.refresh();
  }

  const decision = run.steps.find((step) => step.reconciliation)?.reconciliation;

  return (
    <section className="rounded-xl border border-border p-4" aria-live="polite">
      <h2 className="text-base font-medium">Acompanhamento</h2>
      <p className="mt-1 text-sm">Situação: {statusLabel(run.status)}</p>
      {run.summary ? <p className="text-sm text-muted-foreground">{run.summary}</p> : null}
      {run.error ? <p className="text-sm text-destructive">{run.error}</p> : null}
      {decision ? <p className="text-sm">Decisão registrada: {decisionLabel(decision.decision)}</p> : null}
      <ol className="mt-3 flex flex-col gap-1 text-sm">
        {run.steps.map((step) => (
          <li key={step.key}>
            {step.key}: {statusLabel(step.status)}
            {step.error ? ` — ${step.error}` : ''}
          </li>
        ))}
      </ol>
      {run.artifacts.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {run.artifacts.map((artifact) => (
            <li key={artifact.id}>
              <a className="underline underline-offset-4" href={`/api/v1/automations/artifacts/${artifact.id}`}>
                {artifact.name}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {ACTIVE.has(run.status) ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void post(`/api/v1/automations/${automationId}/runs/${run.id}/cancel`)}>
            Cancelar
          </Button>
        ) : null}
        {run.status === 'failed' ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void post(`/api/v1/automations/${automationId}/runs/${run.id}/resume`)}>
            Retomar
          </Button>
        ) : null}
        {run.status === 'needs_attention' && canReconcile ? (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void post(`/api/v1/automations/${automationId}/runs/${run.id}/reconcile`, { decision: 'confirmed' })}
            >
              Envio confirmado
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void post(`/api/v1/automations/${automationId}/runs/${run.id}/reconcile`, { decision: 'not_sent' })}
            >
              Envio não ocorrido
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}
