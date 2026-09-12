'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Field, Input, Select } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/feedback';
import { FileDropzone } from '@/components/app/file-dropzone';
import { WizardStepper, type WizardStep } from '@/components/app/wizard-stepper';
import { errorMessage, formatCurrency, formatInteger } from '@/lib/format';
import {
  TARGET_ENTITIES,
  guessMapping,
  sourceNameFromFile,
  targetFieldsFor,
} from '@/lib/import-mapping';

type ApiError = { error?: { code?: string; message?: string } };

type DataSource = { id: string; name: string; type: string };

type DiscoveryColumn = { name: string; type: string; nullable: boolean };
type DiscoveryResource = { name: string; columns: DiscoveryColumn[] };

type SyncJob = {
  id: string;
  status: string;
  recordsRead: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  error?: string | null;
};

type ImportSummary = {
  customers: number;
  sales: number;
  sellers: number;
  products: number;
  revenue: number;
};

export type OnboardingState = {
  hasTenant: boolean;
  tenantName: string | null;
  dataSource: DataSource | null;
  mappingCount: number;
  lastSyncJob: SyncJob | null;
  summary: ImportSummary;
};

const STEPS: WizardStep[] = [
  { id: 'company', label: 'Empresa' },
  { id: 'source', label: 'Arquivo' },
  { id: 'mapping', label: 'Colunas' },
  { id: 'import', label: 'Importar' },
];

async function post<T>(url: string, body?: unknown): Promise<{ data?: T; error?: string }> {
  const response = await fetch(url, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const json = (await response.json().catch(() => null)) as ({ data: T } & ApiError) | null;
  if (!response.ok) {
    return { error: json?.error?.message ?? errorMessage(json?.error?.code) };
  }
  return { data: json?.data };
}

async function postForm<T>(url: string, file: File): Promise<{ data?: T; error?: string }> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(url, { method: 'POST', body });
  const json = (await response.json().catch(() => null)) as ({ data: T } & ApiError) | null;
  if (!response.ok) {
    return { error: json?.error?.message ?? errorMessage(json?.error?.code) };
  }
  return { data: json?.data };
}

function firstIncompleteStep(initial: OnboardingState): number {
  if (!initial.hasTenant) return 0;
  if (!initial.dataSource) return 1;
  if (initial.mappingCount === 0) return 2;
  return 3;
}

/**
 * Wizard de importação: empresa → arquivo → colunas → conferir/resultado.
 * Descoberta e teste de conexão rodam automaticamente após o arquivo.
 */
