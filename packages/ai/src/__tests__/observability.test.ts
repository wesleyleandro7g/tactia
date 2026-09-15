import { describe, expect, it, vi } from 'vitest';
import { createId, logger } from '@tactia/shared';
import { logChatTurn } from '../observability';
import type { ChatAnswer } from '../types';

describe('chat observability', () => {
  it('E14: logChatTurn does not include raw CPF', () => {
    const spy = vi.spyOn(logger, 'info');
    const answer: ChatAnswer = {
      content: 'O cliente CPF 529.982.247-25 comprou R$ 1.500.',
      followUps: [],
      sources: [],
      toolCalls: [{ name: 'get_revenue', input: { from: '2025-01-01' }, durationMs: 12, sources: [] }],
      proposals: [],
      attachments: [],
      provider: 'mock',
      model: 'mock-model',
    };

    logChatTurn(
      { requestId: createId(), tenantId: 'tenant-1', userId: 'user-1' },
      {
        conversationId: 'conv-1',
        startedAt: Date.now() - 40,
        mode: 'sync',
        answer,
      },
    );

    const payload = JSON.stringify(spy.mock.calls[0]?.[0]);
    expect(payload).not.toContain('529.982.247-25');
    expect(payload).not.toContain(answer.content);
    expect(payload).toContain('get_revenue');
    spy.mockRestore();
  });
});
