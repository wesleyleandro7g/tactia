import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type CreateCredentialInput = {
  tenantId: string;
  provider: string;
  encryptedData: string;
};

export class CredentialRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateCredentialInput) {
    return this.db.credential.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        provider: input.provider,
        encryptedData: input.encryptedData,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.credential.findFirst({ where: { id, tenantId } });
  }

  async updateEncryptedDataIfCurrent(input: {
    tenantId: string;
    id: string;
    currentEncryptedData: string;
    encryptedData: string;
  }) {
    return this.db.credential.updateMany({
      where: {
        id: input.id,
        tenantId: input.tenantId,
        encryptedData: input.currentEncryptedData,
      },
      data: { encryptedData: input.encryptedData },
    });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.credential.delete({ where: { id } });
  }
}
