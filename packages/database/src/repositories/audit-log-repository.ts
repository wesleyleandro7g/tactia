import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';
import { asJson } from '../json';

export type CreateAuditLogInput = {
  tenantId: string;
  userId?: string | null;
  operatorId?: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: unknown;
  ip?: string | null;
};

export class AuditLogRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateAuditLogInput) {
    return this.db.auditLog.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        operatorId: input.operatorId ?? null,
        actorType: input.actorType,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: asJson(input.metadata),
        ip: input.ip ?? null,
      },
    });
  }

  async list({
    tenantId,
    skip,
    take,
    action,
    entityType,
  }: {
    tenantId: string;
    skip: number;
    take: number;
    action?: string;
    entityType?: string;
  }) {
    const where = {
      tenantId,
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
    };

    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.auditLog.count({ where }),
    ]);

    return { items, total };
  }
}
