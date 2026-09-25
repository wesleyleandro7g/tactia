import { afterEach, describe, expect, it, vi } from 'vitest';
import { FigraniumBrowserExecutor } from '../browser/engines/figranium/figranium-browser-executor';

const request = {
  executionKey: 'run-1',
  connectionId: 'connection-1',
  sessionScope: 'session-1',
  workflowKey: 'torge.products',
  workflowVersion: '1',
  parameters: { includeInactive: true },
  credentialRefs: ['credential-1'],
  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
};

function executor(connectionId = 'connection-1') {
  return new FigraniumBrowserExecutor(
    {
      instanceKey: 'dedicated-1',
      baseUrl: 'http://127.0.0.1:11345',
      apiKey: 'service-key',
      dedicatedConnectionId: connectionId,
      workflows: [{ workflowKey: 'torge.products', workflowVersion: '1', taskId: 'task-1' }],
    },
    { resolve: async () => ({ username: 'synthetic-user', password: 'synthetic-password' }) },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('FigraniumBrowserExecutor', () => {
  it.each([
    ['error', 'failed', 'FIGRANIUM_TASK_ERROR'],
    ['crashed', 'failed', 'FIGRANIUM_CRASHED'],
    ['stopped', 'cancelled', 'FIGRANIUM_STOPPED'],
    ['anti_bot', 'needs_attention', 'FIGRANIUM_ANTI_BOT'],
  ] as const)('normalizes HTTP 200 outcome %s', async (outcome, status, errorCode) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ outcome }), { status: 200 })));
    const result = await executor().execute(request);
    expect(result).toMatchObject({ status, errorCode, externalExecutionId: 'run-1' });
  });

  it('passes secrets only as runtime variables and forces recording off', async () => {
    const fetchMock = vi.fn(async (_url: URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ outcome: 'success', data: { rows: [] }, downloads: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await executor().execute(request);
    expect(result.status).toBe('succeeded');
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      disableRecording: true,
      statelessExecution: false,
      variables: { username: 'synthetic-user', password: 'synthetic-password', includeInactive: true },
    });
  });

  it('fails closed when the instance is not dedicated to the connection', async () => {
    await expect(executor('another-connection').execute(request)).rejects.toMatchObject({
      code: 'FIGRANIUM_SESSION_NOT_ISOLATED',
      status: 'needs_attention',
      retryable: false,
    });
  });

  it('rejects unverified artifact URLs', async () => {
    await expect(executor().fetchArtifact({ ref: 'https://attacker.invalid/file.csv' })).rejects.toMatchObject({
      code: 'FIGRANIUM_ARTIFACT_REF_INVALID',
    });
  });
});
