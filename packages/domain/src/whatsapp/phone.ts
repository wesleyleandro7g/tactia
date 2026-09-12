/**
 * Canonical WhatsApp identity: digits only, E.164 without '+'.
 * Accepts JIDs (`5511...@s.whatsapp.net`), device suffixes (`5511...:12`) and
 * formatted numbers (`+55 11 99999-9999`).
 */
export function normalizeWhatsappPhone(raw: string): string | null {
  const local = raw.trim().split('@')[0] ?? '';
  const withoutDevice = local.split(':')[0] ?? '';
  const digits = withoutDevice.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

export const INVALID_WHATSAPP_PHONE =
  'Informe um número com DDI (10 a 15 dígitos). Ex.: 5511999999999';
