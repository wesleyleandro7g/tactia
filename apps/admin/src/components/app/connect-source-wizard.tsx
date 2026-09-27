'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SourceKind } from '@tactia/domain/data-sources/catalog';
import { sourceNameFromFile } from '@tactia/domain/data-sources/import-mapping';
import { CatalogFieldsForm } from '@/components/app/catalog-fields-form';
import {
  connectorStepsFor,
  type ConnectorStepId,
} from '@/components/app/connector-steps';
import { WizardStepper } from '@/components/app/wizard-stepper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { opsForm, opsJson } from '@/lib/ops-fetch';

function buildConfiguration(
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
    else if (field.type === 'multiselect') configuration[field.key] = raw.split(',').filter(Boolean);
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

function validateStep(
  stepId: ConnectorStepId,
  kind: SourceKind,
  name: string,
  config: Record<string, string>,
  credentials: Record<string, string>,
  csvFile: File | null,
): string | null {
  if (stepId === 'identity') {
    if (!name.trim()) return 'Informe o nome da fonte.';
    return null;
  }
  if (stepId === 'config') {
    for (const field of kind.configFields) {
      if (!field.required) continue;
      if (field.type === 'file') {
        if (kind.id === 'csv' && !csvFile) return 'Envie um arquivo CSV.';
        continue;
      }
      if (field.type === 'boolean') continue;
      if (!(config[field.key]?.trim())) return `Preencha ${field.label}.`;
    }
    return null;
  }
  if (stepId === 'credentials') {
    for (const field of kind.credentialFields) {
      if (field.required && !(credentials[field.key]?.trim())) {
        return `Preencha ${field.label}.`;
      }
    }
    return null;
  }
  return null;
}

export function ConnectSourceWizard({
  tenantId,
  kind,
}: {
  tenantId: string;
  kind: SourceKind;
}) {
  const router = useRouter();
  const steps = useMemo(() => connectorStepsFor(kind), [kind]);
  const [stepIndex, setStepIndex] = useState(0);
  const current = steps[stepIndex]!;

  const [name, setName] = useState(kind.label);
  const [config, setConfig] = useState<Record<string, string>>(
    kind.id === 'torge'
      ? {
          isolationMode: 'dedicated_instance',
          enabledModules: 'products',
          timezone: 'America/Sao_Paulo',
          dailyTime: '03:00',
          recentWindowDays: '30',
          reconciliationWindowDays: '30',
        }
      : {},
  );
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [extraJson, setExtraJson] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setConfigValue(key: string, value: string) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function setCredentialValue(key: string, value: string) {
    setCredentials((current) => ({ ...current, [key]: value }));
  }

  function goNext() {
    const message = validateStep(current.id, kind, name, config, credentials, csvFile);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    if (kind.id === 'csv' && current.id === 'config' && csvFile && !name.trim()) {
      setName(sourceNameFromFile(csvFile.name));
    }
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
  }

  function goBack() {
    setError(null);
    setStepIndex((index) => Math.max(index - 1, 0));
  }

  async function onSubmit() {
    const message = validateStep('review', kind, name, config, credentials, csvFile);
    if (message) {
      setError(message);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const configuration = buildConfiguration(kind, config, extraJson);
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

  const isLast = stepIndex === steps.length - 1;

  return (
    <div className="max-w-xl">
      <WizardStepper steps={steps} currentIndex={stepIndex} />

      <div className="flex flex-col gap-4">
        {current.id === 'identity' ? (
          <Field htmlFor="source-name" label="Nome">
            <Input
              id="source-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </Field>
        ) : null}

        {current.id === 'config' ? (
          <>
            <CatalogFieldsForm
              fields={kind.configFields}
              values={config}
              onChange={setConfigValue}
              fileAccept={kind.id === 'csv' ? '.csv' : kind.id === 'xlsx' ? '.xlsx,.xls' : undefined}
              onFileChange={(_key, file) => {
                setCsvFile(file);
                if (file && kind.id === 'csv' && (!name.trim() || name === kind.label)) {
                  setName(sourceNameFromFile(file.name));
                }
              }}
            />
            <Field
              htmlFor="extra-json"
              label="Configuração extra (JSON)"
              hint="Opcional. Mesclado na configuration da fonte."
            >
              <Textarea
                id="extra-json"
                value={extraJson}
                onChange={(event) => setExtraJson(event.target.value)}
                placeholder='{ "key": "value" }'
              />
            </Field>
          </>
        ) : null}

        {current.id === 'credentials' ? (
          <CatalogFieldsForm
            fields={kind.credentialFields}
            values={credentials}
            onChange={setCredentialValue}
            idPrefix="cred-"
          />
        ) : null}

        {current.id === 'review' ? (
          <div className="flex flex-col gap-3">
            {kind.connector === 'none' ? (
              <Alert tone="warning">
                O conector desta fonte ainda não está disponível; o sync ficará bloqueado após o
                registro.
              </Alert>
            ) : null}
            <dl className="rounded-md border border-border bg-card px-3 py-3 text-sm">
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-muted-foreground">Tipo</dt>
                <dd className="font-mono">{kind.label}</dd>
              </div>
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-muted-foreground">Nome</dt>
                <dd className="font-mono">{name.trim() || '—'}</dd>
              </div>
              {kind.configFields
                .filter((field) => field.type !== 'file')
                .map((field) => (
                  <div key={field.key} className="flex justify-between gap-4 py-1">
                    <dt className="text-muted-foreground">{field.label}</dt>
                    <dd className="max-w-[60%] truncate font-mono">
                      {field.type === 'boolean'
                        ? config[field.key] === 'true'
                          ? 'Sim'
                          : 'Não'
                        : config[field.key]?.trim() || '—'}
                    </dd>
                  </div>
                ))}
              {kind.id === 'csv' ? (
                <div className="flex justify-between gap-4 py-1">
                  <dt className="text-muted-foreground">Arquivo</dt>
                  <dd className="max-w-[60%] truncate font-mono">{csvFile?.name ?? '—'}</dd>
                </div>
              ) : null}
              {kind.credentialFields.map((field) => (
                <div key={field.key} className="flex justify-between gap-4 py-1">
                  <dt className="text-muted-foreground">{field.label}</dt>
                  <dd className="font-mono">
                    {credentials[field.key]?.trim()
                      ? field.type === 'secret'
                        ? '••••••••'
                        : credentials[field.key]
                      : '—'}
                  </dd>
                </div>
              ))}
              {extraJson.trim() ? (
                <div className="flex justify-between gap-4 py-1">
                  <dt className="text-muted-foreground">Extra JSON</dt>
                  <dd className="font-mono">Sim</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex flex-wrap gap-2">
          {stepIndex > 0 ? (
            <Button type="button" variant="secondary" onClick={goBack} disabled={pending}>
              Voltar
            </Button>
          ) : null}
          {!isLast ? (
            <Button type="button" onClick={goNext}>
              Continuar
            </Button>
          ) : (
            <Button type="button" loading={pending} onClick={() => void onSubmit()}>
              {pending ? 'Salvando…' : 'Registrar fonte'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
