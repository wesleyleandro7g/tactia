/**
 * send_email tool unit tests — schema validation and direct-send behaviour.
 * No database and no LLM involved; the DirectEmailPort is a fake.
 */

import { describe, expect, it, vi } from 'vitest';
import { AppError, ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { ToolRegistry } from '../tool-registry';
import { createSendEmailTool, type DirectEmailPort } from '../tools/send-email';
import type { ToolContext } from '../types';

function toolContext(role: RequestContext['role'] = 'member'): ToolContext {
  const base: RequestContext = {
    requestId: createId(),
    tenantId: 'tenant-1',
    userId: 'user-1',
    role,
    ip: '127.0.0.1',
  };
  return base as ToolContext;
}

function fakePort(
  overrides: Partial<Awaited<ReturnType<DirectEmailPort['sendEmailDirect']>>> = {},
): { port: DirectEmailPort; calls: unknown[] } {
  const calls: unknown[] = [];
  const port: DirectEmailPort = {
    async sendEmailDirect(_ctx, input) {
      calls.push(input);
      return {
        id: 'exec-1',
        actionType: 'send_email',
        status: 'completed',
        output: { messageId: 'msg-123', driver: 'memory' },
        error: null,
        ...overrides,
      };
    },
  };
  return { port, calls };
}

describe('send_email tool', () => {
  it('sends the e-mail and confirms when status is completed', async () => {
    const { port, calls } = fakePort();
    const registry = new ToolRegistry([createSendEmailTool(port)]);

    const result = await registry.execute('send_email', toolContext(), {
      to: 'cliente@empresa.com',
      subject: 'Retomada',
      body: 'Olá!',
    });

    const data = result.data as Record<string, unknown>;
    expect(data.sent).toBe(true);
    expect(data.status).toBe('completed');
    expect(data.messageId).toBe('msg-123');
    expect(data.executionId).toBe('exec-1');
    expect(String(data.message)).toContain('enviado');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      input: { to: 'cliente@empresa.com', subject: 'Retomada', body: 'Olá!' },
    });
  });

  it('forwards the idempotencyKey but keeps it out of the e-mail payload', async () => {
    const { port, calls } = fakePort();
    const registry = new ToolRegistry([createSendEmailTool(port)]);

    await registry.execute('send_email', toolContext(), {
      to: 'cliente@empresa.com',
      subject: 'Retomada',
      body: 'Olá!',
      idempotencyKey: 'abc12345',
    });

    expect(calls[0]).toMatchObject({
      idempotencyKey: 'abc12345',
      input: { to: 'cliente@empresa.com' },
    });
    expect((calls[0] as { input: Record<string, unknown> }).input).not.toHaveProperty(
      'idempotencyKey',
    );
  });

  it('does not confirm the send when the execution failed', async () => {
    const { port } = fakePort({ status: 'failed', output: null, error: 'smtp unreachable' });
    const registry = new ToolRegistry([createSendEmailTool(port)]);

    const result = await registry.execute('send_email', toolContext(), {
      to: 'cliente@empresa.com',
      subject: 'X',
      body: 'Y',
    });

    const data = result.data as Record<string, unknown>;
    expect(data.sent).toBe(false);
    expect(data.messageId).toBeUndefined();
    expect(String(data.message)).toContain('Falha');
  });

  it('rejects invalid input (bad e-mail, empty subject, too many cc)', async () => {
    const { port } = fakePort();
    const registry = new ToolRegistry([createSendEmailTool(port)]);
    const ctx = toolContext();

    await expect(
      registry.execute('send_email', ctx, { to: 'not-an-email', subject: 'x', body: 'y' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    await expect(
      registry.execute('send_email', ctx, { to: 'a@b.com', subject: '', body: 'y' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    await expect(
      registry.execute('send_email', ctx, {
        to: 'a@b.com',
        subject: 'x',
        body: 'y',
        cc: Array.from({ length: 11 }, (_, i) => `c${i}@b.com`),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('requires at least the member role', async () => {
    const { port } = fakePort();
    const registry = new ToolRegistry([createSendEmailTool(port)]);

    await expect(
      registry.execute('send_email', toolContext('viewer'), {
        to: 'a@b.com',
        subject: 'x',
        body: 'y',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORIZATION_ERROR });
  });

  it('propagates a thrown AppError from the port', async () => {
    const port: DirectEmailPort = {
      sendEmailDirect: vi.fn().mockRejectedValue(
        new AppError(ErrorCode.VALIDATION_ERROR, 'boom'),
      ),
    };
    const registry = new ToolRegistry([createSendEmailTool(port)]);

    await expect(
      registry.execute('send_email', toolContext(), { to: 'a@b.com', subject: 'x', body: 'y' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });
});
