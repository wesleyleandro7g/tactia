import { describe, expect, it, vi } from 'vitest';
import { MessageRepository } from '../repositories/message-repository';

describe('MessageRepository browser result', () => {
  it('upserts by browserTaskId so retries cannot duplicate the answer', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'message-1' });
    const repo = new MessageRepository({ message: { upsert } } as never);
    await repo.createBrowserResult({
      tenantId: 'tenant-1', conversationId: 'conversation-1', browserTaskId: 'task-1',
      content: 'Resultado', metadata: { browserResultTaskId: 'task-1' },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { browserTaskId: 'task-1' },
      update: {},
      create: expect.objectContaining({
        tenantId: 'tenant-1', conversationId: 'conversation-1', browserTaskId: 'task-1',
        role: 'assistant', content: 'Resultado',
      }),
    });
  });
});
