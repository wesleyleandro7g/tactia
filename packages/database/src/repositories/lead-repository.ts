import { createId } from '@tactia/shared';
import type { LeadStatus, Prisma, PrismaClient } from '../client';

export type CreateLeadInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  customerId?: string | null;
  sellerId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status?: LeadStatus;
  score?: number | null;
};

export class LeadRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateLeadInput) {
    return this.db.lead.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId ?? null,
        externalId: input.externalId ?? null,
        customerId: input.customerId ?? null,
        sellerId: input.sellerId ?? null,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        source: input.source ?? null,
        status: input.status ?? 'new',
        score: input.score ?? null,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.lead.findFirst({ where: { id, tenantId } });
  }

  async list({
    tenantId,
    skip,
    take,
    status,
    search,
  }: {
    tenantId: string;
    skip: number;
    take: number;
    status?: LeadStatus;
    search?: string;
  }) {
    const where: Prisma.LeadWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.lead.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.lead.count({ where }),
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
      customerId?: string | null;
      sellerId?: string | null;
      name?: string;
      email?: string | null;
      phone?: string | null;
      source?: string | null;
      status?: LeadStatus;
      score?: number | null;
      externalId?: string | null;
    };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.lead.update({ where: { id }, data });
  }

  async findByExternalId({
    tenantId,
    dataSourceId,
    externalId,
  }: {
    tenantId: string;
    dataSourceId?: string;
    externalId: string;
  }) {
    return this.db.lead.findFirst({
      where: {
        tenantId,
        externalId,
        ...(dataSourceId ? { dataSourceId } : {}),
      },
      select: { id: true, status: true },
    });
  }

  /**
   * Upsert by `(tenantId, dataSourceId, externalId)`. Status changes write a
   * LeadStageTransition so the funnel can measure time-in-stage on import.
   */
  async upsertByExternalId(input: CreateLeadInput & { dataSourceId: string; externalId: string }) {
    const existing = await this.db.lead.findFirst({
      where: {
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        externalId: input.externalId,
      },
    });

    if (existing) {
      const nextStatus = input.status ?? existing.status;
      const updated = await this.db.lead.update({
        where: { id: existing.id },
        data: {
          customerId: input.customerId ?? null,
          sellerId: input.sellerId ?? null,
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          source: input.source ?? null,
          status: nextStatus,
          score: input.score ?? null,
        },
      });
      if (nextStatus !== existing.status) {
        await this.db.leadStageTransition.create({
          data: {
            id: createId(),
            tenantId: input.tenantId,
            leadId: existing.id,
            fromStatus: existing.status,
            toStatus: nextStatus,
            occurredAt: new Date(),
            sellerId: updated.sellerId ?? existing.sellerId,
          },
        });
      }
      return { entity: updated, created: false };
    }

    const created = await this.create(input);
    if (created.status !== 'new') {
      await this.db.leadStageTransition.create({
        data: {
          id: createId(),
          tenantId: input.tenantId,
          leadId: created.id,
          fromStatus: 'new',
          toStatus: created.status,
          occurredAt: new Date(),
          sellerId: created.sellerId,
        },
      });
    }
    return { entity: created, created: true };
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.lead.delete({ where: { id } });
    return existing;
  }
}
