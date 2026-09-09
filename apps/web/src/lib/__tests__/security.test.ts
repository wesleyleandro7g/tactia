/**
 * Revisão de segurança da Etapa 9 (spec §49) sobre as partes puras:
 * rate limiting, classificação de erro e mensagens de usuário.
 * Isolamento por tenant e criptografia de credential são cobertos pelos testes
 * de integração (`pilot-flow`, `postgres-connector`, `tenant-isolation`).
 */
import { describe, expect, it } from 'vitest';
import { AppError, ErrorCode, fail } from '@tactia/shared';
import { RATE_LIMITS, consumeRateLimit, enforceRateLimit } from '../rate-limit';
import { ERROR_MESSAGES } from '../format';

describe('rate limiting (spec §49)', () => {
  it('blocks the caller after the policy limit and keeps buckets per subject', () => {
    const policy = { name: `test-${Math.random()}`, limit: 3, windowMs: 60_000 };

    for (let i = 0; i < policy.limit; i += 1) {
      expect(() => enforceRateLimit(policy, { tenantId: 'tenant-a' })).not.toThrow();
    }

    try {
      enforceRateLimit(policy, { tenantId: 'tenant-a' });
      throw new Error('should have been rate limited');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.RATE_LIMITED);
      expect((error as AppError).statusCode).toBe(429);
    }

    // Another tenant has its own budget.
    expect(() => enforceRateLimit(policy, { tenantId: 'tenant-b' })).not.toThrow();
  });

  it('falls back to user, then ip, when there is no tenant', () => {
    const policy = { name: `anon-${Math.random()}`, limit: 1, windowMs: 60_000 };
    expect(() => enforceRateLimit(policy, { ip: '10.0.0.1' })).not.toThrow();
    expect(() => enforceRateLimit(policy, { ip: '10.0.0.1' })).toThrow(AppError);
    expect(() => enforceRateLimit(policy, { ip: '10.0.0.2' })).not.toThrow();
  });

  it('releases the budget once the window passes', async () => {
    const key = `window-${Math.random()}`;
    expect(consumeRateLimit(key, 1, 5)).toBe(true);
    expect(consumeRateLimit(key, 1, 60_000)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The previous timestamp is now outside the 5ms window.
    expect(consumeRateLimit(key, 1, 5)).toBe(true);
  });

  it('covers the expensive endpoints', () => {
    expect(Object.keys(RATE_LIMITS).sort()).toEqual(['chat', 'execution', 'pipeline', 'sync', 'upload']);
    for (const policy of Object.values(RATE_LIMITS)) {
      expect(policy.limit).toBeGreaterThan(0);
      expect(policy.windowMs).toBeGreaterThan(0);
    }
  });
});

describe('classificação de erro (spec §48)', () => {
  it('maps every code to an HTTP status', () => {
    const expected: Record<string, number> = {
      VALIDATION_ERROR: 400,
      AUTHENTICATION_ERROR: 401,
      AUTHORIZATION_ERROR: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      RATE_LIMITED: 429,
      INTERNAL_ERROR: 500,
      CONNECTOR_ERROR: 502,
      SYNC_ERROR: 502,
      AI_ERROR: 502,
      ACTION_ERROR: 502,
    };
    for (const code of Object.values(ErrorCode)) {
      expect(new AppError(code, 'x').statusCode).toBe(expected[code]);
    }
  });

  it('every code has a pt-BR message, so no raw code reaches the user', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_MESSAGES[code], code).toBeTruthy();
    }
  });

  it('the error body carries only code, message, details and requestId', () => {
    const body = fail(ErrorCode.INTERNAL_ERROR, 'Internal server error', 'req-1');
    expect(Object.keys(body).sort()).toEqual(['error', 'meta']);
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
    expect(JSON.stringify(body)).not.toMatch(/\bat\s+\S+:\d+:\d+/); // no stack frames
  });
});
