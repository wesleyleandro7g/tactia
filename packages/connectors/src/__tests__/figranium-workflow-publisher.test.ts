import { afterEach, describe, expect, it, vi } from 'vitest';
import { FigraniumWorkflowPublisher } from '../browser/engines/figranium/workflow-publisher';
import type { VersionedWorkflow } from '../browser/engines/figranium/workflow-publisher';

const workflow: VersionedWorkflow = {
  schemaVersion: 1,
  workflowKey: 'torge.products',
  workflowVersion: '1',
  publishable: true,
  task: { name: 'Products', description: 'coleta', url: 'https://example.com/', schedule: { enabled: true } },
};

function publisher() {
  return new FigraniumWorkflowPublisher({ baseUrl: 'https://figranium.internal/', apiKey: 'k' });
}

afterEach(() => vi.unstubAllGlobals());

describe('FigraniumWorkflowPublisher', () => {
  it('creates a task when no marker matches and forces schedule off', async () => {
    const posted: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/tasks/list')) return new Response(JSON.stringify({ tasks: [] }), { status: 200 });
      posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: 'task-1' }), { status: 200 });
    }));
    const result = await publisher().publish(workflow, '[tactia:torge.products@1#1]');
    expect(result).toEqual({ taskId: 'task-1', operation: 'created' });
    expect(posted[0]!['schedule']).toEqual({ enabled: false });
    expect(posted[0]!['disableRecording']).toBe(true);
    expect(posted[0]!['description']).toContain('[tactia:torge.products@1#1]');
  });

  it('reconciles (updates) when a task with the same marker already exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (String(url).endsWith('/api/tasks/list')) {
        return new Response(JSON.stringify({ tasks: [{ id: 'task-9', description: '[tactia:torge.products@1#1] old' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'task-9' }), { status: 200 });
    }));
    const result = await publisher().publish(workflow, '[tactia:torge.products@1#1]');
    expect(result).toEqual({ taskId: 'task-9', operation: 'updated' });
  });

  it('does not reconcile across distinct revision markers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (String(url).endsWith('/api/tasks/list')) {
        return new Response(JSON.stringify({ tasks: [{ id: 'task-rev1', description: '[tactia:torge.products@1#1] r1' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'task-rev2' }), { status: 200 });
    }));
    const result = await publisher().publish(workflow, '[tactia:torge.products@1#2]');
    expect(result).toEqual({ taskId: 'task-rev2', operation: 'created' });
  });

  it('refuses to publish a definition that carries a secret', async () => {
    const withSecret: VersionedWorkflow = { ...workflow, task: { ...workflow.task, apiKey: 'leak' } };
    await expect(publisher().publish(withSecret, '[m]')).rejects.toMatchObject({ code: 'WORKFLOW_CONTAINS_SECRET' });
  });
});
