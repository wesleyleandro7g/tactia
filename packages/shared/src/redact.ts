/**
 * Redacts secrets and Brazilian identifiers from logs and debug metadata.
 * Email and phone are kept — the model needs them for send_email / profile.
 */

const CPF_FORMATTED = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CPF_CONTEXT = /\b(?:cpf)[\s:.-]*(\d{11})\b/gi;
const CNPJ_FORMATTED = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
const SECRET_SK = /\bsk-[A-Za-z0-9_-]{20,}/g;
const SECRET_BEARER = /\bBearer\s+\S+/gi;
/** Grouped card numbers, optional **** in the middle. */
const PAN_GROUPED = /\b(?:(?:\d{4}|\*{4})[ -]?){3,4}(?:\d{1,4}|\*{4})?\b/g;
const PAN_CONTIGUOUS = /\b\d{13,19}\b/g;

function luhnOk(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (!Number.isFinite(n)) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function redactSensitive(text: string): string {
  let out = text;
  out = out.replace(SECRET_SK, '[segredo]');
  out = out.replace(SECRET_BEARER, 'Bearer [segredo]');
  out = out.replace(CNPJ_FORMATTED, '[cnpj]');
  out = out.replace(CPF_FORMATTED, '[cpf]');
  out = out.replace(CPF_CONTEXT, '[cpf]');
  out = out.replace(PAN_GROUPED, (match) => {
    const digits = digitsOnly(match);
    const stars = (match.match(/\*/g) ?? []).length;
    if (stars >= 4 && digits.length >= 4) return '[cartao]';
    if (digits.length >= 13 && digits.length <= 19) return '[cartao]';
    return match;
  });
  out = out.replace(PAN_CONTIGUOUS, (match) => {
    if (match.length >= 13 && match.length <= 19 && luhnOk(match)) return '[cartao]';
    return match;
  });
  return out;
}

export function redactSensitiveDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitive(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveDeep(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        redactSensitiveDeep(nested),
      ]),
    );
  }
  return value;
}
