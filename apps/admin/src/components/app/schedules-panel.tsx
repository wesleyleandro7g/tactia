'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { errorMessage } from '@/lib/format';

export type ScheduleRow = {
  id: string;
  name: string;
  target: 'ai_agent' | 'action' | 'automation';
  effectMode: 'propose' | 'auto_execute';
  frequency: 'daily' | 'weekly' | 'monthly' | 'custom' | 'manual';
  enabled: boolean;
  repeatMode: 'infinite' | 'count';
  maxOccurrences: number | null;
  successCount: number;
};

const TARGET_LABEL: Record<ScheduleRow['target'], string> = {
  ai_agent: 'Agente de IA',
  action: 'Ação',
  automation: 'Automação',
};

const FREQ_LABEL: Record<ScheduleRow['frequency'], string> = {
  daily: 'Diária',
  weekly: 'Semanal',
  monthly: 'Mensal',
  custom: 'Custom (cron)',
  manual: 'Manual',
};

/**
 * Backoffice schedule management for a company. Create/list/toggle/trigger/
 * delete schedules; automatic firing happens on the web tick, but the operator
 * can trigger one now. The create form covers the common cases; advanced JSON
 * (recurrenceConfig, aiConfig, actionInput) is entered as JSON for flexibility.
 */
export function SchedulesPanel({
  schedules,
  apiBasePath,
}: {
  schedules: ScheduleRow[];
  apiBasePath: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ScheduleRow['target']>('ai_agent');
  const [frequency, setFrequency] = useState<ScheduleRow['frequency']>('daily');

  async function call(path: string, method: string, body?: unknown): Promise<boolean> {
    setPending(true);
    setError(null);
    const response = await fetch(path, {
      method,
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    setPending(false);
    if (!response.ok) {
      const parsed = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(parsed?.error?.code));
      return false;
    }
    router.refresh();
    return true;
  }

  function parseJson(value: string, fallback: unknown): unknown {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error('JSON inválido');
    }
  }

  async function create(form: FormData): Promise<boolean> {
    let payload: Record<string, unknown>;
    try {
      payload = {
        name: String(form.get('name') ?? '').trim(),
        target,
        frequency,
        effectMode: String(form.get('effectMode') ?? 'propose'),
        repeatMode: String(form.get('repeatMode') ?? 'infinite'),
      };
      const desc = String(form.get('description') ?? '').trim();
      if (desc) payload.description = desc;
      const tz = String(form.get('timezone') ?? '').trim();
      if (tz) payload.timezone = tz;
      const max = String(form.get('maxOccurrences') ?? '').trim();
      if (max) payload.maxOccurrences = Number(max);
      const cron = String(form.get('cronExpression') ?? '').trim();
      if (cron) payload.cronExpression = cron;

      const recurrence = parseJson(String(form.get('recurrenceConfig') ?? ''), undefined);
      if (recurrence !== undefined) payload.recurrenceConfig = recurrence;

      if (target === 'ai_agent') {
        payload.aiConfig = parseJson(String(form.get('aiConfig') ?? ''), { instruction: '' });
      }
      if (target === 'action') {
        const actionType = String(form.get('actionType') ?? '').trim();
        if (actionType) payload.actionType = actionType;
        payload.actionInput = parseJson(String(form.get('actionInput') ?? ''), {});
      }
    } catch (jsonError) {
      setError(jsonError instanceof Error ? jsonError.message : 'Entrada inválida');
      return false;
    }
    return call(apiBasePath, 'POST', payload);
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <h2 className="text-base font-medium text-foreground">Novo agendamento</h2>
        <form
          className="mt-3 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const el = event.currentTarget;
            void create(new FormData(el)).then((ok) => ok && el.reset());
          }}
        >
          <Field htmlFor="sch-name" label="Nome">
            <Input id="sch-name" name="name" required minLength={2} />
          </Field>
          <Field htmlFor="sch-desc" label="Descrição">
            <Input id="sch-desc" name="description" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field htmlFor="sch-target" label="Alvo">
              <select
                id="sch-target"
                name="target"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                value={target}
                onChange={(e) => setTarget(e.target.value as ScheduleRow['target'])}
              >
                <option value="ai_agent">Agente de IA</option>
                <option value="action">Ação</option>
                <option value="automation">Automação (em breve)</option>
              </select>
            </Field>
            <Field htmlFor="sch-effect" label="Modo de efeito">
              <select
                id="sch-effect"
                name="effectMode"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                defaultValue="propose"
              >
                <option value="propose">Propor (aprovação)</option>
                <option value="auto_execute">Auto-executar</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field htmlFor="sch-freq" label="Frequência">
              <select
                id="sch-freq"
                name="frequency"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as ScheduleRow['frequency'])}
              >
                <option value="daily">Diária</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
                <option value="custom">Custom (cron)</option>
                <option value="manual">Manual</option>
              </select>
            </Field>
            <Field htmlFor="sch-tz" label="Timezone" hint="Padrão: timezone da empresa.">
              <Input id="sch-tz" name="timezone" placeholder="America/Sao_Paulo" />
            </Field>
          </div>

          <Field
            htmlFor="sch-recur"
            label="recurrenceConfig (JSON)"
            hint='Ex.: {"weekdays":[1],"localTime":"09:00"} ou {"dayOfMonth":15} ou {"nthBusinessDay":5}'
          >
            <Textarea id="sch-recur" name="recurrenceConfig" rows={2} />
          </Field>

          {frequency === 'custom' ? (
            <Field htmlFor="sch-cron" label="cronExpression">
              <Input id="sch-cron" name="cronExpression" placeholder="0 9 * * 1" />
            </Field>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <Field htmlFor="sch-repeat" label="Repetição">
              <select
                id="sch-repeat"
                name="repeatMode"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                defaultValue="infinite"
              >
                <option value="infinite">Infinita</option>
                <option value="count">Contagem (N vezes)</option>
              </select>
            </Field>
            <Field htmlFor="sch-max" label="maxOccurrences" hint="Só para repetição por contagem.">
              <Input id="sch-max" name="maxOccurrences" type="number" min={1} />
            </Field>
          </div>

          {target === 'ai_agent' ? (
            <Field
              htmlFor="sch-ai"
              label="aiConfig (JSON)"
              hint='Ex.: {"instruction":"Gere o briefing do dia","tools":[],"skillIds":[]}'
            >
              <Textarea id="sch-ai" name="aiConfig" rows={3} defaultValue={'{"instruction":""}'} />
            </Field>
          ) : null}

          {target === 'action' ? (
            <>
              <Field htmlFor="sch-action-type" label="actionType">
                <select
                  id="sch-action-type"
                  name="actionType"
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  defaultValue="send_email"
                >
                  <option value="create_task">create_task</option>
                  <option value="send_email">send_email</option>
                  <option value="send_whatsapp">send_whatsapp</option>
                  <option value="generate_report">generate_report</option>
                  <option value="browser_action">browser_action</option>
                </select>
              </Field>
              <Field
                htmlFor="sch-action-input"
                label="actionInput (JSON)"
                hint='Ex.: {"to":"dono@empresa.com","subject":"Olá","body":"..."}'
              >
                <Textarea id="sch-action-input" name="actionInput" rows={3} defaultValue={'{}'} />
              </Field>
            </>
          ) : null}

          <div>
            <Button type="submit" loading={pending}>
              Criar agendamento
            </Button>
          </div>
        </form>
      </Card>

      {schedules.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Nenhum agendamento.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {schedules.map((schedule) => (
            <li key={schedule.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{schedule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {TARGET_LABEL[schedule.target]} · {FREQ_LABEL[schedule.frequency]} ·{' '}
                      {schedule.effectMode === 'auto_execute' ? 'auto-executa' : 'propõe'}
                      {schedule.repeatMode === 'count'
                        ? ` · ${schedule.successCount}/${schedule.maxOccurrences ?? '—'}`
                        : ''}
                      {schedule.enabled ? '' : ' · desativado'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => void call(`${apiBasePath}/${schedule.id}/trigger`, 'POST')}
                    >
                      Disparar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        void call(`${apiBasePath}/${schedule.id}/enabled`, 'POST', {
                          enabled: !schedule.enabled,
                        })
                      }
                    >
                      {schedule.enabled ? 'Desativar' : 'Reativar'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm('Remover este agendamento?')) {
                          void call(`${apiBasePath}/${schedule.id}`, 'DELETE');
                        }
                      }}
                    >
                      Remover
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