export function OnboardingWizard({ initial }: { initial: OnboardingState }) {
  const router = useRouter();

  const [step, setStep] = useState(() => firstIncompleteStep(initial));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorAt, setErrorAt] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [companyName, setCompanyName] = useState('');
  const [sourceType, setSourceType] = useState<'csv' | 'postgres'>('csv');
  const [sourceName, setSourceName] = useState('Importação inicial');
  const [filePath, setFilePath] = useState('');
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sourceDirty, setSourceDirty] = useState(false);
  const [pg, setPg] = useState({
    host: 'localhost',
    port: '5432',
    database: '',
    username: '',
    password: '',
  });
  const [dataSource, setDataSource] = useState<DataSource | null>(initial.dataSource);

  const [resources, setResources] = useState<DiscoveryResource[]>([]);
  const [resource, setResource] = useState<string>('data');
  const [targetEntity, setTargetEntity] = useState('customer');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mappingSaved, setMappingSaved] = useState(initial.mappingCount > 0);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [syncJob, setSyncJob] = useState<SyncJob | null>(initial.lastSyncJob);

  const visibleSteps = initial.hasTenant ? STEPS.slice(1) : STEPS;
  const stepperCurrent = initial.hasTenant ? step - 1 : step;
  const stepperErrorAt =
    errorAt == null ? null : initial.hasTenant ? errorAt - 1 : errorAt;

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step === 2 && dataSource && resources.length === 0) {
      void discover(dataSource.id);
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps -- só ao entrar no passo

  useEffect(() => {
    if (step === 3 && dataSource && !syncJob && previewRows.length === 0) {
      void loadPreview();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  function fail(message: string, at = step) {
    setError(message);
    setErrorAt(at);
  }

  function clearError() {
    setError(null);
    setErrorAt(null);
  }

  function applyGuessedMapping(columns: DiscoveryColumn[], entity = targetEntity) {
    setMapping(guessMapping(columns, entity));
  }

  async function createCompany() {
    setPending(true);
    clearError();
    const result = await post<{ id: string; name: string }>('/api/v1/tenants', { name: companyName });
    setPending(false);
    if (result.error) return fail(result.error);
    router.refresh();
    setStep(1);
  }

  async function handleCsvFile(file: File) {
    setUploading(true);
    setUploadError(null);
    clearError();
    const result = await postForm<{ filePath: string; fileName: string; size: number }>(
      '/api/v1/uploads',
      file,
    );
    setUploading(false);
    if (result.error || !result.data) {
      setUploadError(result.error ?? 'Não foi possível enviar o arquivo.');
      return;
    }
    setFilePath(result.data.filePath);
    setUploadedFile({ name: result.data.fileName, size: result.data.size });
    setSourceDirty(true);
    if (sourceName === 'Importação inicial' || sourceName.trim().length === 0) {
      setSourceName(sourceNameFromFile(result.data.fileName));
    }
  }

  function clearCsvFile() {
    setFilePath('');
    setUploadedFile(null);
    setUploadError(null);
    setSourceDirty(true);
  }

  function startAnotherImport() {
    setDataSource(null);
    setFilePath('');
    setUploadedFile(null);
    setUploadError(null);
    setSourceDirty(false);
    setSourceName('Importação inicial');
    setSourceType('csv');
    setResources([]);
    setResource('data');
    setMapping({});
    setMappingSaved(false);
    setPreviewRows([]);
    setSyncJob(null);
    setTargetEntity('customer');
    clearError();
    setStep(1);
  }

  async function createSourceAndContinue() {
    setPending(true);
    clearError();

    const configuration =
      sourceType === 'csv'
        ? { filePath }
        : { host: pg.host, port: Number(pg.port), database: pg.database };

    if (sourceType === 'csv' && filePath.trim().length === 0) {
      setPending(false);
      return fail('Escolha um arquivo CSV ou informe o caminho no servidor.', 1);
    }

    let source = dataSource;
    if (!source || sourceDirty) {
      let credentialId: string | undefined;
      if (sourceType === 'postgres') {
        const credential = await post<{ id: string }>('/api/v1/credentials', {
          provider: 'postgres',
          data: { username: pg.username, password: pg.password },
        });
        if (credential.error || !credential.data) {
          setPending(false);
          return fail(credential.error ?? 'Não foi possível guardar a credencial.', 1);
        }
        credentialId = credential.data.id;
      }

      const created = await post<DataSource>('/api/v1/data-sources', {
        name: sourceName,
        type: sourceType,
        configuration,
        ...(credentialId ? { credentialId } : {}),
      });
      if (created.error || !created.data) {
        setPending(false);
        return fail(created.error ?? 'Não foi possível criar a fonte de dados.', 1);
      }
      source = created.data;
      setDataSource(source);
      setSourceDirty(false);
    }

    const test = await post<{ success: boolean; message: string }>(
      `/api/v1/data-sources/${source.id}/test-connection`,
    );
    if (test.error) {
      setPending(false);
      return fail(test.error, 1);
    }
    if (!test.data?.success) {
      setPending(false);
      return fail(test.data?.message ?? 'Não foi possível ler a fonte.', 1);
    }

    await discover(source.id);
    setPending(false);
    setStep(2);
  }

  async function discover(sourceId?: string) {
    const id = sourceId ?? dataSource?.id;
    if (!id) return;
    setPending(true);
    clearError();
    const result = await post<{ resources: DiscoveryResource[] }>(
      `/api/v1/data-sources/${id}/discover`,
    );
    setPending(false);
    if (result.error) return fail(result.error, 2);

    const found = result.data?.resources ?? [];
    setResources(found);
    if (found[0]) {
      setResource(found[0].name);
      applyGuessedMapping(found[0].columns);
    }
  }

  function changeEntity(entity: string) {
    setTargetEntity(entity);
    const columns = resources.find((item) => item.name === resource)?.columns ?? [];
    applyGuessedMapping(columns, entity);
  }

  async function saveMapping() {
    if (!dataSource) return;
    const fields = Object.entries(mapping)
      .filter(([, target]) => target !== '')
      .map(([source, target]) => ({ source, target }));

    if (fields.length === 0) {
      return fail('Diga o destino de pelo menos uma coluna.', 2);
    }

    setPending(true);
    clearError();
    const result = await post(`/api/v1/data-sources/${dataSource.id}/mappings`, {
      sourceEntity: resource,
      targetEntity,
      configuration: { fields },
    });
    setPending(false);
    if (result.error) return fail(result.error, 2);

    setMappingSaved(true);
    setStep(3);
    void loadPreview();
  }

  async function loadPreview() {
    if (!dataSource) return;
    setPending(true);
    clearError();
    const result = await post<Record<string, unknown>[]>(
      `/api/v1/data-sources/${dataSource.id}/preview`,
      { resource, limit: 10 },
    );
    setPending(false);
    if (result.error) return fail(result.error, 3);
    setPreviewRows(result.data ?? []);
  }

  async function runImport() {
    if (!dataSource) return;
    setPending(true);
    clearError();
    const result = await post<SyncJob>(`/api/v1/data-sources/${dataSource.id}/sync`);
    if (result.error) {
      setPending(false);
      return fail(result.error, 3);
    }

    const jobId = result.data?.id;
    if (jobId) {
      const detail = await fetch(`/api/v1/sync-jobs/${jobId}`);
      const json = (await detail.json().catch(() => null)) as { data?: SyncJob } | null;
      setSyncJob(json?.data ?? result.data ?? null);
    } else {
      setSyncJob(result.data ?? null);
    }
    setPending(false);
    setStep(3);
    router.refresh();
  }

  const columns = resources.find((item) => item.name === resource)?.columns ?? [];
  const mappingFields = targetFieldsFor(targetEntity);
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const showResult = syncJob !== null && !pending;
  const canContinueCsv = filePath.trim().length > 0;
  const canContinuePg = pg.database.trim().length > 0 && pg.username.trim().length > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Dados</p>
          <h1 className="text-2xl font-semibold tracking-tight">Trazer seus dados</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Importe um arquivo por vez. Ordem recomendada: clientes, produtos, vendedores e, por
            último, vendas.
          </p>
        </div>
        <WizardStepper steps={visibleSteps} current={Math.max(stepperCurrent, 0)} errorAt={stepperErrorAt} />
      </header>

      {error ? (
        <Alert tone="danger" title="Não foi possível continuar">
          {error}
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-medium outline-none">
          {STEPS[step]?.label}
        </h2>

        {step === 0 ? (
          initial.hasTenant ? (
            <div className="mt-4 flex flex-col gap-3">
              <CardDescription>
                Empresa ativa: <strong className="text-fg">{initial.tenantName}</strong>
              </CardDescription>
              <Button className="self-start" onClick={() => setStep(1)}>
                Continuar
              </Button>
            </div>
          ) : (
            <div className="mt-4 flex max-w-md flex-col gap-4">
              <Field htmlFor="company" label="Nome da empresa" hint="Aparece no topo do app.">
                <Input
                  id="company"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  autoComplete="organization"
                  required
                />
              </Field>
              <Button
                className="self-start"
                loading={pending}
                disabled={companyName.trim().length === 0}
                onClick={() => void createCompany()}
              >
                Continuar
              </Button>
            </div>
          )
        ) : null}

        {step === 1 ? (
          <div className="mt-4 flex max-w-2xl flex-col gap-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  { id: 'csv', title: 'Arquivo CSV', hint: 'Planilha exportada do seu sistema' },
                  { id: 'postgres', title: 'PostgreSQL', hint: 'Banco de leitura da empresa' },
                ] as const
              ).map((option) => {
                const selected = sourceType === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSourceType(option.id)}
                    className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                      selected
                        ? 'border-accent/50 bg-accent-soft'
                        : 'border-border bg-bg hover:border-muted hover:bg-card-hover'
                    }`}
                  >
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{option.hint}</span>
                  </button>
                );
              })}
            </div>

            {sourceType === 'csv' ? (
              <>
                <FileDropzone
                  loading={uploading}
                  fileName={uploadedFile?.name ?? (filePath ? filePath.split('/').pop() : null)}
                  fileSize={uploadedFile?.size}
                  error={uploadError}
                  onFile={(file) => void handleCsvFile(file)}
                  onClear={clearCsvFile}
                />

                <details
                  className="rounded-lg border border-border bg-bg px-3 py-2"
                  open={advancedOpen}
                  onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
                >
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    Opção avançada: caminho no servidor
                  </summary>
                  <div className="mt-3">
                    <Field
                      htmlFor="file-path"
                      label="Caminho do arquivo no servidor"
                      hint="Para operadores que já copiaram o CSV para o host."
                    >
                      <Input
                        id="file-path"
                        value={filePath}
                        onChange={(event) => {
                          setFilePath(event.target.value);
                          setUploadedFile(
                            event.target.value
                              ? { name: event.target.value.split('/').pop() ?? event.target.value, size: 0 }
                              : null,
                          );
                          setSourceDirty(true);
                        }}
                        placeholder="/data/uploads/clientes.csv"
                      />
                    </Field>
                  </div>
                </details>
              </>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field htmlFor="pg-host" label="Host">
                  <Input
                    id="pg-host"
                    value={pg.host}
                    onChange={(event) => setPg({ ...pg, host: event.target.value })}
                  />
                </Field>
                <Field htmlFor="pg-port" label="Porta">
                  <Input
                    id="pg-port"
                    inputMode="numeric"
                    value={pg.port}
                    onChange={(event) => setPg({ ...pg, port: event.target.value })}
                  />
                </Field>
                <Field htmlFor="pg-db" label="Banco">
                  <Input
                    id="pg-db"
                    value={pg.database}
                    onChange={(event) => {
                      setPg({ ...pg, database: event.target.value });
                      setSourceDirty(true);
                    }}
                  />
                </Field>
                <Field htmlFor="pg-user" label="Usuário">
                  <Input
                    id="pg-user"
                    value={pg.username}
                    onChange={(event) => setPg({ ...pg, username: event.target.value })}
                  />
                </Field>
                <Field
                  htmlFor="pg-pass"
                  label="Senha"
                  hint="Guardada criptografada e usada só na leitura."
                  className="sm:col-span-2"
                >
                  <Input
                    id="pg-pass"
                    type="password"
                    value={pg.password}
                    onChange={(event) => setPg({ ...pg, password: event.target.value })}
                  />
                </Field>
              </div>
            )}

            <Field htmlFor="target-entity" label="Este arquivo é de">
              <Select
                id="target-entity"
                value={targetEntity}
                onChange={(event) => setTargetEntity(event.target.value)}
                className="max-w-xs"
              >
                {TARGET_ENTITIES.map((entity) => (
                  <option key={entity.value} value={entity.value}>
                    {entity.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field htmlFor="source-name" label="Nome desta importação">
              <Input
                id="source-name"
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
              />
            </Field>

            <Button
              className="self-start"
              loading={pending || uploading}
              disabled={sourceType === 'csv' ? !canContinueCsv : !canContinuePg}
              onClick={() => void createSourceAndContinue()}
            >
              Continuar
            </Button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-4 flex flex-col gap-4">
            {pending && columns.length === 0 ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-2/3" />
                <span className="sr-only">Lendo as colunas do arquivo…</span>
              </div>
            ) : columns.length === 0 ? (
              <>
                <CardDescription>
                  Não encontramos colunas neste arquivo. Confira o CSV e tente de novo.
                </CardDescription>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setStep(1)}>
                    Voltar
                  </Button>
                  <Button variant="secondary" loading={pending} onClick={() => void discover()}>
                    Tentar de novo
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-4">
                  <Field htmlFor="map-entity" label="Este arquivo é de" className="min-w-48">
                    <Select
                      id="map-entity"
                      value={targetEntity}
                      onChange={(event) => changeEntity(event.target.value)}
                    >
                      {TARGET_ENTITIES.map((entity) => (
                        <option key={entity.value} value={entity.value}>
                          {entity.label}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {resources.length > 1 ? (
                    <Field htmlFor="resource" label="Tabela" className="min-w-48">
                      <Select
                        id="resource"
                        value={resource}
                        onChange={(event) => {
                          const next = event.target.value;
                          setResource(next);
                          const nextColumns =
                            resources.find((item) => item.name === next)?.columns ?? [];
                          applyGuessedMapping(nextColumns);
                        }}
                      >
                        {resources.map((item) => (
                          <option key={item.name} value={item.name}>
                            {item.name} ({item.columns.length} colunas)
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}

                  <p className="text-xs text-muted-foreground">{mappedCount} de {columns.length} colunas ligadas</p>
                </div>

                <ul className="flex flex-col gap-2">
                  {columns.map((column) => (
                    <li
                      key={column.name}
                      className="grid grid-cols-1 items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 sm:grid-cols-[1fr_1fr]"
                    >
                      <span className="text-sm">
                        {column.name}{' '}
                        <span className="text-xs text-muted-foreground">({column.type})</span>
                      </span>
                      <Select
                        aria-label={`Destino da coluna ${column.name}`}
                        value={mapping[column.name] ?? ''}
                        onChange={(event) =>
                          setMapping({ ...mapping, [column.name]: event.target.value })
                        }
                      >
                        {mappingFields.map((field) => (
                          <option key={field.value || 'ignore'} value={field.value}>
                            {field.label}
                          </option>
                        ))}
                      </Select>
                    </li>
                  ))}
                </ul>

                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setStep(1)}>
                    Voltar
                  </Button>
                  <Button loading={pending} onClick={() => void saveMapping()}>
                    Conferir dados
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-4 flex flex-col gap-5">
            {pending && !syncJob ? (
              <div className="flex flex-col gap-3" aria-live="polite" aria-busy="true">
                <p className="text-sm text-muted-foreground">
                  {previewRows.length === 0 && !mappingSaved
                    ? 'Carregando prévia…'
                    : 'Importando… isso pode levar alguns instantes.'}
                </p>
                <div
                  role="progressbar"
                  aria-label="Progresso da importação"
                  className="h-1.5 overflow-hidden rounded-full bg-border"
                >
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
                </div>
              </div>
            ) : null}

            {showResult && syncJob ? (
              <>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Pronto</CardTitle>
                  <Badge
                    tone={
                      syncJob.status === 'completed'
                        ? 'success'
                        : syncJob.status === 'failed'
                          ? 'danger'
                          : 'info'
                    }
                  >
                    {syncJob.status === 'completed'
                      ? 'Concluída'
                      : syncJob.status === 'failed'
                        ? 'Falhou'
                        : 'Em andamento'}
                  </Badge>
                </div>

                {syncJob.error ? <Alert tone="danger">{syncJob.error}</Alert> : null}

                <ul
                  aria-live="polite"
                  className="grid grid-cols-2 gap-3 sm:grid-cols-4"
                >
                  <ResultStat label="Clientes" value={formatInteger(initial.summary.customers)} />
                  <ResultStat label="Vendas" value={formatInteger(initial.summary.sales)} />
                  <ResultStat label="Vendedores" value={formatInteger(initial.summary.sellers)} />
                  <ResultStat label="Produtos" value={formatInteger(initial.summary.products)} />
                </ul>
                <p className="text-sm text-muted-foreground">
                  {formatCurrency(initial.summary.revenue)} em vendas analisadas
                </p>

                <p className="text-xs text-muted-foreground tabular">
                  Lidos {formatInteger(syncJob.recordsRead)} · criados{' '}
                  {formatInteger(syncJob.recordsCreated)} · atualizados{' '}
                  {formatInteger(syncJob.recordsUpdated)} · falhas{' '}
                  {formatInteger(syncJob.recordsFailed)}
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => router.push('/dashboard')}>Ver dashboard</Button>
                  <Button variant="secondary" onClick={startAnotherImport}>
                    Importar outro arquivo
                  </Button>
                  <Button variant="ghost" loading={pending} onClick={() => void runImport()}>
                    Rodar de novo este arquivo
                  </Button>
                </div>
              </>
            ) : (
              <>
                {mappingSaved ? <Badge tone="success">Colunas salvas</Badge> : null}

                {pending && previewRows.length === 0 ? (
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-3/4" />
                  </div>
                ) : previewRows.length === 0 ? (
                  <CardDescription>
                    Sem linhas para pré-visualizar. Você ainda pode importar.
                  </CardDescription>
                ) : (
                  <DataTable
                    caption={`Primeiras ${previewRows.length} linhas`}
                    columns={Object.keys(previewRows[0] ?? {}).map((key) => ({
                      key,
                      header: key,
                      render: (row: Record<string, unknown>) => String(row[key] ?? '—'),
                    }))}
                    rows={previewRows}
                    rowKey={(row) => JSON.stringify(row).slice(0, 64)}
                  />
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setStep(2)}>
                    Voltar
                  </Button>
                  <Button variant="secondary" loading={pending} onClick={() => void loadPreview()}>
                    Recarregar prévia
                  </Button>
                  <Button loading={pending} onClick={() => void runImport()}>
                    Importar {previewRows.length > 0 ? `${formatInteger(previewRows.length)}+ linhas` : 'dados'}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-xl border border-border bg-bg px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-medium tabular">{value}</p>
    </li>
  );
}
