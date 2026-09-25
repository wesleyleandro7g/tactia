import {
  BrowserExecutionError,
  type BrowserArtifact,
  type BrowserArtifactRef,
  type BrowserCredentialResolver,
  type BrowserExecutionRequest,
  type BrowserExecutionResult,
  type BrowserExecutor,
} from '../../contracts';

export const FIGRANIUM_VERSION = '0.18.4';
export const FIGRANIUM_COMMIT = 'efdd123c5d1bd49cfbae4c56c0e7f01eb9c71d36';
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const CABINET_REF = /^\/api\/cabinets\/([a-zA-Z0-9_-]+)\/items\/([a-zA-Z0-9_-]+)\/download$/;

export type FigraniumWorkflowBinding = {
  workflowKey: string;
  workflowVersion: string;
  taskId: string;
};

export type FigraniumBrowserExecutorConfig = {
  instanceKey: string;
  baseUrl: string;
  apiKey: string;
  dedicatedConnectionId: string;
  workflows: FigraniumWorkflowBinding[];
  allowInsecureHttp?: boolean;
};

type FigraniumOutcome = 'success' | 'error' | 'stopped' | 'crashed' | 'anti_bot';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function validateFigraniumBaseUrl(raw: string, allowInsecureHttp = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BrowserExecutionError('FIGRANIUM_CONFIG_INVALID', 'URL do executor inválida.', false);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (local || allowInsecureHttp))) {
    throw new BrowserExecutionError(
      'FIGRANIUM_CONFIG_INVALID',
      'O executor exige HTTPS fora da rede local.',
      false,
    );
  }
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) {
    throw new BrowserExecutionError('FIGRANIUM_CONFIG_INVALID', 'Origem do executor inválida.', false);
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

function outcomeOf(value: unknown): FigraniumOutcome | null {
  return value === 'success' || value === 'error' || value === 'stopped' || value === 'crashed' || value === 'anti_bot'
    ? value
    : null;
}

function normalizedFailure(outcome: Exclude<FigraniumOutcome, 'success'>): Pick<BrowserExecutionResult, 'status' | 'errorCode' | 'safeMessage'> {
  if (outcome === 'anti_bot') {
    return {
      status: 'needs_attention',
      errorCode: 'FIGRANIUM_ANTI_BOT',
      safeMessage: 'A origem solicitou verificação interativa.',
    };
  }
  if (outcome === 'stopped') {
    return {
      status: 'cancelled',
      errorCode: 'FIGRANIUM_STOPPED',
      safeMessage: 'A execução remota foi interrompida.',
    };
  }
  return {
    status: 'failed',
    errorCode: outcome === 'crashed' ? 'FIGRANIUM_CRASHED' : 'FIGRANIUM_TASK_ERROR',
    safeMessage: outcome === 'crashed' ? 'O navegador não concluiu a coleta.' : 'O fluxo encerrou com erro funcional.',
  };
}

function artifactRefs(payload: Record<string, unknown>): BrowserArtifactRef[] {
  if (!Array.isArray(payload['downloads'])) return [];
  const refs: BrowserArtifactRef[] = [];
  for (const item of payload['downloads']) {
    const row = record(item);
    const ref = typeof row?.['path'] === 'string' ? row['path'] : null;
    if (!ref || !CABINET_REF.test(ref)) continue;
    refs.push({
      ref,
      ...(typeof row?.['name'] === 'string' ? { fileName: row['name'] } : {}),
    });
  }
  return refs;
}

export class FigraniumBrowserExecutor implements BrowserExecutor {
  readonly engine = 'figranium';
  readonly instanceKey: string;
  private readonly baseUrl: URL;
  private readonly bindings = new Map<string, string>();

  constructor(
    private readonly config: FigraniumBrowserExecutorConfig,
    private readonly credentials: BrowserCredentialResolver,
  ) {
    this.instanceKey = config.instanceKey;
    this.baseUrl = validateFigraniumBaseUrl(config.baseUrl, config.allowInsecureHttp);
    if (!config.apiKey.trim() || !config.dedicatedConnectionId.trim()) {
      throw new BrowserExecutionError(
        'FIGRANIUM_CONFIG_INVALID',
        'Executor sem autenticação ou conexão dedicada.',
        false,
      );
    }
    for (const binding of config.workflows) {
      this.bindings.set(`${binding.workflowKey}@${binding.workflowVersion}`, binding.taskId);
    }
  }

  async health(): Promise<{ healthy: boolean; safeMessage: string }> {
    try {
      const response = await fetch(new URL('/api/health', this.baseUrl), {
        headers: { 'x-api-key': this.config.apiKey },
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok
        ? { healthy: true, safeMessage: 'Executor disponível.' }
        : { healthy: false, safeMessage: 'Executor indisponível.' };
    } catch {
      return { healthy: false, safeMessage: 'Executor indisponível.' };
    }
  }

  async execute(request: BrowserExecutionRequest): Promise<BrowserExecutionResult> {
    const startedAt = new Date().toISOString();
    if (request.connectionId !== this.config.dedicatedConnectionId) {
      throw new BrowserExecutionError(
        'FIGRANIUM_SESSION_NOT_ISOLATED',
        'A instância do navegador não é dedicada a esta conexão.',
        false,
        'needs_attention',
      );
    }
    const taskId = this.bindings.get(`${request.workflowKey}@${request.workflowVersion}`);
    if (!taskId) {
      throw new BrowserExecutionError(
        'FIGRANIUM_WORKFLOW_NOT_BOUND',
        'Fluxo não publicado neste ambiente.',
        false,
        'needs_attention',
      );
    }
    const deadline = Date.parse(request.deadlineAt);
    const timeout = deadline - Date.now();
    if (!Number.isFinite(deadline) || timeout <= 0) {
      throw new BrowserExecutionError('BROWSER_DEADLINE_EXCEEDED', 'Prazo da coleta expirado.', true);
    }

    const resolved = await this.credentials.resolve(request.connectionId, request.credentialRefs);
    let response: Response;
    try {
      response = await fetch(new URL(`/api/tasks/${encodeURIComponent(taskId)}/api`, this.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
        },
        body: JSON.stringify({
          variables: { ...request.parameters, ...resolved },
          runId: request.executionKey,
          sessionId: request.sessionScope,
          disableRecording: true,
          statelessExecution: false,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(Math.min(timeout, 2_147_000_000)),
      });
    } catch (error) {
      const timeoutError = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new BrowserExecutionError(
        timeoutError ? 'FIGRANIUM_TIMEOUT' : 'FIGRANIUM_UNAVAILABLE',
        timeoutError ? 'O executor excedeu o prazo.' : 'Não foi possível acessar o executor.',
        true,
      );
    }

    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      throw new BrowserExecutionError(
        response.status === 401 || response.status === 403 ? 'FIGRANIUM_AUTH_FAILED' : 'FIGRANIUM_HTTP_ERROR',
        response.status === 401 || response.status === 403 ? 'Autenticação do executor recusada.' : 'Executor retornou erro de transporte.',
        retryable,
        response.status === 401 || response.status === 403 ? 'needs_attention' : 'failed',
      );
    }

    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > MAX_RESPONSE_BYTES) {
      throw new BrowserExecutionError('FIGRANIUM_RESPONSE_TOO_LARGE', 'Resposta excede o limite; use artefato.', false);
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new BrowserExecutionError('FIGRANIUM_RESPONSE_TOO_LARGE', 'Resposta excede o limite; use artefato.', false);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new BrowserExecutionError('FIGRANIUM_INVALID_RESPONSE', 'Executor retornou resposta inválida.', false);
    }
    const payload = record(parsed);
    const outcome = outcomeOf(payload?.['outcome']);
    if (!payload || !outcome) {
      throw new BrowserExecutionError('FIGRANIUM_INVALID_RESPONSE', 'Executor não informou o resultado funcional.', false);
    }

    const common = {
      externalExecutionId: request.executionKey,
      artifactRefs: artifactRefs(payload),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    if (outcome !== 'success') return { ...common, ...normalizedFailure(outcome) };
    return { ...common, status: 'succeeded', data: payload['data'] };
  }

  async fetchArtifact(ref: BrowserArtifactRef): Promise<BrowserArtifact> {
    if (!CABINET_REF.test(ref.ref)) {
      throw new BrowserExecutionError('FIGRANIUM_ARTIFACT_REF_INVALID', 'Referência de artefato inválida.', false);
    }
    const response = await fetch(new URL(ref.ref, this.baseUrl), {
      headers: { 'x-api-key': this.config.apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new BrowserExecutionError('FIGRANIUM_ARTIFACT_UNAVAILABLE', 'Artefato remoto indisponível.', response.status >= 500);
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) {
      throw new BrowserExecutionError('FIGRANIUM_ARTIFACT_EMPTY', 'Artefato remoto vazio.', false);
    }
    return {
      body,
      contentType: response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream',
      fileName: ref.fileName || 'artifact.bin',
    };
  }

  async cancel(externalExecutionId: string): Promise<boolean> {
    const response = await fetch(new URL('/api/executions/stop', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.config.apiKey },
      body: JSON.stringify({ runId: externalExecutionId }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  }
}
