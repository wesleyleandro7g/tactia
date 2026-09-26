'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { WizardStepper, type WizardStepMeta } from '@/components/app/wizard-stepper';
import { opsJson } from '@/lib/ops-fetch';

const PROVIDER = 'torge';
const ENGINE = 'figranium';
const ENVIRONMENT = 'production';

const STEPS: WizardStepMeta[] = [
  { id: 'identity', label: 'Fonte' },
  { id: 'instance', label: 'Instância' },
  { id: 'health', label: 'Saúde' },
  { id: 'credential', label: 'Credencial' },
  { id: 'modules', label: 'Módulos' },
  { id: 'workflow', label: 'Importação' },
  { id: 'publish', label: 'Publicação' },
  { id: 'schedule', label: 'Agenda' },
  { id: 'review', label: 'Revisão' },
];

const MODULES = [
  { value: 'products', label: 'Produtos — implementado', disabled: false },
  { value: 'inventory_balances', label: 'Estoque — pendente', disabled: true },
  { value: 'sales_orders', label: 'Pedidos — pendente', disabled: true },
  { value: 'billing', label: 'Faturamento — pendente', disabled: true },
  { value: 'receivables', label: 'Contas a receber — pendente', disabled: true },
];

type HealthResult = { healthy: boolean; safeMessage: string };

type DraftState = {
  sourceName: string;
  accountScope: string;
  branchScope: string;
  instanceKey: string;
  baseUrl: string;
  dedicatedConnectionId: string;
  allowInsecureHttp: boolean;
  modules: string[];
  timezone: string;
  dailyTime: string;
  recentWindowDays: string;
  reconciliationWindowDays: string;
  workflowJson: string;
  // Persisted server-side ids so the operator can resume without re-entering.
  sourceId: string | null;
  credentialId: string | null;
  instanceId: string | null;
  instanceApiKeyRef: string | null;
  workflowId: string | null;
  workflowRevision: number | null;
  publishedTaskId: string | null;
  stepIndex: number;
};

const INITIAL: DraftState = {
  sourceName: 'Torge',
  accountScope: '',
  branchScope: '',
  instanceKey: '',
  baseUrl: '',
  dedicatedConnectionId: '',
  allowInsecureHttp: false,
  modules: ['products'],
  timezone: 'America/Sao_Paulo',
  dailyTime: '03:00',
  recentWindowDays: '30',
  reconciliationWindowDays: '30',
  workflowJson: '',
  sourceId: null,
  credentialId: null,
  instanceId: null,
  instanceApiKeyRef: null,
  workflowId: null,
  workflowRevision: null,
  publishedTaskId: null,
  stepIndex: 0,
};

function storageKey(tenantId: string) {
  return `tactia:torge-wizard:${tenantId}`;
}

function loadDraft(tenantId: string): DraftState {
  if (typeof window === 'undefined') return INITIAL;
  try {
    const raw = window.localStorage.getItem(storageKey(tenantId));
    if (!raw) return INITIAL;
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    return { ...INITIAL, ...parsed };
  } catch {
    return INITIAL;
  }
}

