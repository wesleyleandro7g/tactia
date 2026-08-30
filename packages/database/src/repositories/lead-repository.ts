import { createId } from '@tactia/shared';
import type { LeadStatus, Prisma, PrismaClient } from '../client';

export type CreateLeadInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  customerId?: string | null;
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

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.lead.delete({ where: { id } });
    return existing;
  }
}
