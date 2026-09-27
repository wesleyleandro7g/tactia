import { createId } from '@tactia/shared';
import type { PrismaClient, DataSourceStatus } from '../client';
import { asNullableJson } from '../json';

export type DataSourceType = string;

export type CreateDataSourceInput = {
  tenantId: string;
  type: DataSourceType;
  name: string;
  status?: DataSourceStatus;
  configuration?: Record<string, unknown> | null;
  credentialId?: string | null;
};

export class DataSourceRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateDataSourceInput) {
    return this.db.dataSource.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        type: input.type,
        name: input.name,
        status: input.status ?? 'active',
        configuration: input.configuration ? asNullableJson(input.configuration) : undefined,
        credentialId: input.credentialId ?? null,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.dataSource.findFirst({
      where: { id, tenantId, status: { not: 'inactive' } },
      include: { credential: true },
    });
  }

  async findOwned({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.dataSource.findFirst({ where: { id, tenantId } });
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
    status?: DataSourceStatus;
    search?: string;
  }) {
    const where = {
      tenantId,
      ...(status ? { status } : { status: { not: 'inactive' as DataSourceStatus } }),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.dataSource.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.dataSource.count({ where }),
    ]);
    return { items, total };
  }


  async listActiveTrello(tenantId: string) {
    return this.db.dataSource.findMany({
      where: { tenantId, status: 'active', type: 'trello' },
      orderBy: { createdAt: 'asc' },
    });
  }
  async listActiveForSync(tenantId: string) {
    return this.db.dataSource.findMany({
      where: {
        tenantId,
        status: { not: 'inactive' },
        type: { in: ['postgres', 'mysql', 'database'] },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listActiveBrowserForSchedule() {
    return this.db.dataSource.findMany({
      where: { type: 'torge', status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update({
    tenantId,
    id,
    data,
  }: {
    tenantId: string;
    id: string;
    data: {
      name?: string;
      status?: DataSourceStatus;
      configuration?: Record<string, unknown> | null;
      credentialId?: string | null;
    };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.dataSource.update({
      where: { id },
      data: {
        name: data.name,
        status: data.status,
        configuration:
          data.configuration !== undefined ? asNullableJson(data.configuration) : undefined,
        credentialId: data.credentialId,
      },
    });
  }

  async softDelete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.dataSource.update({
      where: { id },
      data: { status: 'inactive' },
    });
  }

  async updateLastSyncAt({ id, lastSyncAt }: { id: string; lastSyncAt: Date }) {
    return this.db.dataSource.update({
      where: { id },
      data: { lastSyncAt },
    });
  }

  async findOrCreateSystem({
    tenantId,
    type,
    name,
  }: {
    tenantId: string;
    type: DataSourceType;
    name: string;
  }) {
    const existing = await this.db.dataSource.findFirst({
      where: { tenantId, type, status: { not: 'inactive' } },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    return this.create({
      tenantId,
      type,
      name,
      configuration: { system: true },
    });
  }
}
