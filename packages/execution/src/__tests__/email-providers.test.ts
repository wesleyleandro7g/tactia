import { describe, expect, it } from 'vitest';
import {
  SMTP_PROVIDER_IDS,
  SMTP_PROVIDER_PRESETS,
  getSmtpProviderPreset,
  resolveSmtpConnection,
} from '../email-providers';

describe('SMTP provider presets', () => {
  it('exposes every provider id', () => {
    expect(SMTP_PROVIDER_IDS).toEqual([
      'gmail',
      'outlook',
      'office365',
      'yahoo',
      'zoho',
      'custom',
    ]);
  });

  it('carries connection defaults for named providers', () => {
    expect(getSmtpProviderPreset('gmail')).toMatchObject({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
    });
    expect(getSmtpProviderPreset('office365')).toMatchObject({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
    });
  });

  it('leaves custom without connection defaults', () => {
    expect(SMTP_PROVIDER_PRESETS.custom.host).toBeUndefined();
    expect(SMTP_PROVIDER_PRESETS.custom.port).toBeUndefined();
  });

  it('resolves a named provider connection without overrides', () => {
    expect(resolveSmtpConnection('gmail')).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
    });
  });

  it('resolves custom from overrides', () => {
    expect(
      resolveSmtpConnection('custom', { host: 'mail.acme.dev', port: 2525, secure: false }),
    ).toEqual({ host: 'mail.acme.dev', port: 2525, secure: false });
  });

  it('throws when custom is missing host/port/secure', () => {
    expect(() => resolveSmtpConnection('custom', { host: 'mail.acme.dev' })).toThrow(
      /Configuração SMTP incompleta/,
    );
  });

  it('allows overriding a named provider port', () => {
    expect(resolveSmtpConnection('gmail', { port: 587, secure: false })).toEqual({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
    });
  });
});
