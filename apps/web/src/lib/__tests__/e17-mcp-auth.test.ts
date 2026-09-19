import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@tactia/shared';
import { createApiHandler, resolveApiKeyContext } from '../api';
import { RATE_LIMITS } from '../rate-limit';

describe('E17 MCP route auth', () => {
  it('E17: CRON_SECRET is not accepted as Bearer on /api/v1/mcp', async () => {
    const previous = process.env['CRON_SECRET'];
    process.env['CRON_SECRET'] = 'platform-cron-secret';
    try {
      const request = new Request('http://localhost/api/v1/mcp', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer platform-cron-secret',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '0' },
          },
        }),
      });

      await expect(resolveApiKeyContext(request)).rejects.toMatchObject({
        code: ErrorCode.AUTHENTICATION_ERROR,
      });

      const POST = createApiHandler({ auth: 'api_key', rateLimit: RATE_LIMITS.mcp }, async () => {
        throw new Error('MCP handler must not run for CRON_SECRET');
      });
      const response = await POST(request.clone(), { params: Promise.resolve({}) });
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe(ErrorCode.AUTHENTICATION_ERROR);
    } finally {
      if (previous === undefined) delete process.env['CRON_SECRET'];
      else process.env['CRON_SECRET'] = previous;
    }
  });
});
