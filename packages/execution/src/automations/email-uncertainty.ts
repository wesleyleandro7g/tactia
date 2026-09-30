export class EmailDeliveryUncertainError extends Error {
  readonly code = 'EMAIL_DELIVERY_UNCERTAIN';

  constructor(message = 'Não foi possível confirmar se o servidor SMTP aceitou a mensagem.') {
    super(message);
    this.name = 'EmailDeliveryUncertainError';
  }
}

const UNCERTAIN_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ESOCKET']);

export function isUncertainEmailError(error: unknown): boolean {
  if (error instanceof EmailDeliveryUncertainError) return true;
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === 'EMAIL_DELIVERY_UNCERTAIN' || UNCERTAIN_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : '';
  return /timeout|socket hang up|EMAIL_DELIVERY_UNCERTAIN/i.test(message);
}

export function uncertainEmailMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Envio de e-mail com resultado incerto.';
}
