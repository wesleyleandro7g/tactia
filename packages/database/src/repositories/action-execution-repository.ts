import { createId } from '@tactia/shared';
import type { ActionExecutionStatus, PrismaClient } from '../client';
import { asJson, asNullableJson } from '../json';

export type CreateActionExecutionInput = {
  tenantId: string;
  actionId: string;
  requestedBy?: string | null;
  /** user | ai | system | mcp */
  origin?: string;
  status: ActionExecutionStatus;
  input: unknown;
  idempotencyKey?: string | null;
};

export type UpdateActionExecutionInput = {
  status?: ActionExecutionStatus;
  output?: unknown;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export class ActionExecutionRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateActionExecutionInput) {
    return this.db.actionExecution.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        actionId: input.actionId,
        requestedBy: input.requestedBy ?? null,
        origin: input.origin ?? 'user',
        status: input.status,
        input: asJson(input.input ?? {}) as never,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.actionExecution.findFirst({
      where: { id, tenantId },
      include: { action: true, approvals: { orderBy: { createdAt: 'desc' } } },
    });
  }

  /** Idempotency-Key lookup, always scoped by tenant (spec §52). */
  async findByIdempotencyKey({ tenantId, key }: { tenantId: string; key: string }) {
    return this.db.actionExecution.findFirst({
      where: { tenantId, idempotencyKey: key },
      include: { action: true, approvals: { orderBy: { createdAt: 'desc' } } },
    });
  }

  async list({
    tenantId,
    status,
    actionId,
    page = 1,
    pageSize = 20,
  }: {
    tenantId: string;
    status?: ActionExecutionStatus;
    actionId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where = {
      tenantId,
      ...(status ? { status } : {}),
      ...(actionId ? { actionId } : {}),
    };
    const [total, items] = await Promise.all([
      this.db.actionExecution.count({ where }),
      this.db.actionExecution.findMany({
        where,
        include: { action: true, approvals: { orderBy: { createdAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, items, page, pageSize };
  }

  async update(
    { tenantId, id }: { tenantId: string; id: string },
    input: UpdateActionExecutionInput,
  ) {
    return this.db.actionExecution.update({
      where: { id, tenantId },
      data: {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.output === undefined ? {} : { output: asNullableJson(input.output) }),
        ...(input.error === undefined ? {} : { error: input.error }),
        ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
        ...(input.finishedAt === undefined ? {} : { finishedAt: input.finishedAt }),
      },
    });
  }
}
