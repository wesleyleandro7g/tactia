import type { TenantApiKeyRepository } from '@tactia/database';
import { AppError, ErrorCode, type MembershipRole, type RequestContext } from '@tactia/shared';
import { assertOwnerOrAdmin } from '../authz';
import { createApiKeySchema, type ApiKeyScope } from '../schemas/api-keys';
import { AuditAction, type AuditLogService } from './audit-log-service';
import {
  generateTenantApiKeySecret,
  hashApiKeySecret,
  parseTenantApiKeyToken,
  verifyApiKeySecret,
} from './tenant-api-key-crypto';

const DEFAULT_SCOPES: ApiKeyScope[] = ['tools:read'];
const TOUCH_INTERVAL_MS = 60_000;
const lastTouch = new Map<string, number>();

export type VerifiedTenantApiKey = {
  keyId: string;
  tenantId: string;
  userId: string;
  role: MembershipRole;
  scopes: string[];
  prefix: string;
};

export class TenantApiKeyService {
  constructor(
    private readonly keys: TenantApiKeyRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async create(ctx: RequestContext, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = createApiKeySchema.parse(raw);
    const scopes = uniqueScopes(input.scopes ?? DEFAULT_SCOPES);
    const row = await this.createWithUniquePrefix(ctx, input.name, scopes);

    await this.auditLogs.record(ctx, {
      action: AuditAction.API_KEY_CREATED,
      entityType: 'tenant_api_key',
      entityId: row.id,
      metadata: { name: row.name, prefix: row.prefix, scopes: row.scopes, role: row.role },
    });

    return row;
  }

  private async createWithUniquePrefix(
    ctx: RequestContext & { tenantId: string; userId: string; role: MembershipRole },
    name: string,
    scopes: ApiKeyScope[],
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { prefix, secret } = generateTenantApiKeySecret();
      const hash = await hashApiKeySecret(secret);
      try {
        const row = await this.keys.create({
          tenantId: ctx.tenantId,
          name,
          prefix,
          hash,
          scopes,
          role: ctx.role,
          createdBy: ctx.userId,
        });
        return { ...row, secret };
      } catch (error) {
        if (attempt === 4 || !isUniqueViolation(error)) throw error;
      }
    }
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Could not issue API key');
  }

  async list(ctx: RequestContext) {
    assertOwnerOrAdmin(ctx);
    return this.keys.list({ tenantId: ctx.tenantId });
  }

  async revoke(ctx: RequestContext, id: string) {
    assertOwnerOrAdmin(ctx);
    const existing = await this.keys.findById({ tenantId: ctx.tenantId, id });
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'API key not found');
    if (existing.revokedAt) return existing;
    const row = await this.keys.revoke({ tenantId: ctx.tenantId, id });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'API key not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.API_KEY_REVOKED,
      entityType: 'tenant_api_key',
      entityId: row.id,
      metadata: { prefix: row.prefix },
    });
    return row;
  }

  async verify(token: string): Promise<VerifiedTenantApiKey | null> {
    const parsed = parseTenantApiKeyToken(token);
    const row = parsed ? await this.keys.findByPrefix(parsed.prefix) : null;
    const storedHash = row && !row.revokedAt ? row.hash : null;
    const ok = await verifyApiKeySecret(token, storedHash);
    if (!ok || !row || row.revokedAt) return null;
    if (row.tenant.status !== 'active') return null;
    return {
      keyId: row.id,
      tenantId: row.tenantId,
      userId: row.createdBy,
      role: row.role,
      scopes: row.scopes,
      prefix: row.prefix,
    };
  }

  touchLastUsed(keyId: string): void {
    const now = Date.now();
    const previous = lastTouch.get(keyId) ?? 0;
    if (now - previous < TOUCH_INTERVAL_MS) return;
    lastTouch.set(keyId, now);
    void this.keys.touchLastUsed(keyId).catch(() => undefined);
  }
}

function uniqueScopes(scopes: ApiKeyScope[]): ApiKeyScope[] {
  return [...new Set(scopes)];
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}
