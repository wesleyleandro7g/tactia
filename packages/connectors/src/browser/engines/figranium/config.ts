import type { BrowserCredentialResolver } from '../../contracts';
import {
  FigraniumBrowserExecutor,
  type FigraniumBrowserExecutorConfig,
  type FigraniumWorkflowBinding,
} from './figranium-browser-executor';

export type FigraniumInstancesEnvironment = {
  FIGRANIUM_INSTANCES_JSON?: string;
  NODE_ENV?: string;
};

type InstanceDocument = {
  baseUrl?: unknown;
  apiKey?: unknown;
  dedicatedConnectionId?: unknown;
  workflows?: unknown;
};

function workflowBindings(value: unknown): FigraniumWorkflowBinding[] {
  if (!Array.isArray(value)) throw new Error('FIGRANIUM_INSTANCES_JSON: workflows inválidos.');
  return value.map((item) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
    if (!row || typeof row['workflowKey'] !== 'string' || typeof row['workflowVersion'] !== 'string' || typeof row['taskId'] !== 'string') {
      throw new Error('FIGRANIUM_INSTANCES_JSON: vínculo de workflow inválido.');
    }
    return {
      workflowKey: row['workflowKey'],
      workflowVersion: row['workflowVersion'],
      taskId: row['taskId'],
    };
  });
}

export function figraniumConfigFromEnv(
  instanceKey: string,
  env: FigraniumInstancesEnvironment = process.env,
): FigraniumBrowserExecutorConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.FIGRANIUM_INSTANCES_JSON || '{}');
  } catch {
    throw new Error('FIGRANIUM_INSTANCES_JSON não é JSON válido.');
  }
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const instance = root[instanceKey] as InstanceDocument | undefined;
  if (!instance || typeof instance !== 'object') throw new Error(`Instância Figranium não configurada: ${instanceKey}.`);
  if (typeof instance.baseUrl !== 'string' || typeof instance.apiKey !== 'string' || typeof instance.dedicatedConnectionId !== 'string') {
    throw new Error(`Instância Figranium incompleta: ${instanceKey}.`);
  }
  return {
    instanceKey,
    baseUrl: instance.baseUrl,
    apiKey: instance.apiKey,
    dedicatedConnectionId: instance.dedicatedConnectionId,
    workflows: workflowBindings(instance.workflows),
    allowInsecureHttp: env.NODE_ENV !== 'production',
  };
}

export function createFigraniumExecutorFromEnv(
  instanceKey: string,
  credentials: BrowserCredentialResolver,
  env: FigraniumInstancesEnvironment = process.env,
) {
  return new FigraniumBrowserExecutor(figraniumConfigFromEnv(instanceKey, env), credentials);
}

/**
 * DB-first inputs resolved by the domain layer. The apiKey is read from the
 * CredentialService (never persisted in a config document), and the workflow
 * bindings come from persisted BrowserWorkflowBinding rows.
 */
export type ResolvedFigraniumInstance = {
  instanceKey: string;
  baseUrl: string;
  apiKey: string;
  dedicatedConnectionId: string;
  allowInsecureHttp?: boolean;
  workflows: FigraniumWorkflowBinding[];
};

/**
 * Build an executor config from an already-resolved instance (DB-first path).
 * No environment access happens here.
 */
export function figraniumConfigFromResolved(
  resolved: ResolvedFigraniumInstance,
): FigraniumBrowserExecutorConfig {
  if (!resolved.baseUrl || !resolved.apiKey || !resolved.dedicatedConnectionId) {
    throw new Error(`Instância Figranium incompleta: ${resolved.instanceKey}.`);
  }
  return {
    instanceKey: resolved.instanceKey,
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    dedicatedConnectionId: resolved.dedicatedConnectionId,
    workflows: resolved.workflows,
    allowInsecureHttp: resolved.allowInsecureHttp ?? false,
  };
}

export function createFigraniumExecutorFromResolved(
  resolved: ResolvedFigraniumInstance,
  credentials: BrowserCredentialResolver,
) {
  return new FigraniumBrowserExecutor(figraniumConfigFromResolved(resolved), credentials);
}
