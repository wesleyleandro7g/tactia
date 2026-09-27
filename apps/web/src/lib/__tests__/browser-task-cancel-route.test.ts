import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  options: [] as unknown[],
  cancelTask: vi.fn(async (_ctx: unknown, id: string) => ({ id, status: 'CANCELLED' })),
}));

vi.mock('@/lib/api', () => ({
  createApiHandler: (
    options: unknown,
    handler: (request: Request, ctx: unknown, params: Record<string, string>) => unknown,
  ) => {
    mocks.options.push(options);
    return handler;
  },
}));
vi.mock('@/lib/browser-automation', () => ({
  browserAutomationService: { cancelTask: mocks.cancelTask },
}));

import { POST } from '@/app/api/v1/browser/tasks/[id]/cancel/route';

describe('POST /api/v1/browser/tasks/:id/cancel', () => {
  it('requires a tenant session and delegates to the durable cancellation', async () => {
    const ctx = { tenantId: 'tenant-a', userId: 'user-1', role: 'member', requestId: 'r' };
    const handler = POST as unknown as (
      request: Request,
      ctx: unknown,
      params: Record<string, string>,
    ) => Promise<unknown>;

    await expect(handler(new Request('http://localhost'), ctx, { id: 'task-1' })).resolves.toEqual({
      id: 'task-1',
      status: 'CANCELLED',
    });
    expect(mocks.options).toEqual([{ auth: 'tenant' }]);
    expect(mocks.cancelTask).toHaveBeenCalledWith(ctx, 'task-1');
  });
});
