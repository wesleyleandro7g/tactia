import { createId } from '@tactia/shared';
import type { ActionType, PrismaClient } from '../client';
import { asJson } from '../json';

export type CreateActionInput = {
  tenantId: string;
  type: ActionType;
  name: string;
  description?: string | null;
  configuration?: unknown;
  requiresApproval?: boolean;
  enabled?: boolean;
};

export type UpdateActionInput = {
  name?: string;
  description?: string | null;
  configuration?: unknown;
  requiresApproval?: boolean;
  enabled?: boolean;
};

export class ActionRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateActionInput) {
    return this.db.action.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        type: input.type,
        name: input.name,
        description: input.description ?? null,
        configuration: asJson(input.configuration ?? {}) as never,
        ...(input.requiresApproval === undefined
          ? {}
          : { requiresApproval: input.requiresApproval }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.action.findFirst({ where: { id, tenantId } });
  }

  /** One action definition per type per tenant (catalog semantics). */
  async findByType({ tenantId, type }: { tenantId: string; type: ActionType }) {
    return this.db.action.findFirst({ where: { tenantId, type } });
  }

  async list({
    tenantId,
    enabled,
    page = 1,
    pageSize = 20,
  }: {
    tenantId: string;
    enabled?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const where = { tenantId, ...(enabled === undefined ? {} : { enabled }) };
    const [total, items] = await Promise.all([
      this.db.action.count({ where }),
      this.db.action.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, items, page, pageSize };
  }

  async update({ tenantId, id }: { tenantId: string; id: string }, input: UpdateActionInput) {
    return this.db.action.update({
      where: { id, tenantId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.configuration === undefined
          ? {}
          : { configuration: asJson(input.configuration) as never }),
        ...(input.requiresApproval === undefined
          ? {}
          : { requiresApproval: input.requiresApproval }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      },
    });
  }
}
