'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { guessMapping, type TargetEntity } from '@tactia/domain/data-sources/import-mapping';
import { Alert } from '@/components/ui/alert';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { DataTable } from '@/components/ui/data-table';
import { SyncButton } from '@/components/app/tenant-actions';
import {
  TableMappingEditor,
  fieldsFromMap,
  type DiscoveryResource,
} from '@/components/app/table-mapping-editor';
import { useCustomMappingFields } from '@/components/app/use-custom-mapping-fields';
import { opsJson } from '@/lib/ops-fetch';

type DataSource = {
  id: string;
  name: string;
  type: string;
  status: string;
  configuration: Record<string, unknown> | null;
  lastSyncAt: string | Date | null;
  credential: { id: string; provider: string } | null;
};

type MappingRow = {
  id: string;
  sourceEntity: string;
  targetEntity: string;
  active: boolean;
  configuration: { fields?: Array<{ source: string; target: string }> };
};

type ModuleRun = {
  id: string;
  moduleKey: string;
  status: string;
  attempt: number;
  workflowVersion: string;
  parserVersion: string;
  recordsRead: number;
  recordsFailed: number;
  safeMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  artifactCount: number;
  artifactIds: string[];
};

export function DataSourceManagePanel({
  tenantId,
  dataSource,
  mappings,
  moduleRuns,
  connectorAvailable,
}: {
  tenantId: string;
  dataSource: DataSource;
  mappings: MappingRow[];
  moduleRuns: ModuleRun[];
  connectorAvailable: boolean;
}) {
  const router = useRouter();
  const base = `/api/v1/tenants/${tenantId}/data-sources/${dataSource.id}`;
  const [name, setName] = useState(dataSource.name);
  const [extraJson, setExtraJson] = useState(
    JSON.stringify(dataSource.configuration ?? {}, null, 2),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resources, setResources] = useState<DiscoveryResource[]>([]);
  const [sourceEntity, setSourceEntity] = useState('');
  const [targetEntity, setTargetEntity] = useState<TargetEntity>('customer');
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});
  const extraFields = useCustomMappingFields(tenantId, targetEntity);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const stale = dataSource.type === 'torge' && dataSource.status === 'active' && (
    !dataSource.lastSyncAt || (now !== null && now - new Date(dataSource.lastSyncAt).getTime() > 36 * 60 * 60 * 1000)
  );

  async function saveMeta(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      let configuration: Record<string, unknown> | undefined;
      if (extraJson.trim()) {
        const parsed = JSON.parse(extraJson) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('A configuração precisa ser um objeto JSON.');
        }
        configuration = parsed as Record<string, unknown>;
      }
      await opsJson(base, { method: 'PATCH', body: { name, configuration } });
      setMessage('Fonte atualizada.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar');
    } finally {
      setPending(false);
    }
  }

  async function setStatus(status: 'active' | 'paused') {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await opsJson(base, { method: 'PATCH', body: { status } });
      setMessage(status === 'active' ? 'Conexão habilitada.' : 'Conexão pausada.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao alterar status');
    } finally {
      setPending(false);
    }
  }

  async function deactivate() {
    if (!window.confirm('Desativar esta fonte? O sync deixa de considerar ela.')) return;
    setPending(true);
    setError(null);
    try {
      await opsJson(base, { method: 'DELETE' });
      router.push(`/tenants/${tenantId}/integrations`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao desativar');
      setPending(false);
    }
  }

  async function testConnection() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await opsJson<{ success: boolean; message: string }>(`${base}/test-connection`);
      if (result.success) setMessage(result.message || 'Conexão ok.');
      else setError(result.message || 'Falha no teste.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no teste');
    } finally {
      setPending(false);
    }
  }

  async function discover() {
    setPending(true);
    setError(null);
    try {
      const result = await opsJson<{ resources: DiscoveryResource[] }>(`${base}/discover`);
      const next = result.resources ?? [];
      setResources(next);
      const first = next[0];
      if (first) {
        setSourceEntity(first.name);
        setFieldMap(guessMapping(first.columns, targetEntity, extraFields));
      }
      setMessage(`${next.length} recurso(s) descobertos.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao descobrir');
    } finally {
      setPending(false);
    }
  }

  async function saveMapping(event: React.FormEvent) {
    event.preventDefault();
    if (!sourceEntity) {
      setError('Descubra a fonte e escolha o recurso de origem.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await opsJson(`${base}/mappings`, {
        body: {
          sourceEntity,
          targetEntity,
          configuration: { fields: fieldsFromMap(fieldMap) },
        },
      });
      setMessage('Mapeamento salvo.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o mapeamento');
    } finally {
      setPending(false);
    }
  }

  async function removeMapping(mappingId: string) {
    setPending(true);
    setError(null);
    try {
      await opsJson(`${base}/mappings/${mappingId}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover o mapeamento');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {stale ? (
        <Alert tone="warning">A conexão está desatualizada: nenhuma coleta completa válida nas últimas 36 horas.</Alert>
      ) : null}
      {connectorAvailable ? null : (
        <Alert tone="warning">
          Conexão registrada. O conector desta fonte ainda não está disponível; teste e sync ficam
          bloqueados.
        </Alert>
      )}

      <form onSubmit={(event) => void saveMeta(event)} className="flex max-w-xl flex-col gap-3">
        <Field htmlFor="ds-name" label="Nome">
          <Input id="ds-name" value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field htmlFor="ds-config" label="Configuração (JSON)">
          <Textarea id="ds-config" value={extraJson} onChange={(event) => setExtraJson(event.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={pending} variant="secondary">
            Salvar
          </Button>
          {dataSource.type === 'torge' ? (
            dataSource.status === 'active' ? (
              <Button type="button" variant="secondary" loading={pending} onClick={() => void setStatus('paused')}>
                Pausar
              </Button>
            ) : (
              <Button type="button" loading={pending} onClick={() => void setStatus('active')}>
                Habilitar
              </Button>
            )
          ) : null}
          <Button type="button" variant="danger" loading={pending} onClick={() => void deactivate()}>
            Desativar
          </Button>
        </div>
      </form>

      {dataSource.credential ? (
        <p className="text-xs text-muted-foreground">
          Credencial {dataSource.credential.provider} · {dataSource.credential.id.slice(0, 8)}
        </p>
      ) : null}

      {connectorAvailable ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
            Conector
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" loading={pending} onClick={() => void testConnection()}>
              Testar conexão
            </Button>
            <Button type="button" variant="secondary" loading={pending} onClick={() => void discover()}>
              Descobrir
            </Button>
            <SyncButton tenantId={tenantId} dataSourceId={dataSource.id} />
          </div>
        </section>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      {connectorAvailable ? (
        <form onSubmit={(event) => void saveMapping(event)} className="flex flex-col gap-3">
          <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
            Mapeamento
          </h2>
          <TableMappingEditor
            resources={resources}
            sourceEntity={sourceEntity}
            targetEntity={targetEntity}
            fieldMap={fieldMap}
            extraFields={extraFields}
            onSourceEntityChange={(next, nextMap) => {
              setSourceEntity(next);
              setFieldMap(nextMap);
            }}
            onTargetEntityChange={(next, nextMap) => {
              setTargetEntity(next);
              setFieldMap(nextMap);
            }}
            onFieldMapChange={setFieldMap}
          />
          <div>
            <Button type="submit" loading={pending} variant="secondary">
              Salvar mapeamento
            </Button>
          </div>
        </form>
      ) : null}

      {dataSource.type === 'torge' ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
            Execuções por módulo
          </h2>
          <DataTable
            caption="Execuções Torge por módulo"
            columns={[
              { key: 'module', header: 'Módulo', render: (row: ModuleRun) => row.moduleKey },
              { key: 'status', header: 'Status', render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
              { key: 'versions', header: 'Fluxo / parser', render: (row) => `v${row.workflowVersion} / v${row.parserVersion}` },
              { key: 'counts', header: 'Lidos / falhas', numeric: true, render: (row) => `${row.recordsRead} / ${row.recordsFailed}` },
              { key: 'attempt', header: 'Tentativa', numeric: true, render: (row) => row.attempt },
              {
                key: 'artifacts', header: 'Artefatos', numeric: true, render: (row) => row.artifactIds.length > 0 ? (
                  <a
                    className="text-primary hover:underline"
                    href={`/api/v1/tenants/${tenantId}/integration-artifacts/${row.artifactIds[0]}`}
                  >
                    {row.artifactCount} arquivo(s)
                  </a>
                ) : '0',
              },
              { key: 'message', header: 'Diagnóstico', render: (row) => row.safeMessage ?? '—' },
              { key: 'finished', header: 'Conclusão', render: (row) => row.finishedAt ? new Date(row.finishedAt).toLocaleString('pt-BR') : '—' },
            ]}
            rows={moduleRuns}
            rowKey={(row) => row.id}
            emptyLabel="Nenhuma execução modular. A fonte permanece em rascunho até ser habilitada."
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
          Mapeamentos ativos
        </h2>
        <DataTable
          caption="Mapeamentos"
          columns={[
            { key: 'source', header: 'Origem', render: (row: MappingRow) => row.sourceEntity },
            { key: 'target', header: 'Destino', render: (row) => row.targetEntity },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <Badge tone={statusTone(row.active ? 'active' : 'inactive')}>
                  {row.active ? 'ativo' : 'inativo'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: 'Ações',
              render: (row) => (
                <Button size="sm" variant="danger" loading={pending} onClick={() => void removeMapping(row.id)}>
                  Remover
                </Button>
              ),
            },
          ]}
          rows={mappings}
          rowKey={(row) => row.id}
          emptyLabel="Nenhum mapeamento."
        />
      </section>
    </div>
  );
}
