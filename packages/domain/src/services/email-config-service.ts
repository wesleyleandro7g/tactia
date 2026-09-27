import type { CredentialRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { ZodError } from 'zod';
import { assertCanManageConnections, assertTenantScope } from '../authz';
import { AuditAction, type AuditLogService } from './audit-log-service';
import { emailConfigSchema, type EmailConfigInput, type SmtpProviderId } from '../schemas/email';
import { encrypt, decrypt } from './credential-service';

/** The `Credential.provider` value used to store the tenant's email config. */
export const EMAIL_CREDENTIAL_PROVIDER = 'smtp_email';

/** Stored (decrypted) email configuration payload. */
export type StoredEmailConfig = {
  provider: SmtpProviderId;
  fromName?: string;
  fromEmail: string;
  username: string;
  password: string;
  host?: string;
  port?: number;
  secure?: boolean;
};

/** Public view of the config — never exposes the password. */
export type EmailConfigView = {
  configured: boolean;
  provider?: SmtpProviderId;
  fromName?: string;
  fromEmail?: string;
  username?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  /** True when a password is stored (so the UI can show "configurada"). */
  hasPassword: boolean;
  updatedAt?: string;
};

function toStored(input: EmailConfigInput): StoredEmailConfig {
  return {
    provider: input.provider,
    fromEmail: input.fromEmail,
    username: input.username,
    password: input.password,
    ...(input.fromName ? { fromName: input.fromName } : {}),
    ...(input.host ? { host: input.host } : {}),
    ...(input.port !== undefined ? { port: input.port } : {}),
    ...(input.secure !== undefined ? { secure: input.secure } : {}),
  };
}

/**
 * Manages the per-tenant SMTP email configuration, persisted as a single
 * encrypted `Credential` (provider `smtp_email`). Reads never leak the
 * password; sending resolves the full config via `getResolvedForSending`.
 */
export class EmailConfigService {
  constructor(
    private readonly credentials: CredentialRepository,
    private readonly auditLogs?: AuditLogService,
  ) {}

  /** Operator/tenant-scoped read that masks the password. */
  async get(ctx: RequestContext): Promise<EmailConfigView> {
    assertTenantScope(ctx);
    const cred = await this.credentials.findByProvider({
      tenantId: ctx.tenantId!,
      provider: EMAIL_CREDENTIAL_PROVIDER,
    });
    if (!cred) return { configured: false, hasPassword: false };

    const stored = JSON.parse(decrypt(cred.encryptedData)) as StoredEmailConfig;
    return {
      configured: true,
      provider: stored.provider,
      fromEmail: stored.fromEmail,
      username: stored.username,
      hasPassword: Boolean(stored.password),
      ...(stored.fromName ? { fromName: stored.fromName } : {}),
      ...(stored.host ? { host: stored.host } : {}),
      ...(stored.port !== undefined ? { port: stored.port } : {}),
      ...(stored.secure !== undefined ? { secure: stored.secure } : {}),
      updatedAt: (cred.updatedAt ?? cred.createdAt).toISOString(),
    };
  }

  /** Validates and stores the config, keeping a single record per tenant. */
  async save(ctx: RequestContext, raw: unknown): Promise<EmailConfigView> {
    assertCanManageConnections(ctx);
    let parsed;
    try {
      parsed = emailConfigSchema.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Configuração de e-mail inválida',
          error.flatten(),
        );
      }
      throw error;
    }
    const stored = toStored(parsed);

    // Enforce a single email config per tenant: drop the previous one first.
    await this.credentials.deleteByProvider({
      tenantId: ctx.tenantId!,
      provider: EMAIL_CREDENTIAL_PROVIDER,
    });
    const cred = await this.credentials.create({
      tenantId: ctx.tenantId!,
      provider: EMAIL_CREDENTIAL_PROVIDER,
      encryptedData: encrypt(JSON.stringify(stored)),
    });

    await this.auditLogs?.record(ctx, {
      action: AuditAction.DATA_SOURCE_UPDATED,
      entityType: 'email_config',
      entityId: cred.id,
      metadata: { provider: stored.provider },
    });

    return this.get(ctx);
  }

  /** Removes the tenant's email config. */
  async delete(ctx: RequestContext): Promise<{ removed: boolean }> {
    assertCanManageConnections(ctx);
    const count = await this.credentials.deleteByProvider({
      tenantId: ctx.tenantId!,
      provider: EMAIL_CREDENTIAL_PROVIDER,
    });
    if (count > 0) {
      await this.auditLogs?.record(ctx, {
        action: AuditAction.DATA_SOURCE_DELETED,
        entityType: 'email_config',
        entityId: ctx.tenantId!,
      });
    }
    return { removed: count > 0 };
  }

  /**
   * Full (decrypted) config for actually sending. Returns null when the tenant
   * has not configured email, so callers can fall back to a no-op driver.
   */
  async getResolvedForSending(ctx: RequestContext): Promise<StoredEmailConfig | null> {
    assertTenantScope(ctx);
    const cred = await this.credentials.findByProvider({
      tenantId: ctx.tenantId!,
      provider: EMAIL_CREDENTIAL_PROVIDER,
    });
    if (!cred) return null;
    return JSON.parse(decrypt(cred.encryptedData)) as StoredEmailConfig;
  }

  /** Same as above but resolving by tenant id (no request context). */
  async getResolvedForTenant(tenantId: string): Promise<StoredEmailConfig | null> {
    if (!tenantId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenantId is required');
    const cred = await this.credentials.findByProvider({
      tenantId,
      provider: EMAIL_CREDENTIAL_PROVIDER,
    });
    if (!cred) return null;
    return JSON.parse(decrypt(cred.encryptedData)) as StoredEmailConfig;
  }
}
