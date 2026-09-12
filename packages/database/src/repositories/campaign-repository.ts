import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient } from '../client';

export type CreateCampaignInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  name: string;
  source: string;
  spend: number;
  startsAt: Date;
  endsAt?: Date | null;
};

export class CampaignRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateCampaignInput) {
    return this.db.campaign.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId ?? null,
        externalId: input.externalId ?? null,
        name: input.name,
        source: input.source,
        spend: input.spend,
        startsAt: input.startsAt,
        endsAt: input.endsAt ?? null,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.campaign.findFirst({ where: { id, tenantId } });
  }

  async list({
    tenantId,
    skip,
    take,
  }: {
    tenantId: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.CampaignWhereInput = { tenantId };
    const [items, total] = await Promise.all([
      this.db.campaign.findMany({
        where,
        skip,
        take,
        orderBy: { startsAt: 'desc' },
      }),
      this.db.campaign.count({ where }),
    ]);
    return { items, total };
  }

  async upsertByExternalId(
    input: CreateCampaignInput & { dataSourceId: string; externalId: string },
  ) {
    const existing = await this.db.campaign.findFirst({
      where: {
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        externalId: input.externalId,
      },
    });

    if (existing) {
      const updated = await this.db.campaign.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          source: input.source,
          spend: input.spend,
          startsAt: input.startsAt,
          endsAt: input.endsAt ?? null,
        },
      });
      return { entity: updated, created: false };
    }

    const created = await this.create(input);
    return { entity: created, created: true };
  }
}
