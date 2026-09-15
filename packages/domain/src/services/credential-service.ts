import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { CredentialRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertCanManageConnections, assertTenantScope } from '../authz';
import { createCredentialSchema } from '../schemas/data-platform';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env['ENCRYPTION_KEY'];
  if (!hex) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'ENCRYPTION_KEY environment variable is not set');
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export class CredentialService {
  constructor(private readonly credentials: CredentialRepository) {}

  async create(ctx: RequestContext, raw: unknown) {
    assertCanManageConnections(ctx);
    const { provider, data } = createCredentialSchema.parse(raw);
    const encryptedData = encrypt(JSON.stringify(data));
    return this.credentials.create({
      tenantId: ctx.tenantId!,
      provider,
      encryptedData,
    });
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantScope(ctx);
    const cred = await this.credentials.findById({ tenantId: ctx.tenantId!, id });
    if (!cred) throw new AppError(ErrorCode.NOT_FOUND, 'Credential not found');
    // Never expose decrypted data via the public get
    return { id: cred.id, provider: cred.provider, createdAt: cred.createdAt };
  }

  async getDecryptedData(ctx: RequestContext, id: string): Promise<Record<string, unknown>> {
    assertTenantScope(ctx);
    const cred = await this.credentials.findById({ tenantId: ctx.tenantId!, id });
    if (!cred) throw new AppError(ErrorCode.NOT_FOUND, 'Credential not found');
    return JSON.parse(decrypt(cred.encryptedData)) as Record<string, unknown>;
  }

  async delete(ctx: RequestContext, id: string) {
    assertCanManageConnections(ctx);
    const cred = await this.credentials.delete({ tenantId: ctx.tenantId!, id });
    if (!cred) throw new AppError(ErrorCode.NOT_FOUND, 'Credential not found');
    return cred;
  }
}
