import { createId } from '@tactia/shared';
import {
  Prisma,
  type MediaAssetPurpose,
  type MediaAssetStatus,
  type PrismaClient,
} from '../client';

export type CreateMediaAssetInput = {
  id?: string;
  tenantId: string;
  purpose?: MediaAssetPurpose;
  mime: string;
  storageKey: string;
  checksum: string;
  byteSize: number;
  uploadedBy?: string | null;
};

export type MediaAssetRecord = {
  id: string;
  tenantId: string;
  purpose: MediaAssetPurpose;
  mime: string;
  storageKey: string;
  checksum: string;
  byteSize: number;
  status: MediaAssetStatus;
  error: string | null;
  classification: string | null;
  resultKind: string | null;
  resultId: string | null;
  uploadedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const mediaSelect = {
  id: true,
  tenantId: true,
  purpose: true,
  mime: true,
  storageKey: true,
  checksum: true,
  byteSize: true,
  status: true,
  error: true,
  classification: true,
  resultKind: true,
  resultId: true,
  uploadedBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MediaAssetSelect;

export class MediaAssetRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateMediaAssetInput): Promise<MediaAssetRecord> {
    return this.db.mediaAsset.create({
      data: {
        id: input.id ?? createId(),
        tenantId: input.tenantId,
        purpose: input.purpose ?? 'auto',
        mime: input.mime,
        storageKey: input.storageKey,
        checksum: input.checksum,
        byteSize: input.byteSize,
        uploadedBy: input.uploadedBy ?? null,
      },
      select: mediaSelect,
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.mediaAsset.findFirst({
      where: { id, tenantId },
      select: mediaSelect,
    });
  }

  async list({
    tenantId,
    skip,
    take,
    status,
  }: {
    tenantId: string;
    skip: number;
    take: number;
    status?: MediaAssetStatus;
  }) {
    const where: Prisma.MediaAssetWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.mediaAsset.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: mediaSelect,
      }),
      this.db.mediaAsset.count({ where }),
    ]);
    return { items, total };
  }

  async update({
    tenantId,
    id,
    data,
  }: {
    tenantId: string;
    id: string;
    data: {
      status?: MediaAssetStatus;
      error?: string | null;
      classification?: string | null;
      resultKind?: string | null;
      resultId?: string | null;
    };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.mediaAsset.update({
      where: { id },
      data,
      select: mediaSelect,
    });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.mediaAsset.delete({ where: { id } });
    return existing;
  }
}
