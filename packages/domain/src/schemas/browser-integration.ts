import { z } from 'zod';

/**
 * Backoffice-facing schemas for dynamic browser executor configuration.
 * The API key is provided once at creation and immediately handed to the
 * CredentialService; it never appears in any response DTO.
 */

export const createBrowserExecutorInstanceSchema = z.object({
  provider: z.string().min(1).max(64),
  engine: z.string().min(1).max(64).default('figranium'),
  instanceKey: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  dedicatedConnectionId: z.string().uuid().optional().nullable(),
  environment: z.string().min(1).max(64),
  allowInsecureHttp: z.boolean().optional(),
  // Provided once, stored via CredentialService. Never echoed back.
  apiKey: z.string().min(1),
});

export const updateBrowserExecutorInstanceSchema = z.object({
  baseUrl: z.string().url().optional(),
  dedicatedConnectionId: z.string().uuid().optional().nullable(),
  allowInsecureHttp: z.boolean().optional(),
  active: z.boolean().optional(),
  // Rotate the API key: creates/updates the credential reference.
  apiKey: z.string().min(1).optional(),
});

const versionedWorkflowSchema = z.object({
  schemaVersion: z.number().int(),
  workflowKey: z.string().min(1).max(200),
  workflowVersion: z.string().min(1).max(64),
  publishable: z.boolean(),
  task: z.record(z.unknown()),
});

/**
 * Substitutive JSON import. On the UI this replaces the active definition, but
 * internally it always appends a new immutable revision.
 */
export const importBrowserWorkflowSchema = z.object({
  provider: z.string().min(1).max(64),
  engine: z.string().min(1).max(64).default('figranium'),
  environment: z.string().min(1).max(64),
  workflow: versionedWorkflowSchema,
});

export const publishBrowserWorkflowSchema = z.object({
  workflowId: z.string().uuid(),
  instanceId: z.string().uuid(),
});

/** Health + API-key probe used by the wizard before an instance exists. */
export const testBrowserExecutorHealthSchema = z.object({
  baseUrl: z.string().url(),
  allowInsecureHttp: z.boolean().optional(),
  // Used transiently for the probe, never persisted or echoed back.
  apiKey: z.string().min(1),
});

/** Repoint the active revision (revert/reconcile) without deleting history. */
export const setActiveRevisionSchema = z.object({
  workflowId: z.string().uuid(),
  revisionId: z.string().uuid(),
});

export type ImportBrowserWorkflowInput = z.infer<typeof importBrowserWorkflowSchema>;
export type CreateBrowserExecutorInstanceRequest = z.infer<typeof createBrowserExecutorInstanceSchema>;