export function TorgeIntegrationWizard({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const base = `/api/v1/tenants/${tenantId}`;
  // Lazy initializer reads any persisted draft once (client-only); secrets are
  // never persisted so they are always re-entered.
  const [state, setState] = useState<DraftState>(() => loadDraft(tenantId));
  // Secrets live only in component state, never in the persisted draft.
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResult | null>(null);

  const persist = useCallback(
    (next: DraftState) => {
      try {
        window.localStorage.setItem(storageKey(tenantId), JSON.stringify(next));
      } catch {
        // Non-fatal: draft persistence is best-effort.
      }
    },
    [tenantId],
  );

  const update = useCallback(
    (patch: Partial<DraftState>) => {
      setState((current) => {
        const next = { ...current, ...patch };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const stepIndex = state.stepIndex;
  const current = STEPS[stepIndex]!;
  const isLast = stepIndex === STEPS.length - 1;

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey(tenantId));
    } catch {
      // ignore
    }
  }, [tenantId]);

  function goToStep(index: number) {
    setError(null);
    setMessage(null);
    update({ stepIndex: Math.max(0, Math.min(index, STEPS.length - 1)) });
  }

  function validate(id: string): string | null {
    if (id === 'identity') {
      if (!state.sourceName.trim()) return 'Informe o nome da fonte.';
      if (!state.accountScope.trim()) return 'Informe a conta/empresa no Torge.';
      if (!state.branchScope.trim()) return 'Informe a filial autorizada.';
    }
    if (id === 'instance') {
      if (!state.instanceKey.trim()) return 'Informe a chave da instância.';
      if (!state.baseUrl.trim()) return 'Informe a URL base do executor.';
      if (!state.instanceId && !apiKey.trim()) return 'Informe a API key da instância.';
    }
    if (id === 'health' && !(health?.healthy)) {
      return 'Teste a saúde e a API key antes de prosseguir.';
    }
    if (id === 'credential' && !state.credentialId) {
      if (!username.trim() || !password.trim()) return 'Informe usuário e senha do Torge.';
    }
    if (id === 'modules' && state.modules.length === 0) {
      return 'Selecione ao menos um módulo.';
    }
    if (id === 'workflow' && !state.workflowId) {
      if (!state.workflowJson.trim()) return 'Cole o JSON do fluxo ou avance sem publicar.';
    }
    return null;
  }

  async function next() {
    const problem = validate(current.id);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setMessage(null);

    // Side effects per step: create source draft, instance, credential, import.
    try {
      setPending(true);
      if (current.id === 'identity' && !state.sourceId) {
        const created = await opsJson<{ id: string }>(`${base}/data-sources`, {
          body: {
            name: state.sourceName.trim(),
            type: PROVIDER,
            configuration: {
              accountScope: state.accountScope.trim(),
              branchScope: state.branchScope.trim(),
              instanceKey: state.instanceKey.trim(),
              isolationMode: 'dedicated_instance',
              enabledModules: state.modules,
              timezone: state.timezone,
              dailyTime: state.dailyTime,
              recentWindowDays: Number(state.recentWindowDays),
              reconciliationWindowDays: Number(state.reconciliationWindowDays),
            },
          },
        });
        update({ sourceId: created.id });
      }
      if (current.id === 'instance' && !state.instanceId) {
        const created = await opsJson<{ id: string; apiKeyCredentialId: string }>(
          `${base}/browser/instances`,
          {
            body: {
              provider: PROVIDER,
              engine: ENGINE,
              instanceKey: state.instanceKey.trim(),
              baseUrl: state.baseUrl.trim(),
              environment: ENVIRONMENT,
              allowInsecureHttp: state.allowInsecureHttp,
              ...(state.dedicatedConnectionId.trim()
                ? { dedicatedConnectionId: state.dedicatedConnectionId.trim() }
                : {}),
              apiKey: apiKey.trim(),
            },
          },
        );
        setApiKey('');
        update({ instanceId: created.id, instanceApiKeyRef: created.apiKeyCredentialId });
      }
      if (current.id === 'credential' && !state.credentialId) {
        const created = await opsJson<{ id: string }>(`${base}/credentials`, {
          body: { provider: PROVIDER, data: { username: username.trim(), password } },
        });
        setUsername('');
        setPassword('');
        update({ credentialId: created.id });
      }
      if (current.id === 'workflow' && !state.workflowId && state.workflowJson.trim()) {
        const workflow = JSON.parse(state.workflowJson) as Record<string, unknown>;
        const imported = await opsJson<{ workflowId: string; revision: number }>(
          `${base}/browser/workflows`,
          {
            body: { provider: PROVIDER, engine: ENGINE, environment: ENVIRONMENT, workflow },
          },
        );
        update({ workflowId: imported.workflowId, workflowRevision: imported.revision });
      }
      goToStep(stepIndex + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao avançar a etapa.');
    } finally {
      setPending(false);
    }
  }

  async function runHealth() {
    setPending(true);
    setError(null);
    setHealth(null);
    try {
      const result = state.instanceId
        ? await opsJson<HealthResult>(`${base}/browser/instances/${state.instanceId}/health`)
        : await opsJson<HealthResult>(`${base}/browser/instances/test-health`, {
            body: { baseUrl: state.baseUrl.trim(), apiKey: apiKey.trim() },
          });
      setHealth(result);
      if (!result.healthy) setError(result.safeMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no teste de saúde.');
    } finally {
      setPending(false);
    }
  }

  async function publish() {
    if (!state.workflowId || !state.instanceId) {
      setError('É preciso ter instância e fluxo importado para publicar.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await opsJson<{ taskId: string; operation: string }>(
        `${base}/browser/workflows/${state.workflowId}/publish`,
        { body: { instanceId: state.instanceId } },
      );
      update({ publishedTaskId: result.taskId });
      setMessage(`Fluxo publicado (${result.operation}). Task ${result.taskId.slice(0, 8)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao publicar o fluxo.');
    } finally {
      setPending(false);
    }
  }

  function finish() {
    clearDraft();
    if (state.sourceId) {
      router.push(`/tenants/${tenantId}/data-sources/${state.sourceId}`);
    } else {
      router.push(`/tenants/${tenantId}/integrations`);
    }
    router.refresh();
  }

  const summary = useMemo(
    () => [
      { label: 'Fonte', value: state.sourceName || '—' },
      { label: 'Conta / filial', value: `${state.accountScope || '—'} / ${state.branchScope || '—'}` },
      { label: 'Instância', value: state.instanceKey || '—' },
      { label: 'URL', value: state.baseUrl || '—' },
      { label: 'API key', value: state.instanceApiKeyRef ? 'armazenada' : '—' },
      { label: 'Saúde', value: health?.healthy ? 'ok' : 'não testada' },
      { label: 'Credencial Torge', value: state.credentialId ? 'armazenada' : '—' },
      { label: 'Módulos', value: state.modules.join(', ') || '—' },
      {
        label: 'Fluxo',
        value: state.workflowId ? `rev ${state.workflowRevision ?? '?'}` : '—',
      },
      { label: 'Publicação', value: state.publishedTaskId ? 'publicado' : 'pendente' },
      { label: 'Agenda', value: 'remota desligada · orquestração Tactia' },
    ],
    [state, health],
  );

  const resumable =
    state.sourceId || state.instanceId || state.credentialId || state.workflowId;

  return (
    <div className="max-w-xl">
      <WizardStepper steps={STEPS} currentIndex={stepIndex} />

      {resumable ? (
        <Alert tone="info" className="mb-4">
          Rascunho em andamento. As etapas já concluídas foram salvas; segredos não são retidos.
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        {current.id === 'identity' ? (
          <>
            <Field htmlFor="tw-name" label="Nome da fonte">
              <Input id="tw-name" value={state.sourceName} onChange={(e) => update({ sourceName: e.target.value })} disabled={!!state.sourceId} autoFocus />
            </Field>
            <Field htmlFor="tw-account" label="Conta/empresa no Torge" hint="Identificação operacional, sem segredo.">
              <Input id="tw-account" value={state.accountScope} onChange={(e) => update({ accountScope: e.target.value })} disabled={!!state.sourceId} />
            </Field>
            <Field htmlFor="tw-branch" label="Filial autorizada">
              <Input id="tw-branch" value={state.branchScope} onChange={(e) => update({ branchScope: e.target.value })} disabled={!!state.sourceId} />
            </Field>
          </>
        ) : null}

        {current.id === 'instance' ? (
          <>
            <Alert tone="info">
              O container do executor é provisionado fora do BKO. Informe aqui a instância já provisionada.
            </Alert>
            <Field htmlFor="tw-key" label="Chave da instância">
              <Input id="tw-key" value={state.instanceKey} onChange={(e) => update({ instanceKey: e.target.value })} disabled={!!state.instanceId} />
            </Field>
            <Field htmlFor="tw-url" label="URL base do executor">
              <Input id="tw-url" type="url" value={state.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} disabled={!!state.instanceId} placeholder="https://executor.interno/" />
            </Field>
            <Field htmlFor="tw-conn" label="Conexão dedicada (opcional)" hint="UUID da conexão dedicada. Necessária antes do primeiro sync.">
              <Input id="tw-conn" value={state.dedicatedConnectionId} onChange={(e) => update({ dedicatedConnectionId: e.target.value })} disabled={!!state.instanceId} />
            </Field>
            {state.instanceId ? (
              <p className="text-xs text-muted-foreground">API key armazenada. Rotacione pelo painel da fonte.</p>
            ) : (
              <Field htmlFor="tw-apikey" label="API key da instância" hint="Enviada uma vez e guardada como credencial; nunca é retornada.">
                <Input id="tw-apikey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
              </Field>
            )}
          </>
        ) : null}

        {current.id === 'health' ? (
          <>
            <p className="text-sm text-muted-foreground">
              Testa se o executor responde e se a API key é aceita. Nenhum segredo é exibido.
            </p>
            <Button type="button" variant="secondary" loading={pending} onClick={() => void runHealth()}>
              Testar saúde + API key
            </Button>
            {health ? (
              <Alert tone={health.healthy ? 'success' : 'danger'}>{health.safeMessage}</Alert>
            ) : null}
          </>
        ) : null}

        {current.id === 'credential' ? (
          state.credentialId ? (
            <Alert tone="success">Credencial Torge armazenada com segurança.</Alert>
          ) : (
            <>
              <Field htmlFor="tw-user" label="Usuário Torge">
                <Input id="tw-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              </Field>
              <Field htmlFor="tw-pass" label="Senha Torge">
                <Input id="tw-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              </Field>
            </>
          )
        ) : null}

        {current.id === 'modules' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Módulos</legend>
            {MODULES.map((mod) => (
              <label key={mod.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.modules.includes(mod.value)}
                  disabled={mod.disabled}
                  onChange={(e) =>
                    update({
                      modules: e.target.checked
                        ? [...state.modules, mod.value]
                        : state.modules.filter((m) => m !== mod.value),
                    })
                  }
                />
                <span className={mod.disabled ? 'text-muted-foreground' : undefined}>{mod.label}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {current.id === 'workflow' ? (
          state.workflowId ? (
            <Alert tone="success">Fluxo importado (revisão {state.workflowRevision}). Reimporte pelo painel para substituir.</Alert>
          ) : (
            <Field htmlFor="tw-json" label="JSON do fluxo (opcional nesta etapa)" hint="Importar cria uma revisão imutável. Pode publicar depois pelo painel.">
              <Textarea
                id="tw-json"
                value={state.workflowJson}
                onChange={(e) => update({ workflowJson: e.target.value })}
                placeholder='{ "schemaVersion": 1, "workflowKey": "torge.products", "workflowVersion": "1", "publishable": true, "task": { } }'
                className="min-h-40"
              />
            </Field>
          )
        ) : null}

        {current.id === 'publish' ? (
          <>
            <p className="text-sm text-muted-foreground">
              Publica a revisão ativa no executor. A agenda remota é sempre desligada; a orquestração é da Tactia.
            </p>
            <Button
              type="button"
              variant="secondary"
              loading={pending}
              disabled={!state.workflowId || !state.instanceId}
              onClick={() => void publish()}
            >
              Publicar fluxo
            </Button>
            {!state.workflowId ? (
              <Alert tone="warning">Nenhum fluxo importado. Você pode publicar depois pelo painel da fonte.</Alert>
            ) : null}
          </>
        ) : null}

        {current.id === 'schedule' ? (
          <>
            <Alert tone="info">
              O agendamento remoto permanece desligado. A Tactia orquestra as coletas conforme os parâmetros abaixo.
            </Alert>
            <Field htmlFor="tw-tz" label="Fuso">
              <Input id="tw-tz" value={state.timezone} onChange={(e) => update({ timezone: e.target.value })} />
            </Field>
            <Field htmlFor="tw-time" label="Horário diário">
              <Input id="tw-time" type="time" value={state.dailyTime} onChange={(e) => update({ dailyTime: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field htmlFor="tw-recent" label="Janela recente (dias)">
                <Input id="tw-recent" type="number" value={state.recentWindowDays} onChange={(e) => update({ recentWindowDays: e.target.value })} />
              </Field>
              <Field htmlFor="tw-recon" label="Reconciliação (dias)">
                <Input id="tw-recon" type="number" value={state.reconciliationWindowDays} onChange={(e) => update({ reconciliationWindowDays: e.target.value })} />
              </Field>
            </div>
          </>
        ) : null}

        {current.id === 'review' ? (
          <dl className="rounded-md border border-border bg-card px-3 py-3 text-sm">
            {summary.map((row) => (
              <div key={row.label} className="flex justify-between gap-4 py-1">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="max-w-[60%] truncate font-mono">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {error ? <Alert tone="danger">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}

        <div className="flex flex-wrap gap-2">
          {stepIndex > 0 ? (
            <Button type="button" variant="secondary" onClick={() => goToStep(stepIndex - 1)} disabled={pending}>
              Voltar
            </Button>
          ) : null}
          {!isLast ? (
            <Button type="button" loading={pending} onClick={() => void next()}>
              Continuar
            </Button>
          ) : (
            <Button type="button" onClick={finish}>
              Concluir
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
