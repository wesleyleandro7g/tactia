import { describe, expect, it } from 'vitest';
import { redactSensitive } from './redact';

describe('redactSensitive', () => {
  it('E14: redactSensitive masks CPF CNPJ PAN and sk- keys', () => {
    const text = [
      'CPF 529.982.247-25',
      'cnpj 11.222.333/0001-81',
      'cartao 4111111111111111',
      'masked 4111 **** 1111 1111',
      'key sk-abcdefghijklmnopqrstuvwxyz123456',
      'auth Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload',
      'mcp tactia_live_k4f9c2ab_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ].join(' | ');

    const redacted = redactSensitive(text);
    expect(redacted).toContain('[cpf]');
    expect(redacted).toContain('[cnpj]');
    expect(redacted).toContain('[cartao]');
    expect(redacted).toContain('[segredo]');
    expect(redacted).toContain('Bearer [segredo]');
    expect(redacted).not.toContain('529.982.247-25');
    expect(redacted).not.toContain('11.222.333/0001-81');
    expect(redacted).not.toContain('4111111111111111');
    expect(redacted).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(redacted).not.toContain('tactia_live_k4f9c2ab_');
  });

  it('E14: redactSensitive keeps email and phone', () => {
    const text = 'Fale com ana@empresa.com ou +55 11 98888-7777';
    expect(redactSensitive(text)).toBe(text);
  });
});
