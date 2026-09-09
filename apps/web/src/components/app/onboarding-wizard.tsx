'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Field, Input, Select } from '@/components/ui/field';
import { WizardStepper, type WizardStep } from '@/components/app/wizard-stepper';
import { errorMessage, formatCurrency, formatInteger } from '@/lib/format';

// ---------------------------------------------------------------------------
// Tipos dos contratos da API já existentes
// ---------------------------------------------------------------------------

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
  { id: 'source', label: 'Fonte de dados' },
  { id: 'discover', label: 'Descoberta' },
  { id: 'mapping', label: 'Mapeamento' },
  { id: 'preview', label: 'Prévia' },
  { id: 'import', label: 'Importação' },
];

const TARGET_FIELDS = [
  { value: '', label: 'Ignorar coluna' },
  { value: 'external_id', label: 'ID externo' },
  { value: 'name', label: 'Nome' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'document', label: 'Documento' },
  { value: 'status', label: 'Status' },
  { value: 'body', label: 'Corpo da mensagem' },
  { value: 'subject', label: 'Assunto' },
  { value: 'channel', label: 'Canal' },
  { value: 'direction', label: 'Direção' },
  { value: 'occurred_at', label: 'Data da interação' },
  { value: 'customer_external_id', label: 'ID externo do cliente' },
  { value: 'customer_email', label: 'E-mail do cliente' },
  { value: 'customer_phone', label: 'Telefone do cliente' },
];

