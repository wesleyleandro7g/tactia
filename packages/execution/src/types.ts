import type { z } from 'zod';
import type { ActionType } from '@tactia/database';

// ---------------------------------------------------------------------------
// Action contract (spec §45)
// ---------------------------------------------------------------------------

/**
 * Context handed to an executor.
 *
 * Deliberately narrow: an execution may run *after* the HTTP request that
 * proposed it (approval flow, background queue), so there is no session or
 * role here. Authorization happens when the action is proposed and approved.
 */
export type ActionExecutorContext = {
  tenantId: string;
  /** User that requested the action (null for system-originated executions). */
  requestedBy: string | null;
  /** Correlation id reused from the originating request when available. */
  requestId: string;
  executionId: string;
  /** Action-level configuration (defaults for the executor). */
  configuration: Record<string, unknown>;
};

/** Everything the executor produced — persisted in `ActionExecution.output`. */
export type ActionOutput = Record<string, unknown>;

export type ActionDefinition = {
  readonly type: ActionType;
  /** Default name used when the action is auto-provisioned for a tenant. */
  readonly name: string;
  readonly description: string;
  /** Default for `Action.requires_approval` when auto-provisioned. */
  readonly defaultRequiresApproval: boolean;
  readonly inputSchema: z.ZodTypeAny;
  execute(context: ActionExecutorContext, input: unknown): Promise<ActionOutput>;
};

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export type EmailMessage = {
  to: string;
  subject: string;
  body: string;
  cc?: string[];
};

export type EmailSendResult = {
  /** Provider message id (or a generated one for the console driver). */
  id: string;
  driver: string;
};

/** Optional context handed to the sender at send time (e.g. tenant scoping). */
export type EmailSendContext = {
  tenantId?: string;
};

/** Pluggable e-mail transport. V0.1 ships a console/log driver only. */
export interface EmailSender {
  readonly driver: string;
  send(message: EmailMessage, context?: EmailSendContext): Promise<EmailSendResult>;
}

/**
 * Where an approved execution actually runs. `InlineJobQueue` awaits it in
 * process (V0.1); a pg-boss driver can be dropped in without touching the
 * engine (spec §46).
 */
export interface JobQueue {
  readonly name: string;
  enqueue(job: { tenantId: string; executionId: string; run: () => Promise<void> }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Engine results
// ---------------------------------------------------------------------------

export type ProposeActionInput = {
  /** Action definition to run — by id or by type (type is what the AI uses). */
  actionId?: string;
  actionType?: ActionType;
  input: unknown;
  /** Repeated key returns the original execution instead of a new one (spec §52). */
  idempotencyKey?: string | null;
  /** Free-text justification stored on the approval request. */
  reason?: string | null;
};

export type ExecutionOrigin = 'user' | 'ai' | 'system' | 'mcp' | 'ai_direct' | 'schedule';
