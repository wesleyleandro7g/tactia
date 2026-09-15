'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  SQL_DIALECTS,
  defaultSqlPort,
  sqlDialectLabel,
  type SourceKind,
  type SqlDialect,
} from '@tactia/domain/data-sources/catalog';
import { TARGET_ENTITIES, guessMapping, type TargetEntity } from '@tactia/domain/data-sources/import-mapping';
import { CatalogFieldsForm } from '@/components/app/catalog-fields-form';
import {
  TableMappingEditor,
  fieldsFromMap,
  type DiscoveryResource,
  type DraftMapping,
} from '@/components/app/table-mapping-editor';
import { useCustomMappingFields } from '@/components/app/use-custom-mapping-fields';
import { WizardStepper } from '@/components/app/wizard-stepper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { DataTable } from '@/components/ui/data-table';
import { opsJson } from '@/lib/ops-fetch';

const STEPS = [
  { id: 'connection', label: 'Conexão' },
  { id: 'mapping', label: 'Mapeamento' },
  { id: 'review', label: 'Concluir' },
] as const;

function entityLabel(value: string): string {
  return TARGET_ENTITIES.find((entity) => entity.value === value)?.label ?? value;
}

function configFieldsFor(kind: SourceKind, dialect: SqlDialect) {
  return kind.configFields.filter((field) => dialect === 'postgres' || field.key !== 'schema');
}

