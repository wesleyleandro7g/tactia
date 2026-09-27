export type BrowserExecutionStatus =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'needs_attention';

export type BrowserExecutionRequest = {
  executionKey: string;
  connectionId: string;
  sessionScope: string;
  workflowKey: string;
  workflowVersion: string;
  parameters: Record<string, unknown>;
  credentialRefs: string[];
  deadlineAt: string;
};

export type BrowserArtifactRef = {
  ref: string;
  fileName?: string;
  mimeType?: string;
};

export type BrowserExecutionResult = {
  status: BrowserExecutionStatus;
  externalExecutionId?: string;
  artifactRefs: BrowserArtifactRef[];
  extractedDataRef?: string;
  data?: unknown;
  errorCode?: string;
  safeMessage?: string;
  startedAt: string;
  finishedAt: string;
};

export type BrowserArtifact = {
  body: Buffer;
  contentType: string;
  fileName: string;
};

export interface BrowserCredentialResolver {
  resolve(connectionId: string, credentialRefs: string[]): Promise<Record<string, unknown>>;
}

export interface BrowserExecutor {
  readonly engine: string;
  readonly instanceKey: string;
  health(): Promise<{ healthy: boolean; safeMessage: string }>;
  execute(request: BrowserExecutionRequest): Promise<BrowserExecutionResult>;
  fetchArtifact(ref: BrowserArtifactRef): Promise<BrowserArtifact>;
  cancel?(externalExecutionId: string): Promise<boolean>;
}

export class BrowserExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: BrowserExecutionStatus = 'failed',
  ) {
    super(message);
    this.name = 'BrowserExecutionError';
  }
}
