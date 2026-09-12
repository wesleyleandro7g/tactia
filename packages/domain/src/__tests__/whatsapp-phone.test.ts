import { describe, expect, it } from 'vitest';
import { normalizeWhatsappPhone } from '../whatsapp/phone';

describe('normalizeWhatsappPhone', () => {
  it('keeps E.164 digits', () => {
    expect(normalizeWhatsappPhone('5511999999999')).toBe('5511999999999');
  });

  it('strips JID, device suffix, plus and punctuation', () => {
    expect(normalizeWhatsappPhone('5511999999999:12@s.whatsapp.net')).toBe('5511999999999');
    expect(normalizeWhatsappPhone('+55 11 99999-9999')).toBe('5511999999999');
    expect(normalizeWhatsappPhone('5511999999999@c.us')).toBe('5511999999999');
  });

  it('rejects too short, too long, or empty', () => {
    expect(normalizeWhatsappPhone('1199999')).toBeNull();
    expect(normalizeWhatsappPhone('1'.repeat(16))).toBeNull();
    expect(normalizeWhatsappPhone('')).toBeNull();
    expect(normalizeWhatsappPhone('not-a-number')).toBeNull();
  });
});