export function DatabaseConnectWizard({
  tenantId,
  kind,
}: {
  tenantId: string;
  kind: SourceKind;
}) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState(kind.label);
  const [dialect, setDialect] = useState<SqlDialect>('postgres');
  const [config, setConfig] = useState<Record<string, string>>({
    port: String(defaultSqlPort('postgres')),
  });
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [tested, setTested] = useState(false);
  const [resources, setResources] = useState<DiscoveryResource[]>([]);
  const [sourceEntity, setSourceEntity] = useState('');
  const [targetEntity, setTargetEntity] = useState<TargetEntity>('customer');
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});
  const extraFields = useCustomMappingFields(tenantId, targetEntity);
  const [mappings, setMappings] = useState<DraftMapping[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const current = STEPS[stepIndex]!;
  const visibleConfigFields = useMemo(
    () =>
      configFieldsFor(kind, dialect).map((field) =>
        field.key === 'port' ? { ...field, placeholder: String(defaultSqlPort(dialect)) } : field,
      ),
    [kind, dialect],
  );

  function invalidateTest() {
    setTested(false);
    setResources([]);
    setMappings([]);
    setMessage(null);
  }

  function setConfigValue(key: string, value: string) {
    setConfig((currentConfig) => ({ ...currentConfig, [key]: value }));
    invalidateTest();
  }

  function setCredentialValue(key: string, value: string) {
    setCredentials((currentCredentials) => ({ ...currentCredentials, [key]: value }));
    invalidateTest();
  }

  function changeDialect(next: SqlDialect) {
    setDialect(next);
    setConfig((currentConfig) => {
      const previousDefault = String(defaultSqlPort(dialect));
      const port = !currentConfig.port || currentConfig.port === previousDefault
        ? String(defaultSqlPort(next))
        : currentConfig.port;
      return { ...currentConfig, port };
    });
    if (name === kind.label || name === sqlDialectLabel(dialect)) {
      setName(sqlDialectLabel(next));
    }
    invalidateTest();
  }

  function connectionPayload() {
    const configuration: Record<string, unknown> = {};
    for (const field of visibleConfigFields) {
      if (field.type === 'file') continue;
      const raw = config[field.key]?.trim() ?? '';
      if (!raw) continue;
      if (field.type === 'number') configuration[field.key] = Number(raw);
      else if (field.type === 'boolean') configuration[field.key] = raw === 'true';
      else configuration[field.key] = raw;
    }
    return {
      dialect,
      configuration,
      credentials: {
        username: credentials.username?.trim() ?? '',
        password: credentials.password ?? '',
      },
    };
  }

  function validateConnection(): string | null {
    if (!name.trim()) return 'Informe o nome da fonte.';
    for (const field of visibleConfigFields) {
      if (!field.required || field.type === 'boolean') continue;
      if (!(config[field.key]?.trim())) return `Preencha ${field.label}.`;
    }
    for (const field of kind.credentialFields) {
      if (field.required && !(credentials[field.key]?.trim())) {
        return `Preencha ${field.label}.`;
      }
    }
    return null;
  }

  async function testConnection() {
    const validation = validateConnection();
    if (validation) {
      setError(validation);
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await opsJson<{
        success: boolean;
        message: string;
        resources?: DiscoveryResource[];
      }>(`/api/v1/tenants/${tenantId}/data-sources/probe`, {
        body: connectionPayload(),
      });
      if (!result.success) {
        setTested(false);
        setError(result.message || 'Falha no teste de conexão.');
        return;
      }
      const nextResources = result.resources ?? [];
      setResources(nextResources);
      setTested(true);
      const first = nextResources[0];
      if (first) {
        setSourceEntity(first.name);
        setFieldMap(guessMapping(first.columns, targetEntity, extraFields));
      } else {
        setSourceEntity('');
        setFieldMap({});
      }
      setMessage(result.message || `${nextResources.length} tabela(s) descoberta(s).`);
    } catch (err) {
      setTested(false);
      setError(err instanceof Error ? err.message : 'Falha no teste de conexão');
    } finally {
      setPending(false);
    }
  }

  function goNext() {
    if (current.id === 'connection') {
      const validation = validateConnection();
      if (validation) {
        setError(validation);
        return;
      }
      if (!tested) {
        setError('Teste a conexão antes de continuar.');
        return;
      }
    }
    setError(null);
    setMessage(null);
    setStepIndex((index) => Math.min(index + 1, STEPS.length - 1));
  }

  function goBack() {
    setError(null);
    setMessage(null);
    setStepIndex((index) => Math.max(index - 1, 0));
  }

  function addMapping() {
    if (!sourceEntity) {
      setError('Escolha a tabela de origem.');
      return;
    }
    const fields = fieldsFromMap(fieldMap);
    if (fields.length === 0) {
      setError('Mapeie ao menos uma coluna.');
      return;
    }
    setMappings((currentMappings) => [
      ...currentMappings.filter(
        (mapping) => !(mapping.sourceEntity === sourceEntity && mapping.targetEntity === targetEntity),
      ),
      { sourceEntity, targetEntity, fields },
    ]);
    setError(null);
    setMessage(`Mapeamento de ${sourceEntity} → ${entityLabel(targetEntity)} adicionado.`);
  }

  function removeMapping(source: string, target: string) {
    setMappings((currentMappings) =>
      currentMappings.filter(
        (mapping) => !(mapping.sourceEntity === source && mapping.targetEntity === target),
      ),
    );
  }

  async function conclude() {
    if (!tested) {
      setError('Teste a conexão novamente antes de concluir.');
      setStepIndex(0);
      return;
    }
    const validation = validateConnection();
    if (validation) {
      setError(validation);
      setStepIndex(0);
      return;
    }
    setPending(true);
    setError(null);
    let createdId: string | undefined;
    try {
      const payload = connectionPayload();
      const credential = await opsJson<{ id: string }>(`/api/v1/tenants/${tenantId}/credentials`, {
        body: { provider: 'database', data: payload.credentials },
      });
      const created = await opsJson<{ id: string }>(`/api/v1/tenants/${tenantId}/data-sources`, {
        body: {
          name: name.trim() || sqlDialectLabel(dialect),
          type: 'database',
          configuration: { dialect: payload.dialect, ...payload.configuration },
          credentialId: credential.id,
        },
      });
      createdId = created.id;
      for (const mapping of mappings) {
        await opsJson(`/api/v1/tenants/${tenantId}/data-sources/${created.id}/mappings`, {
          body: {
            sourceEntity: mapping.sourceEntity,
            targetEntity: mapping.targetEntity,
            configuration: { fields: mapping.fields },
          },
        });
      }
      router.push(`/tenants/${tenantId}/data-sources/${created.id}`);
      router.refresh();
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Falha ao concluir a conexão';
      setError(
        createdId
          ? `Fonte criada, mas ${reason}. Conclua o mapeamento na página da fonte.`
          : reason,
      );
      if (createdId) {
        router.push(`/tenants/${tenantId}/data-sources/${createdId}`);
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <WizardStepper steps={[...STEPS]} currentIndex={stepIndex} />

      <div className="flex flex-col gap-4">
        {current.id === 'connection' ? (
          <>
            <Field htmlFor="source-name" label="Nome">
              <Input
                id="source-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field htmlFor="dialect" label="Dialeto">
              <Select
                id="dialect"
                value={dialect}
                onChange={(event) => changeDialect(event.target.value as SqlDialect)}
              >
                {SQL_DIALECTS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
            <CatalogFieldsForm
              fields={visibleConfigFields}
              values={config}
              onChange={setConfigValue}
            />
            <CatalogFieldsForm
              fields={kind.credentialFields}
              values={credentials}
              onChange={setCredentialValue}
              idPrefix="cred-"
            />
            <div>
              <Button type="button" variant="secondary" loading={pending} onClick={() => void testConnection()}>
                Testar conexão
              </Button>
            </div>
          </>
        ) : null}

        {current.id === 'mapping' ? (
          <>
            {resources.length === 0 ? (
              <Alert tone="warning">Nenhuma tabela foi descoberta. Volte e confira o schema ou o banco.</Alert>
            ) : (
              <p className="text-sm text-muted-foreground">
                Relacione tabelas do banco externo com as entidades internas da Tactia. Você pode
                adicionar mais de um mapeamento.
              </p>
            )}
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
              <Button type="button" variant="secondary" onClick={addMapping}>
                Adicionar mapeamento
              </Button>
            </div>
            <DataTable
              caption="Mapeamentos desta conexão"
              columns={[
                { key: 'source', header: 'Origem', render: (row: DraftMapping) => row.sourceEntity },
                { key: 'target', header: 'Destino', render: (row) => entityLabel(row.targetEntity) },
                {
                  key: 'fields',
                  header: 'Colunas',
                  render: (row) => String(row.fields.length),
                },
                {
                  key: 'actions',
                  header: 'Ações',
                  render: (row) => (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => removeMapping(row.sourceEntity, row.targetEntity)}
                    >
                      Remover
                    </Button>
                  ),
                },
              ]}
              rows={mappings}
              rowKey={(row) => `${row.sourceEntity}:${row.targetEntity}`}
              emptyLabel="Nenhum mapeamento adicionado."
            />
          </>
        ) : null}

        {current.id === 'review' ? (
          <dl className="rounded-md border border-border bg-card px-3 py-3 text-sm">
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-muted-foreground">Nome</dt>
              <dd className="font-mono">{name.trim() || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-muted-foreground">Dialeto</dt>
              <dd className="font-mono">{sqlDialectLabel(dialect)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-muted-foreground">Host</dt>
              <dd className="max-w-[60%] truncate font-mono">{config.host?.trim() || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-muted-foreground">Banco</dt>
              <dd className="max-w-[60%] truncate font-mono">{config.database?.trim() || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-muted-foreground">Teste</dt>
              <dd className="font-mono">{tested ? 'ok' : 'pendente'}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-muted-foreground">Mapeamentos</dt>
              <dd className="font-mono">{mappings.length}</dd>
            </div>
          </dl>
        ) : null}

        {error ? <Alert tone="danger">{error}</Alert> : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

        <div className="flex flex-wrap gap-2">
          {stepIndex > 0 ? (
            <Button type="button" variant="secondary" onClick={goBack} disabled={pending}>
              Voltar
            </Button>
          ) : null}
          {current.id !== 'review' ? (
            <Button type="button" onClick={goNext} disabled={pending}>
              Continuar
            </Button>
          ) : (
            <Button type="button" loading={pending} onClick={() => void conclude()}>
              {pending ? 'Salvando…' : 'Concluir conexão'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
