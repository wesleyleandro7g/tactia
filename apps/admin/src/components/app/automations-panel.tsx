'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type FieldInfo = { key: string; label: string; released: boolean };
type TriggerInfo = { id: string; kind: string; enabled: boolean; eventType: string | null; connectionId: string | null };
type Item = {
  id: string;
  name: string;
  purpose: string;
  status: string;
  versionId: string | null;
  definitionJson: string;
  fields: FieldInfo[];
  defaults: Record<string, unknown>;
  triggers: TriggerInfo[];
};

export function AutomationsPanel({
  tenantId,
  enabled,
  items,
}: {
  tenantId: string;
  enabled: boolean;
  items: Item[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [definition, setDefinition] = useState('');
  const base = `/api/v1/tenants/${tenantId}/automations`;

  async function call(path: string, body?: unknown) {
    setPending(true);
    setError(null);
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const parsed = (await response.json().catch(() => null)) as {
      data?: { secret?: string; id?: string; status?: string; versionId?: string };
      error?: { message?: string };
    } | null;
    setPending(false);
    if (!response.ok) {
      setError(parsed?.error?.message ?? 'Não foi possível concluir a operação.');
      return null;
    }
    if (parsed?.data?.secret) setNotice(`Segredo do webhook (guarde agora): ${parsed.data.secret}`);
    router.refresh();
    return parsed?.data ?? null;
  }

  function createStructured() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(definition);
    } catch {
      setError('A definição precisa ser JSON válido.');
      return;
    }
    void call(base, { definition: parsed, name: 'Automação estruturada' });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm">{notice}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">Habilitada para o cliente: {enabled ? 'sim' : 'não'}</p>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void call(`${base}/enabled`, { enabled: !enabled })}>
          {enabled ? 'Desabilitar' : 'Habilitar'}
        </Button>
        <Button type="button" disabled={pending} onClick={() => void call(base, { templateKey: 'reports.portal' })}>
          Criar piloto de relatórios
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void call(base, { templateKey: 'notify.email' })}>
          Criar aviso por e-mail
        </Button>
      </div>
      <Field htmlFor="structured-definition" label="Definição estruturada">
        <textarea
          id="structured-definition"
          className="min-h-28 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          value={definition}
          onChange={(event) => setDefinition(event.target.value)}
          placeholder='{"inputSchema":{"fields":[]},"outputSchema":{},"steps":[],"pageConfig":{"blocks":[]},"authorizationPolicy":{"connections":[],"effects":{}}}'
        />
      </Field>
      <Button type="button" variant="secondary" disabled={pending || !definition.trim()} onClick={createStructured}>
        Criar a partir da definição
      </Button>
      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <AutomationCard key={item.id} item={item} base={base} pending={pending} onCall={call} />
        ))}
      </ul>
    </div>
  );
}

