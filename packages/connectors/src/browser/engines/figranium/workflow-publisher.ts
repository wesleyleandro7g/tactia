import { BrowserExecutionError } from '../../contracts';
import type { FigraniumBrowserExecutorConfig } from './figranium-browser-executor';

export type VersionedWorkflow = {
  schemaVersion: number;
  workflowKey: string;
  workflowVersion: string;
  publishable: boolean;
  task: Record<string, unknown>;
};

const SENSITIVE_KEY = /password|passwd|secret|token|cookie|authorization|api[_-]?key/i;

export function validateFigraniumWorkflowDefinition(
  workflow: VersionedWorkflow,
  options: { requirePublishable?: boolean } = {},
) {
  if ((options.requirePublishable ?? true) && !workflow.publishable) {
    throw new BrowserExecutionError('WORKFLOW_NOT_PUBLISHABLE', 'Fluxo ainda não foi validado para publicação.', false);
  }
  const visit = (value: unknown, path: string[] = []) => {
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, [...path, String(index)]));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key) && child !== '' && child !== null && child !== undefined) {
        throw new BrowserExecutionError('WORKFLOW_CONTAINS_SECRET', `Fluxo contém valor sensível em ${[...path, key].join('.')}.`, false);
      }
      visit(child, [...path, key]);
    }
  };
  visit(workflow.task);
}

export class FigraniumWorkflowPublisher {
  private readonly baseUrl: URL;

  constructor(private readonly config: Pick<FigraniumBrowserExecutorConfig, 'baseUrl' | 'apiKey'>) {
    this.baseUrl = new URL(config.baseUrl);
  }

  async publish(workflow: VersionedWorkflow, marker?: string): Promise<{ taskId: string; operation: 'created' | 'updated' }> {
    validateFigraniumWorkflowDefinition(workflow);
    const reconciliationMarker = marker ?? `[tactia:${workflow.workflowKey}@${workflow.workflowVersion}]`;
    const task = {
      ...workflow.task,
      description: `${reconciliationMarker} ${String(workflow.task['description'] ?? '')}`.trim(),
      schedule: { enabled: false },
      disableRecording: true,
      statelessExecution: false,
    };
    const listing = await this.request('/api/tasks/list', { method: 'GET' });
    const rows = Array.isArray((listing as { tasks?: unknown }).tasks) ? (listing as { tasks: Array<Record<string, unknown>> }).tasks : [];
    const existing = rows.find((row) => typeof row['description'] === 'string' && row['description'].includes(reconciliationMarker));
    if (typeof existing?.['id'] === 'string') {
      await this.request(`/api/tasks/${encodeURIComponent(existing['id'])}`, {
        method: 'PATCH',
        body: JSON.stringify(task),
      });
      return { taskId: existing['id'], operation: 'updated' };
    }
    const created = await this.request('/api/tasks', { method: 'POST', body: JSON.stringify(task) }) as Record<string, unknown>;
    if (typeof created['id'] !== 'string') throw new BrowserExecutionError('WORKFLOW_PUBLISH_INVALID_RESPONSE', 'Publicação não retornou ID da tarefa.', false);
    return { taskId: created['id'], operation: 'created' };
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: { 'content-type': 'application/json', 'x-api-key': this.config.apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new BrowserExecutionError('WORKFLOW_PUBLISH_FAILED', 'Figranium recusou a publicação do fluxo.', response.status >= 500);
    return response.json();
  }
}
