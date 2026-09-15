import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient } from '../client';

export type CreateInfographicAssetInput = {
  id?: string;
  tenantId: string;
  title: string;
  template: string;
  mime: string;
  storageKey: string;
  byteSize: number;
  width: number;
  height: number;
  createdBy?: string | null;
};

export type InfographicAssetRecord = {
  id: string;
  tenantId: string;
  title: string;
  template: string;
  mime: string;
  storageKey: string;
  byteSize: number;
  width: number;
  height: number;
  createdBy: string | null;
  createdAt: Date;
};

const select = {
  id: true,
  tenantId: true,
  title: true,
  template: true,
  mime: true,
  storageKey: true,
  byteSize: true,
  width: true,
  height: true,
  createdBy: true,
  createdAt: true,
} satisfies Prisma.InfographicAssetSelect;

export class InfographicAssetRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateInfographicAssetInput): Promise<InfographicAssetRecord> {
    return this.db.infographicAsset.create({
      data: {
        id: input.id ?? createId(),
        tenantId: input.tenantId,
        title: input.title,
        template: input.template,
        mime: input.mime,
        storageKey: input.storageKey,
        byteSize: input.byteSize,
        width: input.width,
        height: input.height,
        createdBy: input.createdBy ?? null,
      },
      select,
    });
  }

  async findById({
    tenantId,
    id,
  }: {
    tenantId: string;
    id: string;
  }): Promise<InfographicAssetRecord | null> {
    return this.db.infographicAsset.findFirst({
      where: { id, tenantId },
      select,
    });
  }
}
