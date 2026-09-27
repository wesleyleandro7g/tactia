'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { DataTable } from '@/components/ui/data-table';
import { opsJson } from '@/lib/ops-fetch';

const PROVIDER = 'torge';
const ENGINE = 'figranium';
const ENVIRONMENT = 'production';

type Instance = {
  id: string;
  instanceKey: string;
  baseUrl: string;
  environment: string;
  active: boolean;
  allowInsecureHttp: boolean;
  apiKeyCredentialId: string;
  dedicatedConnectionId: string | null;
};

type WorkflowRevision = { id: string; revision: number; workflowVersion: string; publishable: boolean };
type Workflow = { id: string; workflowKey: string; environment: string; activeRevision: WorkflowRevision | null };
type Revision = WorkflowRevision & { definitionChecksum: string; createdAt: string; isActive: boolean };

export function BrowserIntegrationPanel({ tenantId }: { tenantId: string }) {
  const base = `/api/v1/tenants/${tenantId}/browser`;
  const [instances, setInstances] = useState<Instance[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Per-instance edit state.
  const [editUrl, setEditUrl] = useState<Record<string, string>>({});
  const [rotateKey, setRotateKey] = useState<Record<string, string>>({});
  const [healthById, setHealthById] = useState<Record<string, { healthy: boolean; safeMessage: string }>>({});

  // Import + publish state.
  const [importJson, setImportJson] = useState('');
  const [publishInstanceId, setPublishInstanceId] = useState('');
  const [revisionsByWorkflow, setRevisionsByWorkflow] = useState<Record<string, Revision[]>>({});

  const load = useCallback(async () => {
    setError(null);
    setPartial(null);
    const q = `?provider=${PROVIDER}&environment=${ENVIRONMENT}`;
    const [inst, wf] = await Promise.allSettled([
      opsJson<{ items: Instance[] }>(`${base}/instances${q}`, { method: 'GET' }),
      opsJson<{ items: Workflow[] }>(`${base}/workflows${q}`, { method: 'GET' }),
    ]);
    if (inst.status === 'fulfilled') setInstances(inst.value.items);
    if (wf.status === 'fulfilled') setWorkflows(wf.value.items);
    if (inst.status === 'rejected' && wf.status === 'rejected') {
      setError('Falha ao carregar instâncias e fluxos.');
    } else if (inst.status === 'rejected') {
      setPartial('Instâncias indisponíveis; fluxos carregados.');
    } else if (wf.status === 'rejected') {
      setPartial('Fluxos indisponíveis; instâncias carregadas.');
    }
    setLoading(false);
  }, [base]);

  useEffect(() => {
    // Defer to a microtask so the initial data fetch does not run setState
    // synchronously inside the effect body.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(fn: () => Promise<void>) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na operação.');
    } finally {
      setPending(false);
    }
  }

  const testHealth = (id: string) =>
    act(async () => {
      const result = await opsJson<{ healthy: boolean; safeMessage: string }>(
        `${base}/instances/${id}/health`,
      );
      setHealthById((cur) => ({ ...cur, [id]: result }));
      if (!result.healthy) setError(result.safeMessage);
      else setMessage(result.safeMessage);
    });

  const saveUrl = (id: string) =>
    act(async () => {
      const url = editUrl[id]?.trim();
      if (!url) throw new Error('Informe a nova URL.');
      await opsJson(`${base}/instances/${id}`, { method: 'PATCH', body: { baseUrl: url } });
      setMessage('URL atualizada.');
      await load();
    });

  const rotate = (id: string) =>
    act(async () => {
      const apiKey = rotateKey[id]?.trim();
      if (!apiKey) throw new Error('Informe a nova API key.');
      await opsJson(`${base}/instances/${id}`, { method: 'PATCH', body: { apiKey } });
      setRotateKey((cur) => ({ ...cur, [id]: '' }));
      setMessage('API key rotacionada.');
      await load();
    });

  const disable = (id: string) =>
    act(async () => {
      if (!window.confirm('Desabilitar esta instância? O container segue provisionado fora do BKO.')) return;
      await opsJson(`${base}/instances/${id}`, { method: 'DELETE' });
      setMessage('Instância desabilitada.');
      await load();
    });

  const importWorkflow = () =>
    act(async () => {
      if (!importJson.trim()) throw new Error('Cole o JSON do fluxo.');
      const workflow = JSON.parse(importJson) as Record<string, unknown>;
      await opsJson(`${base}/workflows`, {
        body: { provider: PROVIDER, engine: ENGINE, environment: ENVIRONMENT, workflow },
      });
      setImportJson('');
      setMessage('Fluxo importado como nova revisão imutável.');
      await load();
    });

  const publish = (workflowId: string) =>
    act(async () => {
      if (!publishInstanceId) throw new Error('Escolha a instância de publicação.');
      const result = await opsJson<{ taskId: string; operation: string }>(
        `${base}/workflows/${workflowId}/publish`,
        { body: { instanceId: publishInstanceId } },
      );
      setMessage(`Publicado (${result.operation}). Task ${result.taskId.slice(0, 8)}.`);
      await load();
    });

  const loadRevisions = (workflowId: string) =>
    act(async () => {
      const result = await opsJson<{ items: Revision[] }>(
        `${base}/workflows/${workflowId}/revisions`,
        { method: 'GET' },
      );
      setRevisionsByWorkflow((cur) => ({ ...cur, [workflowId]: result.items }));
    });

  const reconcile = (workflowId: string, revisionId: string) =>
    act(async () => {
      await opsJson(`${base}/workflows/${workflowId}/active-revision`, { body: { revisionId } });
      setMessage('Revisão ativa atualizada. Republique para reconciliar o executor.');
      await load();
      await loadRevisions(workflowId);
    });

  if (loading) {
    return <p className="text-sm text-muted-foreground" role="status">Carregando integração…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {partial ? <Alert tone="warning">{partial}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
          Instâncias do executor
        </h2>
        {instances.length === 0 ? (
          <Alert tone="info">Nenhuma instância dinâmica. A resolução usa o fallback por ambiente (env).</Alert>
        ) : (
          <ul className="flex flex-col gap-4">
            {instances.map((inst) => (
              <li key={inst.id} className="rounded-md border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm">{inst.instanceKey}</p>
                    <p className="text-xs text-muted-foreground">{inst.baseUrl}</p>
                  </div>
                  <Badge tone={statusTone(inst.active ? 'active' : 'inactive')}>
                    {inst.active ? 'ativa' : 'desabilitada'}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-col gap-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <Field htmlFor={`url-${inst.id}`} label="Editar URL" className="flex-1 min-w-[220px]">
                      <Input
                        id={`url-${inst.id}`}
                        type="url"
                        defaultValue={inst.baseUrl}
                        onChange={(e) => setEditUrl((c) => ({ ...c, [inst.id]: e.target.value }))}
                      />
                    </Field>
                    <Button type="button" variant="secondary" loading={pending} onClick={() => void saveUrl(inst.id)}>
                      Salvar URL
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <Field htmlFor={`key-${inst.id}`} label="Rotacionar API key" className="flex-1 min-w-[220px]">
                      <Input
                        id={`key-${inst.id}`}
                        type="password"
                        autoComplete="off"
                        value={rotateKey[inst.id] ?? ''}
                        onChange={(e) => setRotateKey((c) => ({ ...c, [inst.id]: e.target.value }))}
                      />
                    </Field>
                    <Button type="button" variant="secondary" loading={pending} onClick={() => void rotate(inst.id)}>
                      Rotacionar
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" loading={pending} onClick={() => void testHealth(inst.id)}>
                      Testar saúde
                    </Button>
                    {inst.active ? (
                      <Button type="button" variant="danger" loading={pending} onClick={() => void disable(inst.id)}>
                        Desabilitar
                      </Button>
                    ) : null}
                  </div>

                  {healthById[inst.id] ? (
                    <Alert tone={healthById[inst.id]!.healthy ? 'success' : 'danger'}>
                      {healthById[inst.id]!.safeMessage}
                    </Alert>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
          Fluxos e revisões
        </h2>

        <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
          <Field htmlFor="import-json" label="Importar / substituir fluxo (JSON)" hint="Cada importação cria uma revisão imutável; a ativa é substituída.">
            <Textarea
              id="import-json"
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder='{ "schemaVersion": 1, "workflowKey": "torge.products", "workflowVersion": "2", "publishable": true, "task": { } }'
              className="min-h-32"
            />
          </Field>
          <div>
            <Button type="button" variant="secondary" loading={pending} onClick={() => void importWorkflow()}>
              Importar revisão
            </Button>
          </div>
        </div>

        {instances.some((i) => i.active) ? (
          <Field htmlFor="publish-instance" label="Instância para publicar/reconciliar" className="max-w-sm">
            <select
              id="publish-instance"
              className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground focus-visible:border-ring"
              value={publishInstanceId}
              onChange={(e) => setPublishInstanceId(e.target.value)}
            >
              <option value="">Selecione…</option>
              {instances.filter((i) => i.active).map((i) => (
                <option key={i.id} value={i.id}>{i.instanceKey}</option>
              ))}
            </select>
          </Field>
        ) : null}

        <DataTable
          caption="Fluxos do executor"
          columns={[
            { key: 'key', header: 'Fluxo', render: (row: Workflow) => row.workflowKey },
            {
              key: 'active',
              header: 'Revisão ativa',
              render: (row) => (row.activeRevision ? `rev ${row.activeRevision.revision} · v${row.activeRevision.workflowVersion}` : '—'),
            },
            {
              key: 'publishable',
              header: 'Publicável',
              render: (row) => (
                <Badge tone={statusTone(row.activeRevision?.publishable ? 'active' : 'inactive')}>
                  {row.activeRevision?.publishable ? 'sim' : 'não'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: 'Ações',
              render: (row) => (
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" loading={pending} disabled={!publishInstanceId} onClick={() => void publish(row.id)}>
                    Publicar
                  </Button>
                  <Button size="sm" variant="ghost" loading={pending} onClick={() => void loadRevisions(row.id)}>
                    Revisões
                  </Button>
                </div>
              ),
            },
          ]}
          rows={workflows}
          rowKey={(row) => row.id}
          emptyLabel="Nenhum fluxo importado."
        />

        {workflows.map((wf) =>
          revisionsByWorkflow[wf.id] ? (
            <div key={wf.id} className="rounded-md border border-border bg-card p-4">
              <p className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Histórico · {wf.workflowKey}
              </p>
              <DataTable
                caption={`Revisões de ${wf.workflowKey}`}
                columns={[
                  { key: 'rev', header: 'Rev', numeric: true, render: (r: Revision) => r.revision },
                  { key: 'ver', header: 'Versão', render: (r) => r.workflowVersion },
                  { key: 'active', header: 'Ativa', render: (r) => (r.isActive ? 'sim' : '—') },
                  {
                    key: 'actions',
                    header: 'Ações',
                    render: (r) =>
                      r.isActive ? (
                        <span className="text-xs text-muted-foreground">Ativa</span>
                      ) : (
                        <Button size="sm" variant="ghost" loading={pending} onClick={() => void reconcile(wf.id, r.id)}>
                          Tornar ativa
                        </Button>
                      ),
                  },
                ]}
                rows={revisionsByWorkflow[wf.id]!}
                rowKey={(r) => r.id}
                emptyLabel="Sem revisões."
              />
            </div>
          ) : null,
        )}
      </section>
    </div>
  );
}