function AutomationCard({
  item,
  base,
  pending,
  onCall,
}: {
  item: Item;
  base: string;
  pending: boolean;
  onCall: (path: string, body?: unknown) => Promise<{ versionId?: string; id?: string; status?: string } | null>;
}) {
  const [versionId, setVersionId] = useState(item.versionId ?? '');
  const [connectionId, setConnectionId] = useState('demo-reports-portal');
  const [recipient, setRecipient] = useState('');
  const [draftJson, setDraftJson] = useState(item.definitionJson);
  const [testParams, setTestParams] = useState('{\n  "recipient": ""\n}');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [triggerKind, setTriggerKind] = useState<'webhook' | 'internal_event'>('webhook');
  const [sourceId, setSourceId] = useState('');
  const released = item.fields.filter((field) => field.released);
  const [defaults, setDefaults] = useState<Record<string, string>>(() =>
    Object.fromEntries(released.map((field) => [field.key, typeof item.defaults[field.key] === 'string' ? String(item.defaults[field.key]) : ''])),
  );

  async function preparePortal() {
    const data = await onCall(`${base}/${item.id}/draft`, {
      connectionId,
      preauthorizedRecipients: recipient ? [recipient] : [],
    });
    if (data?.versionId) setVersionId(data.versionId);
  }

  async function saveDefinition() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draftJson);
    } catch {
      setTestResult('A definição precisa ser JSON válido.');
      return;
    }
    const data = await onCall(`${base}/${item.id}/draft`, parsed);
    if (data?.versionId) setVersionId(data.versionId);
  }

  async function runTest() {
    let params: unknown;
    try {
      params = JSON.parse(testParams);
    } catch {
      setTestResult('Os parâmetros de teste precisam ser JSON válido.');
      return;
    }
    const data = await onCall(`${base}/${item.id}/test`, { params });
    if (data?.id) setTestResult(`Prévia enfileirada: ${data.id} (${data.status ?? 'queued'})`);
  }

  return (
    <li className="rounded-xl border border-border p-4">
      <h3 className="font-medium">{item.name}</h3>
      <p className="text-sm text-muted-foreground">{item.purpose}</p>
      <p className="mt-1 text-sm">Situação: {item.status}</p>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {item.status === 'paused' ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={() => void onCall(`${base}/${item.id}/resume`)}>
              Retomar publicação
            </Button>
          ) : null}
          {item.status === 'published' ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={() => void onCall(`${base}/${item.id}/pause`)}>
              Pausar
            </Button>
          ) : (
            <Button type="button" disabled={pending || !versionId} onClick={() => void onCall(`${base}/${item.id}/publish`, { versionId })}>
              Publicar
            </Button>
          )}
        </div>
        <Field htmlFor={`conn-${item.id}`} label="Conexão do portal">
          <Input id={`conn-${item.id}`} value={connectionId} onChange={(event) => setConnectionId(event.target.value)} />
        </Field>
        <Field htmlFor={`to-${item.id}`} label="Destinatário pré-autorizado">
          <Input id={`to-${item.id}`} type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} />
        </Field>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void preparePortal()}>
          Preparar versão do piloto
        </Button>
        <Field htmlFor={`def-${item.id}`} label="Editar definição">
          <textarea
            id={`def-${item.id}`}
            className="min-h-36 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
            value={draftJson}
            onChange={(event) => setDraftJson(event.target.value)}
          />
        </Field>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void saveDefinition()}>
          Salvar rascunho
        </Button>
        <Field htmlFor={`test-${item.id}`} label="Parâmetros da prévia">
          <textarea
            id={`test-${item.id}`}
            className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
            value={testParams}
            onChange={(event) => setTestParams(event.target.value)}
          />
        </Field>
        <Button type="button" variant="secondary" disabled={pending || item.status !== 'published'} onClick={() => void runTest()}>
          Prévia / teste
        </Button>
        {testResult ? <p className="text-sm">{testResult}</p> : null}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Gatilhos</p>
          <ul className="flex flex-col gap-1 text-sm">
            {item.triggers.length === 0 ? <li className="text-muted-foreground">Nenhum gatilho.</li> : null}
            {item.triggers.map((trigger) => (
              <li key={trigger.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {trigger.kind === 'webhook' ? 'Webhook' : 'Evento interno'}
                  {trigger.eventType ? ` · ${trigger.eventType}` : ''}
                  {trigger.connectionId ? ` · ${trigger.connectionId}` : ''} · {trigger.enabled ? 'ativo' : 'pausado'}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void onCall(`${base}/${item.id}/triggers/${trigger.id}`, { enabled: !trigger.enabled })}
                >
                  {trigger.enabled ? 'Desativar' : 'Ativar'}
                </Button>
              </li>
            ))}
          </ul>
          <label className="flex flex-col gap-1 text-sm">
            Tipo
            <select
              className="h-9 rounded-md border border-border bg-background px-2"
              value={triggerKind}
              onChange={(event) => setTriggerKind(event.target.value as 'webhook' | 'internal_event')}
            >
              <option value="webhook">Webhook</option>
              <option value="internal_event">sync.completed</option>
            </select>
          </label>
          {triggerKind === 'internal_event' ? (
            <Field htmlFor={`source-${item.id}`} label="Conexão de origem">
              <Input id={`source-${item.id}`} value={sourceId} onChange={(event) => setSourceId(event.target.value)} />
            </Field>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              void onCall(`${base}/${item.id}/triggers`, {
                kind: triggerKind,
                ...(triggerKind === 'internal_event' ? { eventType: 'sync.completed', connectionId: sourceId } : {}),
              })
            }
          >
            Adicionar gatilho
          </Button>
        </div>
        {released.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Parâmetros liberados ao cliente</p>
            {released.map((field) => (
              <Field key={field.key} htmlFor={`param-${item.id}-${field.key}`} label={field.label}>
                <Input
                  id={`param-${item.id}-${field.key}`}
                  value={defaults[field.key] ?? ''}
                  onChange={(event) => setDefaults((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </Field>
            ))}
            <Button
              type="button"
              variant="secondary"
              disabled={pending || item.status === 'draft'}
              onClick={() => void onCall(`${base}/${item.id}/parameters`, { values: defaults })}
            >
              Salvar parâmetros
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
