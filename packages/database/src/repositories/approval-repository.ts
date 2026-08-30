import { createId } from '@tactia/shared';
import type { ApprovalStatus, PrismaClient } from '../client';

export type CreateApprovalInput = {
  tenantId: string;
  actionExecutionId: string;
  requestedBy?: string | null;
  reason?: string | null;
};

export type ResolveApprovalInput = {
  status: Extract<ApprovalStatus, 'approved' | 'rejected'>;
  approvedBy?: string | null;
  reason?: string | null;
};

export class ApprovalRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateApprovalInput) {
    return this.db.approval.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        actionExecutionId: input.actionExecutionId,
        requestedBy: input.requestedBy ?? null,
        reason: input.reason ?? null,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.approval.findFirst({
      where: { id, tenantId },
      include: { actionExecution: { include: { action: true } } },
    });
  }

  async findPendingByExecution({
    tenantId,
    actionExecutionId,
  }: {
    tenantId: string;
    actionExecutionId: string;
  }) {
    return this.db.approval.findFirst({
      where: { tenantId, actionExecutionId, status: 'pending' },
    });
  }

  async list({
    tenantId,
    status,
    page = 1,
    pageSize = 20,
  }: {
    tenantId: string;
    status?: ApprovalStatus;
    page?: number;
    pageSize?: number;
  }) {
    const where = { tenantId, ...(status ? { status } : {}) };
    const [total, items] = await Promise.all([
      this.db.approval.count({ where }),
      this.db.approval.findMany({
        where,
        include: { actionExecution: { include: { action: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, items, page, pageSize };
  }

  async resolve(
    { tenantId, id }: { tenantId: string; id: string },
    input: ResolveApprovalInput,
  ) {
    return this.db.approval.update({
      where: { id, tenantId },
      data: {
        status: input.status,
        approvedBy: input.approvedBy ?? null,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        resolvedAt: new Date(),
      },
    });
  }
}
