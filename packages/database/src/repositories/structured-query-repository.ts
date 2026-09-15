import { Prisma, type PrismaClient } from '../client';

const STATEMENT_TIMEOUT_MS = 3000;

export class StructuredQueryRepository {
  constructor(private readonly db: PrismaClient) {}

  async query<T extends Record<string, unknown>>(sql: Prisma.Sql): Promise<T[]> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`;
      return tx.$queryRaw<T[]>(sql);
    });
  }
}
