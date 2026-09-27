import { describe, expect, it, vi } from 'vitest';
import { TenantAwareEmailSender, type StoredEmailConfigLike } from '../tenant-aware-email-sender';
import { MemoryEmailSender } from '../email-sender';
import type { SmtpTransport } from '../smtp-email-sender';

function fakeTransport() {
  const sendMail = vi.fn(async () => ({ messageId: '<via-smtp>' }));
  const verify = vi.fn(async () => true as const);
  const transport: SmtpTransport = { sendMail, verify };
  return { transport, sendMail };
}

const gmailConfig: StoredEmailConfigLike = {
  provider: 'gmail',
  fromEmail: 'noreply@acme.dev',
  username: 'noreply@acme.dev',
  password: 'app-pass',
};

describe('TenantAwareEmailSender', () => {
  it('sends via the tenant SMTP config when present', async () => {
    const { transport, sendMail } = fakeTransport();
    const fallback = new MemoryEmailSender();
    const sender = new TenantAwareEmailSender({
      resolve: async (tenantId) => (tenantId === 'tenant-1' ? gmailConfig : null),
      fallback,
      transportFactory: () => transport,
    });

    const result = await sender.send(
      { to: 'client@example.com', subject: 'Oi', body: 'Corpo' },
      { tenantId: 'tenant-1' },
    );

    expect(result.driver).toBe('smtp');
    expect(sendMail).toHaveBeenCalledOnce();
    expect(fallback.sent).toHaveLength(0);
  });

  it('falls back when the tenant has no config', async () => {
    const fallback = new MemoryEmailSender();
    const sender = new TenantAwareEmailSender({
      resolve: async () => null,
      fallback,
    });

    const result = await sender.send(
      { to: 'client@example.com', subject: 'Oi', body: 'Corpo' },
      { tenantId: 'tenant-x' },
    );

    expect(result.driver).toBe('memory');
    expect(fallback.sent).toHaveLength(1);
  });

  it('falls back when no tenant is provided', async () => {
    const fallback = new MemoryEmailSender();
    const resolve = vi.fn(async () => gmailConfig);
    const sender = new TenantAwareEmailSender({ resolve, fallback });

    await sender.send({ to: 'client@example.com', subject: 'Oi', body: 'Corpo' });

    expect(resolve).not.toHaveBeenCalled();
    expect(fallback.sent).toHaveLength(1);
  });
});
