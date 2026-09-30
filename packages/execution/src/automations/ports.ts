import type { RequestContext } from '@tactia/shared';

export type BrowserExportFile = {
  name: string;
  mime: string;
  body: Buffer;
};

export type BrowserExportResult = {
  status: 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'needs_attention';
  retryable: boolean;
  message?: string;
  externalExecutionId?: string;
  files: BrowserExportFile[];
};

export interface AutomationBrowserPort {
  execute(input: {
    tenantId: string;
    runId: string;
    connectionId: string;
    workflowKey: string;
    workflowVersion: string;
    revisionId: string;
    parameters: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<BrowserExportResult>;
  cancel?(externalExecutionId: string): Promise<void>;
}

export type EffectProposal = {
  status: 'completed' | 'failed' | 'awaiting_approval' | 'in_progress' | 'needs_attention';
  actionExecutionId: string;
  approvalId: string | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
};

const IN_PROGRESS = new Set(['pending', 'approved', 'running']);

/** Mapeia a ação de e-mail. pending, approved e running ainda não são resultado. */
export function effectProposalFromAction(execution: {
  id: string;
  status: string;
  error: string | null;
  output: unknown;
  approvals?: Array<{ id: string; status: string }>;
}): EffectProposal {
  const approvalId = execution.approvals?.find((approval) => approval.status === 'pending')?.id ?? execution.approvals?.find((approval) => approval.status === 'approved')?.id ?? null;
  const error = execution.error;
  if (execution.status === 'awaiting_approval') {
    return { status: 'awaiting_approval', actionExecutionId: execution.id, approvalId, error };
  }
  if (IN_PROGRESS.has(execution.status)) {
    return { status: 'in_progress', actionExecutionId: execution.id, approvalId, error };
  }
  if (execution.status === 'completed') {
    const output = execution.output && typeof execution.output === 'object' ? (execution.output as Record<string, unknown>) : {};
    return { status: 'completed', actionExecutionId: execution.id, approvalId, output };
  }
  if (error?.includes('EMAIL_DELIVERY_UNCERTAIN')) {
    return { status: 'needs_attention', actionExecutionId: execution.id, approvalId, error };
  }
  return { status: 'failed', actionExecutionId: execution.id, approvalId, error };
}

export interface AutomationEffectPort {
  propose(input: {
    ctx: RequestContext;
    idempotencyKey: string;
    forceExecute: boolean;
    origin: 'user' | 'schedule';
    reason: string;
    email: { to: string; subject: string; body: string; artifactIds: string[] };
  }): Promise<EffectProposal>;
  lookup(tenantId: string, actionExecutionId: string): Promise<EffectProposal | null>;
  cancel?(tenantId: string, actionExecutionId: string): Promise<void>;
}

export interface AutomationArtifactStorage {
  put(input: { tenantId: string; id: string; body: Buffer; contentType: string }): Promise<{ key: string }>;
  get(key: string): Promise<{ body: Buffer; contentType: string }>;
}

export interface ScheduleCompletionSink {
  onRunSettled(input: {
    tenantId: string;
    occurrenceId: string;
    runId: string;
    status: 'completed' | 'failed' | 'cancelled' | 'needs_attention' | 'awaiting_approval';
    summary: string | null;
  }): Promise<void>;
}

export interface WorkflowRevisionPin {
  pin(tenantId: string, workflowKey: string, workflowVersion: string): Promise<string | null>;
}

export type SecretCipher = {
  encrypt(value: string): string;
  decrypt(value: string): string;
};

export const plainCipher: SecretCipher = {
  encrypt: (value) => value,
  decrypt: (value) => value,
};
