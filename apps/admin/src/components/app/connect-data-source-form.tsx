'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { groupSelectableSourceKinds, type SourceKind } from '@tactia/domain/data-sources/catalog';
import { sourceNameFromFile } from '@tactia/domain/data-sources/import-mapping';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { opsForm, opsJson } from '@/lib/ops-fetch';
import { cn } from '@/lib/utils';

function fieldValue(
  kind: SourceKind,
  config: Record<string, string>,
  extraJson: string,
): Record<string, unknown> {
  const configuration: Record<string, unknown> = {};
  for (const field of kind.configFields) {
    if (field.type === 'file') continue;
    const raw = config[field.key]?.trim() ?? '';
    if (!raw) continue;
    if (field.type === 'number') configuration[field.key] = Number(raw);
    else if (field.type === 'boolean') configuration[field.key] = raw === 'true';
    else configuration[field.key] = raw;
  }
  if (extraJson.trim()) {
    const extra = JSON.parse(extraJson) as unknown;
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
      throw new Error('A configuração extra precisa ser um objeto JSON.');
    }
    Object.assign(configuration, extra);
  }
  return configuration;
}

export function ConnectDataSourceForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const groups = useMemo(() => groupSelectableSourceKinds(), []);
  const kinds = useMemo(() => groups.flatMap((group) => group.kinds), [groups]);
  const [kindId, setKindId] = useState<string | null>(null);
  const kind = kinds.find((item) => item.id === kindId) ?? null;

  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [extraJson, setExtraJson] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setConfigValue(key: string, value: string) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function pickKind(next: SourceKind) {
    setKindId(next.id);
    setName((current) => (current.trim() ? current : next.label));
    setConfig({});
    setCredentials({});
    setExtraJson('');
    setCsvFile(null);
    setError(null);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!kind) return;
    setPending(true);
    setError(null);
    try {
      const configuration = fieldValue(kind, config, extraJson);
      if (kind.id === 'csv') {
        if (!csvFile) throw new Error('Envie um arquivo CSV.');
        const uploaded = await opsForm<{ filePath: string; fileName: string }>(
          `/api/v1/tenants/${tenantId}/uploads`,
          csvFile,
        );
        configuration['filePath'] = uploaded.filePath;
      }

      let credentialId: string | undefined;
      const credData: Record<string, unknown> = {};
      for (const field of kind.credentialFields) {
        const raw = credentials[field.key]?.trim() ?? '';
        if (raw) credData[field.key] = raw;
        else if (field.required) throw new Error(`Preencha ${field.label}.`);
      }
      if (Object.keys(credData).length > 0) {
        const credential = await opsJson<{ id: string }>(`/api/v1/tenants/${tenantId}/credentials`, {
          body: { provider: kind.id, data: credData },
        });
        credentialId = credential.id;
      }

      const created = await opsJson<{ id: string }>(`/api/v1/tenants/${tenantId}/data-sources`, {
        body: {
          name: name.trim() || (csvFile ? sourceNameFromFile(csvFile.name) : kind.label),
          type: kind.id,
          configuration,
          ...(credentialId ? { credentialId } : {}),
        },
      });
      router.push(`/tenants/${tenantId}/data-sources/${created.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar a fonte');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.group} className="flex flex-col gap-2">
            <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">{group.groupLabel}</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.kinds.map((item) => {
                const selected = item.id === kindId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => pickKind(item)}
                    className={cn(
                      'rounded-md border px-3 py-3 text-left',
                      selected
                        ? 'border-primary bg-accent-soft'
                        : 'border-border bg-card hover:border-muted-foreground/40',
                    )}
                  >
                    <span className="block font-mono text-sm text-foreground">{item.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{item.description}</span>
                    {item.connector === 'none' ? (
                      <span className="mt-2 block font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        Sem conector
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {kind ? (
        <form onSubmit={(event) => void onSubmit(event)} className="flex max-w-xl flex-col gap-4">
          {kind.connector === 'none' ? (
            <Alert tone="warning">
              Conexão registrada. O conector desta fonte ainda não está disponível; o sync ficará bloqueado.
            </Alert>
          ) : null}

          <Field htmlFor="source-name" label="Nome">
            <Input
              id="source-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>

          {kind.configFields.map((field) => {
            if (field.type === 'file') {
              return (
                <Field key={field.key} htmlFor={field.key} label={field.label} hint={field.hint}>
                  <Input
                    id={field.key}
                    type="file"
                    accept=".csv"
                    onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)}
                    required={field.required}
                  />
                </Field>
              );
            }
            if (field.type === 'boolean') {
              return (
                <label key={field.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={config[field.key] === 'true'}
                    onChange={(event) => setConfigValue(field.key, event.target.checked ? 'true' : '')}
                  />
                  {field.label}
                </label>
              );
            }
            return (
              <Field key={field.key} htmlFor={field.key} label={field.label} hint={field.hint}>
                <Input
                  id={field.key}
                  type={field.type === 'number' ? 'number' : field.type === 'secret' ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  required={field.required}
                  value={config[field.key] ?? ''}
                  onChange={(event) => setConfigValue(field.key, event.target.value)}
                />
              </Field>
            );
          })}

          {kind.credentialFields.map((field) => (
            <Field key={field.key} htmlFor={`cred-${field.key}`} label={field.label} hint={field.hint}>
              <Input
                id={`cred-${field.key}`}
                type={field.type === 'secret' ? 'password' : 'text'}
                required={field.required}
                autoComplete="off"
                value={credentials[field.key] ?? ''}
                onChange={(event) =>
                  setCredentials((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            </Field>
          ))}

          <Field htmlFor="extra-json" label="Configuração extra (JSON)" hint="Opcional. Mesclado na configuration da fonte.">
            <Textarea
              id="extra-json"
              value={extraJson}
              onChange={(event) => setExtraJson(event.target.value)}
              placeholder='{ "key": "value" }'
            />
          </Field>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <div>
            <Button type="submit" loading={pending}>
              {pending ? 'Salvando…' : 'Registrar fonte'}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Escolha o tipo de fonte para continuar.</p>
      )}
    </div>
  );
}
