import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type CreateIntegrationArtifactInput = {
  tenantId: string;
  dataSourceId: string;
  moduleRunId: string;
  origin: string;
  moduleKey: string;
  periodFrom?: Date | null;
  periodTo?: Date | null;
  checksum: string;
  mimeType: string;
  storageKey: string;
  byteSize: number;
  retentionUntil?: Date | null;
};

export class IntegrationArtifactRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsert(input: CreateIntegrationArtifactInput) {
    return this.db.integrationArtifact.upsert({
      where: {
        tenantId_checksum_moduleKey: {
          tenantId: input.tenantId,
          checksum: input.checksum,
          moduleKey: input.moduleKey,
        },
      },
      create: {
        id: createId(),
        ...input,
        periodFrom: input.periodFrom ?? null,
        periodTo: input.periodTo ?? null,
        retentionUntil: input.retentionUntil ?? null,
      },
      update: {
        moduleRunId: input.moduleRunId,
        dataSourceId: input.dataSourceId,
        origin: input.origin,
        mimeType: input.mimeType,
        storageKey: input.storageKey,
        byteSize: input.byteSize,
        retentionUntil: input.retentionUntil ?? null,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.integrationArtifact.findFirst({ where: { tenantId, id } });
  }
}
