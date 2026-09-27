import { AppError, ErrorCode } from '@tactia/shared';

type Bucket = { timestamps: number[] };
const buckets = new Map<string, Bucket>();
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
  name: string;
  limit: number;
  windowMs: number;
};

export const RATE_LIMITS = {
  sync: { name: 'sync', limit: 6, windowMs: 60_000 },
  mutate: { name: 'mutate', limit: 60, windowMs: 60_000 },
  upload: { name: 'upload', limit: 10, windowMs: 60_000 },
  /** Same budget as the web chat: each turn may call several LLM rounds. */
  chat: { name: 'chat', limit: 20, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

export function enforceRateLimit(
  policy: RateLimitPolicy,
  identity: { operatorId?: string | null; ip?: string | null },
): void {
  const subject = identity.operatorId ?? identity.ip ?? 'unknown';
  if (consumeRateLimit(`${policy.name}:${subject}`, policy.limit, policy.windowMs)) return;
  throw new AppError(
    ErrorCode.RATE_LIMITED,
    'Muitas solicitações em pouco tempo. Aguarde um instante e tente novamente.',
  );
}