const TARGET_ENTITIES = [
  { value: 'customer', label: 'Clientes' },
  { value: 'product', label: 'Produtos' },
  { value: 'seller', label: 'Vendedores' },
  { value: 'lead', label: 'Leads' },
  { value: 'sale', label: 'Vendas' },
  { value: 'interaction', label: 'Interações' },
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

/**
 * Wizard de onboarding (spec §55): empresa → fonte → conexão → descoberta →
 * mapeamento → prévia → importação → resultado.
 *
 * O estado inicial vem do servidor, então recarregar a página retoma no passo
 * correspondente ao que já existe de verdade no banco.
 */
export function OnboardingWizard({ initial }: { initial: OnboardingState }) {
  const router = useRouter();

  const firstIncomplete = !initial.hasTenant
    ? 0
    : !initial.dataSource
      ? 1
      : initial.mappingCount === 0
        ? 2
        : initial.lastSyncJob
          ? 5
          : 4;

  const [step, setStep] = useState(firstIncomplete);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorAt, setErrorAt] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Passo 1
  const [companyName, setCompanyName] = useState('');
  // Passo 2
  const [sourceType, setSourceType] = useState<'csv' | 'postgres'>('csv');
  const [sourceName, setSourceName] = useState('Importação inicial');
  const [filePath, setFilePath] = useState('');
  const [pg, setPg] = useState({ host: 'localhost', port: '5432', database: '', username: '', password: '' });
  const [dataSource, setDataSource] = useState<DataSource | null>(initial.dataSource);
  const [connectionOk, setConnectionOk] = useState(false);
  // Passo 3
  const [resources, setResources] = useState<DiscoveryResource[]>([]);
  const [resource, setResource] = useState<string>('data');
  // Passo 4
  const [targetEntity, setTargetEntity] = useState('customer');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mappingSaved, setMappingSaved] = useState(initial.mappingCount > 0);
  // Passo 5
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  // Passo 6
  const [syncJob, setSyncJob] = useState<SyncJob | null>(initial.lastSyncJob);

  // Foco vai para o título ao trocar de passo (navegação anunciada).
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function fail(message: string, at = step) {
    setError(message);
    setErrorAt(at);
  }

  function clearError() {
    setError(null);
    setErrorAt(null);
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

  async function createSourceAndTest() {
    setPending(true);
    clearError();

    const configuration =
      sourceType === 'csv'
        ? { filePath }
        : { host: pg.host, port: Number(pg.port), database: pg.database };

    let source = dataSource;
    if (!source) {
      // Postgres precisa de credencial: ela é criada antes e referenciada por id,
      // para a senha nunca ficar no registro da fonte.
      let credentialId: string | undefined;
      if (sourceType === 'postgres') {
        const credential = await post<{ id: string }>('/api/v1/credentials', {
          provider: 'postgres',
          data: { username: pg.username, password: pg.password },
        });
        if (credential.error || !credential.data) {
          setPending(false);
          return fail(credential.error ?? 'Não foi possível guardar a credencial.');
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
        return fail(created.error ?? 'Não foi possível criar a fonte de dados.');
      }
      source = created.data;
      setDataSource(source);
    }

    const test = await post<{ success: boolean; message: string }>(
      `/api/v1/data-sources/${source.id}/test-connection`,
    );
    setPending(false);

    if (test.error) return fail(test.error);
    if (!test.data?.success) return fail(test.data?.message ?? 'Conexão falhou.');

    setConnectionOk(true);
    setStep(2);
    void discover(source.id);
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
      // Pré-mapeia colunas cujo nome já casa com um campo canônico.
      const guessed: Record<string, string> = {};
      for (const column of found[0].columns) {
        const match = TARGET_FIELDS.find((field) => field.value === column.name.toLowerCase());
        if (match) guessed[column.name] = match.value;
      }
      setMapping(guessed);
    }
  }

  async function saveMapping() {
    if (!dataSource) return;
    const fields = Object.entries(mapping)
      .filter(([, target]) => target !== '')
      .map(([source, target]) => ({ source, target }));

    if (fields.length === 0) {
      return fail('Mapeie ao menos uma coluna para um campo canônico.', 3);
    }

    setPending(true);
    clearError();
    const result = await post(`/api/v1/data-sources/${dataSource.id}/mappings`, {
      sourceEntity: resource,
      targetEntity,
      configuration: { fields },
    });
    setPending(false);
    if (result.error) return fail(result.error, 3);

    setMappingSaved(true);
    setStep(4);
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
    if (result.error) return fail(result.error, 4);
    setPreviewRows(result.data ?? []);
  }

  async function runImport() {
    if (!dataSource) return;
    setPending(true);
    clearError();
    const result = await post<SyncJob>(`/api/v1/data-sources/${dataSource.id}/sync`);
    if (result.error) {
      setPending(false);
      return fail(result.error, 5);
    }

    // O sync roda inline (Etapa 3): ao responder, o job já tem contadores.
    const jobId = result.data?.id;
    if (jobId) {
      const detail = await fetch(`/api/v1/sync-jobs/${jobId}`);
      const json = (await detail.json().catch(() => null)) as { data?: SyncJob } | null;
      setSyncJob(json?.data ?? result.data ?? null);
    }
    setPending(false);
    setStep(5);
    router.refresh();
  }

  const columns = resources.find((item) => item.name === resource)?.columns ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Configurar dados</h1>
        <WizardStepper steps={STEPS} current={step} errorAt={errorAt} />
      </header>

      {error ? <Alert tone="danger" title="Não foi possível continuar">{error}</Alert> : null}

      <Card>
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-medium outline-none">
          {STEPS[step]?.label}
        </h2>

        {/* 1. Empresa ---------------------------------------------------- */}
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
                Criar empresa
              </Button>
            </div>
          )
        ) : null}

        {/* 2. Fonte de dados -------------------------------------------- */}
        {step === 1 ? (
          <div className="mt-4 flex max-w-xl flex-col gap-4">
            <Field htmlFor="source-type" label="Tipo de fonte">
              <Select
                id="source-type"
                value={sourceType}
                onChange={(event) => setSourceType(event.target.value as 'csv' | 'postgres')}
              >
                <option value="csv">Arquivo CSV</option>
                <option value="postgres">PostgreSQL</option>
              </Select>
            </Field>

            <Field htmlFor="source-name" label="Nome da fonte">
              <Input
                id="source-name"
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
              />
            </Field>

            {sourceType === 'csv' ? (
              <Field
                htmlFor="file-path"
                label="Caminho do arquivo no servidor"
                hint="Ex.: /dados/clientes.csv — upload direto entra em uma etapa futura."
              >
                <Input
                  id="file-path"
                  value={filePath}
                  onChange={(event) => setFilePath(event.target.value)}
                  placeholder="/caminho/para/arquivo.csv"
                />
              </Field>
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
                    onChange={(event) => setPg({ ...pg, database: event.target.value })}
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
                  hint="Guardada criptografada (AES-256-GCM) e usada apenas no momento do sync."
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

            <div className="flex items-center gap-3">
              <Button loading={pending} onClick={() => void createSourceAndTest()}>
                Testar conexão
              </Button>
              {connectionOk ? <Badge tone="success">Conexão ok</Badge> : null}
            </div>
          </div>
        ) : null}

        {/* 3. Descoberta ------------------------------------------------ */}
        {step === 2 ? (
          <div className="mt-4 flex flex-col gap-4">
            {resources.length === 0 ? (
              <>
                <CardDescription>
                  {pending ? 'Descobrindo recursos e colunas…' : 'Nenhum recurso encontrado na fonte.'}
                </CardDescription>
                <Button
                  className="self-start"
                  variant="secondary"
                  loading={pending}
                  onClick={() => void discover()}
                >
                  Descobrir novamente
                </Button>
              </>
            ) : (
              <>
                <Field htmlFor="resource" label="Recurso">
                  <Select
                    id="resource"
                    value={resource}
                    onChange={(event) => setResource(event.target.value)}
                  >
                    {resources.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name} ({item.columns.length} colunas)
                      </option>
                    ))}
                  </Select>
                </Field>

                <DataTable
                  caption={`Colunas detectadas em ${resource}`}
                  columns={[
                    { key: 'name', header: 'Coluna', render: (row: DiscoveryColumn) => row.name },
                    { key: 'type', header: 'Tipo', render: (row: DiscoveryColumn) => row.type },
                    {
                      key: 'nullable',
                      header: 'Aceita vazio',
                      render: (row: DiscoveryColumn) => (row.nullable ? 'sim' : 'não'),
                    },
                  ]}
                  rows={columns}
                  rowKey={(row) => row.name}
                />

                <Button className="self-start" onClick={() => setStep(3)}>
                  Configurar mapeamento
                </Button>
              </>
            )}
          </div>
        ) : null}

        {/* 4. Mapeamento ------------------------------------------------ */}
        {step === 3 ? (
          <div className="mt-4 flex flex-col gap-4">
            <Field htmlFor="target-entity" label="Estes dados representam">
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

            <ul className="flex flex-col gap-3">
              {columns.map((column) => (
                <li key={column.name} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2">
                  <span className="text-sm">
                    {column.name} <span className="text-xs text-muted">({column.type})</span>
                  </span>
                  <Select
                    aria-label={`Destino da coluna ${column.name}`}
                    value={mapping[column.name] ?? ''}
                    onChange={(event) =>
                      setMapping({ ...mapping, [column.name]: event.target.value })
                    }
                  >
                    {TARGET_FIELDS.map((field) => (
                      <option key={field.value} value={field.value}>
                        {field.label}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>

            {columns.length === 0 ? (
              <CardDescription>
                Nenhuma coluna detectada — volte ao passo de descoberta.
              </CardDescription>
            ) : null}

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep(2)}>
                Voltar
              </Button>
              <Button loading={pending} onClick={() => void saveMapping()}>
                Salvar mapeamento
              </Button>
            </div>
          </div>
        ) : null}

        {/* 5. Prévia ---------------------------------------------------- */}
        {step === 4 ? (
          <div className="mt-4 flex flex-col gap-4">
            {mappingSaved ? <Badge tone="success">Mapeamento salvo</Badge> : null}

            {previewRows.length === 0 ? (
              <CardDescription>
                {pending ? 'Carregando prévia…' : 'Sem linhas para pré-visualizar.'}
              </CardDescription>
            ) : (
              <DataTable
                caption={`Primeiras ${previewRows.length} linhas de ${resource}`}
                columns={Object.keys(previewRows[0] ?? {}).map((key) => ({
                  key,
                  header: key,
                  render: (row: Record<string, unknown>) => String(row[key] ?? '—'),
                }))}
                rows={previewRows}
                rowKey={(row) => JSON.stringify(row).slice(0, 64)}
              />
            )}

            <div className="flex gap-2">
              <Button variant="secondary" loading={pending} onClick={() => void loadPreview()}>
                Recarregar prévia
              </Button>
              <Button loading={pending} onClick={() => void runImport()}>
                Importar dados
              </Button>
            </div>
          </div>
        ) : null}

        {/* 6. Resultado ------------------------------------------------- */}
        {step === 5 ? (
          <div className="mt-4 flex flex-col gap-4">
            {pending ? (
              <p aria-live="polite" className="text-sm text-muted">
                Importando… isso pode levar alguns instantes.
              </p>
            ) : null}

            {syncJob ? (
              <>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Importação</CardTitle>
                  <Badge tone={syncJob.status === 'completed' ? 'success' : syncJob.status === 'failed' ? 'danger' : 'info'}>
                    {syncJob.status === 'completed'
                      ? 'Concluída'
                      : syncJob.status === 'failed'
                        ? 'Falhou'
                        : 'Em andamento'}
                  </Badge>
                </div>

                {syncJob.error ? <Alert tone="danger">{syncJob.error}</Alert> : null}

                <ul aria-live="polite" className="flex flex-col gap-1 text-sm">
                  <li>✓ {formatInteger(initial.summary.customers)} clientes na base</li>
                  <li>✓ {formatInteger(initial.summary.sales)} vendas na base</li>
                  <li>✓ {formatInteger(initial.summary.sellers)} vendedores encontrados</li>
                  <li>✓ {formatInteger(initial.summary.products)} produtos cadastrados</li>
                  <li>✓ {formatCurrency(initial.summary.revenue)} em vendas analisadas</li>
                </ul>

                <p className="text-xs text-muted tabular">
                  Registros lidos {formatInteger(syncJob.recordsRead)} · criados{' '}
                  {formatInteger(syncJob.recordsCreated)} · atualizados{' '}
                  {formatInteger(syncJob.recordsUpdated)} · falhas{' '}
                  {formatInteger(syncJob.recordsFailed)}
                </p>

                <div className="flex gap-2">
                  <Button onClick={() => router.push('/dashboard')}>Ver dashboard</Button>
                  <Button variant="secondary" loading={pending} onClick={() => void runImport()}>
                    Importar novamente
                  </Button>
                </div>
              </>
            ) : (
              <CardDescription>Nenhuma importação executada ainda.</CardDescription>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
