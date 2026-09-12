import { createId } from '@tactia/shared';
import type { MembershipRole } from '@tactia/shared';
import type { Prisma, PrismaClient } from '../client';

export type CreateTenantApiKeyInput = {
  tenantId: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string[];
  role: MembershipRole;
  createdBy: string;
};

const publicSelect = {
  id: true,
  tenantId: true,
  name: true,
  prefix: true,
  scopes: true,
  role: true,
  createdBy: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

export type TenantApiKeyPublic = Prisma.TenantApiKeyGetPayload<{ select: typeof publicSelect }>;

export class TenantApiKeyRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateTenantApiKeyInput) {
    return this.db.tenantApiKey.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        name: input.name,
        prefix: input.prefix,
        hash: input.hash,
        scopes: input.scopes,
        role: input.role,
        createdBy: input.createdBy,
      },
      select: publicSelect,
    });
  }

  async list({ tenantId }: { tenantId: string }) {
    return this.db.tenantApiKey.findMany({
      where: { tenantId },
      select: publicSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.tenantApiKey.findFirst({
      where: { id, tenantId },
      select: publicSelect,
    });
  }

  async findByPrefix(prefix: string) {
    return this.db.tenantApiKey.findUnique({ where: { prefix } });
  }

  async revoke({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing || existing.revokedAt) return existing;
    return this.db.tenantApiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: publicSelect,
    });
  }

  async touchLastUsed(id: string) {
    return this.db.tenantApiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
      select: { id: true },
    });
  }
}
