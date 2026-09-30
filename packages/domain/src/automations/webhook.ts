import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError, ErrorCode } from '@tactia/shared';

const MAX_SKEW_MS = 5 * 60 * 1000;

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function assertWebhookSignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: Date;
}): void {
  if (!input.timestamp || !input.signature) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Assinatura do webhook ausente.');
  }
  const stamp = Number(input.timestamp);
  if (!Number.isFinite(stamp)) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Timestamp do webhook inválido.');
  }
  const now = (input.now ?? new Date()).getTime();
  if (Math.abs(now - stamp) > MAX_SKEW_MS) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Timestamp do webhook expirado.');
  }
  const expected = signWebhook(input.secret, input.timestamp, input.body);
  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Assinatura do webhook inválida.');
  }
}
