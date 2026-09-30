import {
  createFigraniumExecutorFromResolved,
  type BrowserExecutor,
  type ResolvedFigraniumInstance,
} from '@tactia/connectors';

export type WorkflowArtifact = {
  name: string;
  mime: string;
  body: Buffer;
};

export type PublishedWorkflowRun = {
  status: 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'needs_attention';
  retryable: boolean;
  message?: string;
  externalExecutionId?: string;
  files: WorkflowArtifact[];
};

/**
 * Executa um workflow publicado no Figranium e baixa os artefatos do gabinete.
 * Não inventa arquivos quando o executor não os devolve.
 */
export async function executePublishedFigraniumWorkflow(
  resolved: ResolvedFigraniumInstance,
  request: {
    executionKey: string;
    connectionId: string;
    sessionScope: string;
    workflowKey: string;
    workflowVersion: string;
    parameters: Record<string, unknown>;
    credentialRefs?: string[];
    deadlineAt: string;
    signal?: AbortSignal;
  },
  credentials: { resolve(connectionId: string, refs: string[]): Promise<Record<string, unknown>> } = {
    resolve: async () => ({}),
  },
): Promise<PublishedWorkflowRun> {
  const executor: BrowserExecutor = createFigraniumExecutorFromResolved(resolved, credentials);
  if (request.signal?.aborted) {
    return { status: 'cancelled', retryable: false, files: [], message: 'Execução cancelada.' };
  }
  try {
    const result = await executor.execute({
      executionKey: request.executionKey,
      connectionId: request.connectionId,
      sessionScope: request.sessionScope,
      workflowKey: request.workflowKey,
      workflowVersion: request.workflowVersion,
      parameters: request.parameters,
      credentialRefs: request.credentialRefs ?? [],
      deadlineAt: request.deadlineAt,
    });
    const files: WorkflowArtifact[] = [];
    for (const ref of result.artifactRefs) {
      const artifact = await executor.fetchArtifact(ref);
      files.push({ name: artifact.fileName, mime: artifact.contentType, body: artifact.body });
    }
    if (result.status === 'succeeded' && files.length === 0) {
      return {
        status: 'partial',
        retryable: false,
        message: 'O navegador concluiu sem entregar os arquivos.',
        ...(result.externalExecutionId ? { externalExecutionId: result.externalExecutionId } : {}),
        files,
      };
    }
    return {
      status:
        result.status === 'succeeded'
          ? 'succeeded'
          : result.status === 'cancelled'
            ? 'cancelled'
            : result.status === 'needs_attention'
              ? 'needs_attention'
              : 'failed',
      retryable: result.status === 'failed',
      ...(result.safeMessage ? { message: result.safeMessage } : {}),
      ...(result.externalExecutionId ? { externalExecutionId: result.externalExecutionId } : {}),
      files,
    };
  } catch (error) {
    const retryable = Boolean(error && typeof error === 'object' && 'retryable' in error && (error as { retryable?: boolean }).retryable);
    const message = error instanceof Error ? error.message : 'Falha no executor de navegador.';
    return { status: 'failed', retryable, message, files: [] };
  }
}
