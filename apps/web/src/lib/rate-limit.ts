import { AppError, ErrorCode } from '@tactia/shared';

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

/** Cheap guard against unbounded growth in a long-lived process. */
const MAX_BUCKETS = 10_000;

export function consumeRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < windowMs);
  if (bucket.timestamps.length >= limit) {
    buckets.set(key, bucket);
    return false;
  }
  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
    for (const [candidate, value] of buckets) {
      if (value.timestamps.every((ts) => now - ts >= windowMs)) buckets.delete(candidate);
    }
  }
  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return true;
}

export type RateLimitPolicy = {
  /** Prefix of the bucket key, e.g. `chat`. */
  name: string;
  limit: number;
  windowMs: number;
};

/**
 * Rate limits (spec §49). In-memory and therefore per-process: enough for the
 * single-instance pilot. A Redis/Postgres driver replaces `consumeRateLimit`
 * without touching the call sites.
 */
export const RATE_LIMITS = {
  /** LLM calls cost money and time — the tightest limit in the app. */
  chat: { name: 'chat', limit: 20, windowMs: 60_000 },
  /** A sync reads an entire source; two per minute is already generous. */
  sync: { name: 'sync', limit: 6, windowMs: 60_000 },
  /** The intelligence pipeline scans the whole tenant. */
  pipeline: { name: 'pipeline', limit: 10, windowMs: 60_000 },
  /** Side-effecting actions. */
  execution: { name: 'execution', limit: 60, windowMs: 60_000 },
  /** CSV uploads from the import wizard. */
  upload: { name: 'upload', limit: 20, windowMs: 60_000 },
  /** External MCP clients — tighter than chat, keyed by API key. */
  mcp: { name: 'api_key', limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

/**
 * Throws `RATE_LIMITED` (HTTP 429) when the caller exceeded the policy.
 * The bucket is keyed by tenant when there is a session, by IP otherwise.
 */
export function enforceRateLimit(
  policy: RateLimitPolicy,
  identity: {
    tenantId?: string | null;
    userId?: string | null;
    ip?: string | null;
    apiKeyId?: string | null;
  },
): void {
  const subject = identity.apiKeyId ?? identity.tenantId ?? identity.userId ?? identity.ip ?? 'unknown';
  if (consumeRateLimit(`${policy.name}:${subject}`, policy.limit, policy.windowMs)) return;
  throw new AppError(
    ErrorCode.RATE_LIMITED,
    'Muitas solicitações em pouco tempo. Aguarde um instante e tente novamente.',
  );
}
