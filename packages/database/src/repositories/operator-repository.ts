import { createId } from '@tactia/shared';
import type { Prisma, PrismaClient, OperatorStatus } from '../client';

export type CreateOperatorInput = {
  externalAuthId: string;
  name: string;
  email: string;
};

export class OperatorRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateOperatorInput) {
    return this.db.operator.create({
      data: {
        id: createId(),
        externalAuthId: input.externalAuthId,
        name: input.name,
        email: input.email,
      },
    });
  }

  async findById(id: string) {
    return this.db.operator.findUnique({ where: { id } });
  }

  async findByExternalAuthId(externalAuthId: string) {
    return this.db.operator.findUnique({ where: { externalAuthId } });
  }

  async findByEmail(email: string) {
    return this.db.operator.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
  }

  async list() {
    return this.db.operator.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async countByStatus(status: OperatorStatus) {
    return this.db.operator.count({ where: { status } });
  }

  async updateStatus(id: string, status: OperatorStatus) {
    return this.db.operator.update({
      where: { id },
      data: { status },
    });
  }
}

export type OperatorRecord = Prisma.OperatorGetPayload<object>;
