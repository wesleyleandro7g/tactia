import { describe, expect, it } from 'vitest';
import { emailConfigSchema } from '../schemas/email';

describe('emailConfigSchema', () => {
  const base = {
    fromEmail: 'noreply@acme.dev',
    username: 'noreply@acme.dev',
    password: 'app-password',
  };

  it('accepts a named provider without host/port', () => {
    const parsed = emailConfigSchema.parse({ provider: 'gmail', ...base });
    expect(parsed.provider).toBe('gmail');
    expect(parsed.host).toBeUndefined();
  });

  it('accepts a custom provider with host/port/secure', () => {
    const parsed = emailConfigSchema.parse({
      provider: 'custom',
      host: 'mail.acme.dev',
      port: 587,
      secure: false,
      ...base,
    });
    expect(parsed).toMatchObject({ host: 'mail.acme.dev', port: 587, secure: false });
  });

  it('coerces string port numbers (form data)', () => {
    const parsed = emailConfigSchema.parse({
      provider: 'custom',
      host: 'mail.acme.dev',
      port: '2525',
      secure: true,
      ...base,
    });
    expect(parsed.port).toBe(2525);
  });

  it('rejects a custom provider without host/port/secure', () => {
    const result = emailConfigSchema.safeParse({ provider: 'custom', ...base });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toEqual(expect.arrayContaining(['host', 'port', 'secure']));
    }
  });

  it('rejects an invalid from email', () => {
    const result = emailConfigSchema.safeParse({ provider: 'gmail', ...base, fromEmail: 'nope' });
    expect(result.success).toBe(false);
  });
});
