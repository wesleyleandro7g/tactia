import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@tactia/database';
import { AppError, createId } from '@tactia/shared';
import { enforceDistributedMcpRateLimit } from '../mcp-rate-limit';

const authorizationId = createId();

afterAll(async () => {
  await prisma.mcpRateLimitBucket.deleteMany({
    where: { key: { contains: authorizationId } },
  });
  await prisma.$disconnect();
});

describe('distributed MCP rate limit', () => {
  it('shares an atomic quota for an OAuth authorization', async () => {
    const policy = { name: 'mcp-test', limit: 2, windowMs: 60_000 };
    await expect(enforceDistributedMcpRateLimit(policy, authorizationId)).resolves.toBeUndefined();
    await expect(enforceDistributedMcpRateLimit(policy, authorizationId)).resolves.toBeUndefined();
    await expect(enforceDistributedMcpRateLimit(policy, authorizationId)).rejects.toBeInstanceOf(
      AppError,
    );
  });
});
