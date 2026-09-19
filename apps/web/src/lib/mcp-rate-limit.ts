import { Prisma, prisma } from '@tactia/database';
import { AppError, ErrorCode } from '@tactia/shared';
import type { RateLimitPolicy } from './rate-limit';

/**
 * Atomic, database-backed rate limit for the public MCP endpoint. The bucket is
 * shared by every web instance, so adding replicas cannot multiply the quota.
 */
export async function enforceDistributedMcpRateLimit(
  policy: RateLimitPolicy,
  authorizationId: string,
): Promise<void> {
  const key = `${policy.name}:oauth:${authorizationId}`;
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    INSERT INTO "mcp_rate_limit_buckets" ("key", "window_started_at", "count", "expires_at")
    VALUES (
      ${key},
      NOW(),
      1,
      NOW() + (${policy.windowMs} * INTERVAL '1 millisecond')
    )
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "mcp_rate_limit_buckets"."window_started_at" <=
          NOW() - (${policy.windowMs} * INTERVAL '1 millisecond')
        THEN 1
        ELSE "mcp_rate_limit_buckets"."count" + 1
      END,
      "window_started_at" = CASE
        WHEN "mcp_rate_limit_buckets"."window_started_at" <=
          NOW() - (${policy.windowMs} * INTERVAL '1 millisecond')
        THEN NOW()
        ELSE "mcp_rate_limit_buckets"."window_started_at"
      END,
      "expires_at" = CASE
        WHEN "mcp_rate_limit_buckets"."window_started_at" <=
          NOW() - (${policy.windowMs} * INTERVAL '1 millisecond')
        THEN NOW() + (${policy.windowMs} * INTERVAL '1 millisecond')
        ELSE "mcp_rate_limit_buckets"."expires_at"
      END
    RETURNING "count"
  `);

  if ((rows[0]?.count ?? policy.limit + 1) <= policy.limit) return;
  throw new AppError(
    ErrorCode.RATE_LIMITED,
    'Muitas solicitações em pouco tempo. Aguarde um instante e tente novamente.',
  );
}
