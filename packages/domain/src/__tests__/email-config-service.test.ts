import { describe, expect, it, beforeEach } from 'vitest';
import { AppError } from '@tactia/shared';
import { EmailConfigService, EMAIL_CREDENTIAL_PROVIDER } from '../services/email-config-service';

type Row = {
  id: string;
  tenantId: string;
  provider: string;
  encryptedData: string;
  createdAt: Date;
  updatedAt: Date;
};

/** In-memory CredentialRepository double (only the methods the service uses). */
class FakeCredentialRepo {
  rows: Row[] = [];
  private seq = 0;

  async create(input: { tenantId: string; provider: string; encryptedData: string }) {
    const row: Row = {
      id: `cred-${++this.seq}`,
      tenantId: input.tenantId,
      provider: input.provider,
      encryptedData: input.encryptedData,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    this.rows.push(row);
    return row;
  }

  async findByProvider({ tenantId, provider }: { tenantId: string; provider: string }) {
    return this.rows.find((r) => r.tenantId === tenantId && r.provider === provider) ?? null;
  }

  async deleteByProvider({ tenantId, provider }: { tenantId: string; provider: string }) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.tenantId === tenantId && r.provider === provider));
    return before - this.rows.length;
  }
}

const operatorCtx = {
  tenantId: 'tenant-1',
  operatorId: 'op-1',
  userId: null,
  requestId: 'req-1',
} as never;

const gmailInput = {
  provider: 'gmail',
  fromName: 'Acme',
  fromEmail: 'noreply@acme.dev',
  username: 'noreply@acme.dev',
  password: 'app-password',
};

describe('EmailConfigService', () => {
  let repo: FakeCredentialRepo;
  let service: EmailConfigService;

  beforeEach(() => {
    repo = new FakeCredentialRepo();
    service = new EmailConfigService(repo as never);
  });

  it('returns not-configured when nothing is stored', async () => {
    const view = await service.get(operatorCtx);
    expect(view).toEqual({ configured: false, hasPassword: false });
  });

  it('saves and masks the password on read', async () => {
    const view = await service.save(operatorCtx, gmailInput);
    expect(view.configured).toBe(true);
    expect(view.provider).toBe('gmail');
    expect(view.fromEmail).toBe('noreply@acme.dev');
    expect(view.hasPassword).toBe(true);
    // Password must never appear in the public view.
    expect(JSON.stringify(view)).not.toContain('app-password');
  });

  it('keeps a single record per tenant on repeated saves', async () => {
    await service.save(operatorCtx, gmailInput);
    await service.save(operatorCtx, { ...gmailInput, fromName: 'Acme 2' });
    const stored = repo.rows.filter((r) => r.provider === EMAIL_CREDENTIAL_PROVIDER);
    expect(stored).toHaveLength(1);
    const view = await service.get(operatorCtx);
    expect(view.fromName).toBe('Acme 2');
  });

  it('resolves the full config for sending', async () => {
    await service.save(operatorCtx, gmailInput);
    const resolved = await service.getResolvedForSending(operatorCtx);
    expect(resolved).toMatchObject({
      provider: 'gmail',
      username: 'noreply@acme.dev',
      password: 'app-password',
      fromEmail: 'noreply@acme.dev',
    });
  });

  it('stores custom host/port/secure', async () => {
    await service.save(operatorCtx, {
      provider: 'custom',
      fromEmail: 'noreply@acme.dev',
      username: 'noreply@acme.dev',
      password: 'secret',
      host: 'mail.acme.dev',
      port: 587,
      secure: false,
    });
    const view = await service.get(operatorCtx);
    expect(view).toMatchObject({ host: 'mail.acme.dev', port: 587, secure: false });
  });

  it('deletes the config', async () => {
    await service.save(operatorCtx, gmailInput);
    expect(await service.delete(operatorCtx)).toEqual({ removed: true });
    expect(await service.get(operatorCtx)).toEqual({ configured: false, hasPassword: false });
  });

  it('rejects an unscoped context', async () => {
    const unscoped = { requestId: 'req' } as never;
    await expect(service.get(unscoped)).rejects.toBeInstanceOf(AppError);
  });
});
