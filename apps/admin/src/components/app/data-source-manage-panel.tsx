'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  TARGET_ENTITIES,
  guessMapping,
  targetFieldsFor,
} from '@tactia/domain/data-sources/import-mapping';
import { Alert } from '@/components/ui/alert';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DataTable } from '@/components/ui/data-table';
import { SyncButton } from '@/components/app/tenant-actions';
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

type DiscoveryColumn = { name: string; type: string; nullable: boolean };
type DiscoveryResource = { name: string; columns: DiscoveryColumn[] };

export function DataSourceManagePanel({
  tenantId,
  dataSource,
  mappings,
  connectorAvailable,
}: {
  tenantId: string;
  dataSource: DataSource;
  mappings: MappingRow[];
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
  const [targetEntity, setTargetEntity] = useState<(typeof TARGET_ENTITIES)[number]['value']>('customer');
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});

  const selected = useMemo(
    () => resources.find((resource) => resource.name === sourceEntity) ?? null,
    [resources, sourceEntity],
  );
  const targetFields = targetFieldsFor(targetEntity);

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

  async function deactivate() {
    if (!window.confirm('Desativar esta fonte? O sync deixa de considerar ela.')) return;
    setPending(true);
    setError(null);
    try {
      await opsJson(base, { method: 'DELETE' });
      router.push(`/tenants/${tenantId}`);
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
        setFieldMap(guessMapping(first.columns, targetEntity));
      }
      setMessage(`${next.length} recurso(s) descobertos.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao descobrir');
    } finally {
      setPending(false);
    }
  }

  function applyEntity(next: (typeof TARGET_ENTITIES)[number]['value']) {
    setTargetEntity(next);
    if (selected) setFieldMap(guessMapping(selected.columns, next));
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
      const fields = Object.entries(fieldMap)
        .filter(([, target]) => target)
        .map(([source, target]) => ({ source, target }));
      await opsJson(`${base}/mappings`, {
        body: {
          sourceEntity,
          targetEntity,
          configuration: { fields },
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
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            <Field htmlFor="source-entity" label="Recurso de origem">
              {resources.length > 0 ? (
                <Select
                  id="source-entity"
                  value={sourceEntity}
                  onChange={(event) => {
                    setSourceEntity(event.target.value);
                    const resource = resources.find((item) => item.name === event.target.value);
                    if (resource) setFieldMap(guessMapping(resource.columns, targetEntity));
                  }}
                >
                  {resources.map((resource) => (
                    <option key={resource.name} value={resource.name}>
                      {resource.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id="source-entity"
                  value={sourceEntity}
                  onChange={(event) => setSourceEntity(event.target.value)}
                  placeholder="data ou nome da tabela"
                />
              )}
            </Field>
            <Field htmlFor="target-entity" label="Entidade Tactia">
              <Select
                id="target-entity"
                value={targetEntity}
                onChange={(event) => applyEntity(event.target.value as typeof targetEntity)}
              >
                {TARGET_ENTITIES.map((entity) => (
                  <option key={entity.value} value={entity.value}>
                    {entity.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {selected ? (
            <DataTable
              caption="Colunas"
              columns={[
                { key: 'source', header: 'Origem', render: (row: DiscoveryColumn) => row.name },
                {
                  key: 'target',
                  header: 'Destino',
                  render: (row) => (
                    <Select
                      aria-label={`Destino de ${row.name}`}
                      value={fieldMap[row.name] ?? ''}
                      onChange={(event) =>
                        setFieldMap((current) => ({ ...current, [row.name]: event.target.value }))
                      }
                    >
                      {targetFields.map((field) => (
                        <option key={field.value || 'ignore'} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                    </Select>
                  ),
                },
              ]}
              rows={selected.columns}
              rowKey={(row) => row.name}
            />
          ) : null}

          <div>
            <Button type="submit" loading={pending} variant="secondary">
              Salvar mapeamento
            </Button>
          </div>
        </form>
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
