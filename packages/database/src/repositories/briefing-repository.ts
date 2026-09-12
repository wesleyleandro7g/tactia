import { createId } from '@tactia/shared';
import type { Prisma, PrismaClient } from '../client';

export type CreateBriefingInput = {
  tenantId: string;
  periodFrom: Date;
  periodTo: Date;
  content: string;
  facts: unknown;
  sources: unknown;
  model: string;
};

export class BriefingRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateBriefingInput) {
    return this.db.briefing.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        content: input.content,
        facts: input.facts as Prisma.InputJsonValue,
        sources: input.sources as Prisma.InputJsonValue,
        model: input.model,
      },
    });
  }

  async findLatest({ tenantId }: { tenantId: string }) {
    return this.db.briefing.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async list({ tenantId, take = 12 }: { tenantId: string; take?: number }) {
    return this.db.briefing.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.briefing.findFirst({ where: { tenantId, id } });
  }
}
