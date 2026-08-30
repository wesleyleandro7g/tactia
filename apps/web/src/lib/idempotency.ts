import { AppError, ErrorCode } from '@tactia/shared';

const HEADER = 'idempotency-key';
const MAX_LENGTH = 200;

/**
 * Reads the `Idempotency-Key` header (spec §52). Returns `null` when absent so
 * callers can opt out; rejects keys that are too long to be a sane client id.
 */
export function idempotencyKey(request: Request): string | null {
  const raw = request.headers.get(HEADER);
  if (!raw) return null;

  const key = raw.trim();
  if (!key) return null;
  if (key.length > MAX_LENGTH) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Idempotency-Key deve ter no máximo ${MAX_LENGTH} caracteres`,
    );
  }
  return key;
}
