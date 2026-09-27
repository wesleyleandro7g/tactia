import { describe, expect, it, vi } from 'vitest';
import {
  SmtpEmailSender,
  formatFromHeader,
  type ResolvedSmtpConfig,
  type SmtpTransport,
} from '../smtp-email-sender';

function fakeTransport(overrides: Partial<SmtpTransport> = {}) {
  const sendMail = vi.fn(async () => ({ messageId: '<abc@smtp>' }));
  const verify = vi.fn(async () => true as const);
  const transport: SmtpTransport = { sendMail, verify, ...overrides };
  return { transport, sendMail, verify };
}

describe('SmtpEmailSender', () => {
  it('sends via the injected transport and maps the result', async () => {
    const { transport, sendMail } = fakeTransport();
    const sender = SmtpEmailSender.fromStoredConfig(
      {
        provider: 'gmail',
        username: 'noreply@acme.dev',
        password: 'app-pass',
        fromEmail: 'noreply@acme.dev',
        fromName: 'Acme',
      },
      () => transport,
    );

    const result = await sender.send({
      to: 'client@example.com',
      subject: 'Olá',
      body: 'Corpo',
      cc: ['boss@example.com', 'other@example.com'],
    });

    expect(result).toEqual({ id: '<abc@smtp>', driver: 'smtp' });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Acme <noreply@acme.dev>',
      to: 'client@example.com',
      cc: 'boss@example.com, other@example.com',
      subject: 'Olá',
      text: 'Corpo',
    });
  });

  it('resolves the gmail preset host/port/secure', async () => {
    const factory = vi.fn((config: ResolvedSmtpConfig) => {
      expect(config).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true });
      return fakeTransport().transport;
    });
    const sender = SmtpEmailSender.fromStoredConfig(
      { provider: 'gmail', username: 'u', password: 'p', fromEmail: 'u@acme.dev' },
      factory,
    );
    await sender.send({ to: 'x@y.dev', subject: 's', body: 'b' });
    expect(factory).toHaveBeenCalledOnce();
  });

  it('uses custom host/port/secure when provided', async () => {
    const factory = vi.fn((config: ResolvedSmtpConfig) => {
      expect(config).toMatchObject({ host: 'mail.acme.dev', port: 2525, secure: false });
      return fakeTransport().transport;
    });
    const sender = SmtpEmailSender.fromStoredConfig(
      {
        provider: 'custom',
        host: 'mail.acme.dev',
        port: 2525,
        secure: false,
        username: 'u',
        password: 'p',
        fromEmail: 'u@acme.dev',
      },
      factory,
    );
    await sender.send({ to: 'x@y.dev', subject: 's', body: 'b' });
    expect(factory).toHaveBeenCalledOnce();
  });

  it('verify delegates to the transport', async () => {
    const { transport, verify } = fakeTransport();
    const sender = SmtpEmailSender.fromStoredConfig(
      { provider: 'gmail', username: 'u', password: 'p', fromEmail: 'u@acme.dev' },
      () => transport,
    );
    await expect(sender.verify()).resolves.toBe(true);
    expect(verify).toHaveBeenCalledOnce();
  });

  it('propagates verify failures', async () => {
    const { transport } = fakeTransport({
      verify: vi.fn(async () => {
        throw new Error('535 auth failed');
      }),
    });
    const sender = SmtpEmailSender.fromStoredConfig(
      { provider: 'gmail', username: 'u', password: 'bad', fromEmail: 'u@acme.dev' },
      () => transport,
    );
    await expect(sender.verify()).rejects.toThrow(/535 auth failed/);
  });

  it('formatFromHeader omits the name when absent', () => {
    expect(formatFromHeader({ fromEmail: 'u@acme.dev' })).toBe('u@acme.dev');
    expect(formatFromHeader({ fromEmail: 'u@acme.dev', fromName: 'Acme' })).toBe(
      'Acme <u@acme.dev>',
    );
  });
});
