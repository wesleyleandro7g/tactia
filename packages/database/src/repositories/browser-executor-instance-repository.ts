import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type CreateBrowserExecutorInstanceInput = {
  tenantId: string;
  provider: string;
  engine: string;
  instanceKey: string;
  baseUrl: string;
  dedicatedConnectionId?: string | null;
  apiKeyCredentialId: string;
  environment: string;
  allowInsecureHttp?: boolean;
  active?: boolean;
};

export type UpdateBrowserExecutorInstanceInput = {
  baseUrl?: string;
  dedicatedConnectionId?: string | null;
  apiKeyCredentialId?: string;
  allowInsecureHttp?: boolean;
  active?: boolean;
  lastHealthAt?: Date | null;
  lastHealthStatus?: string | null;
  lastHealthMessage?: string | null;
};

/**
 * Tenant-scoped executor instances. The API key is never stored here — only a
 * reference to a Credential row (`apiKeyCredentialId`) is kept, so no secret is
 * ever returned by these queries.
 */
export class BrowserExecutorInstanceRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateBrowserExecutorInstanceInput) {
    return this.db.browserExecutorInstance.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        provider: input.provider,
        engine: input.engine,
        instanceKey: input.instanceKey,
        baseUrl: input.baseUrl,
        dedicatedConnectionId: input.dedicatedConnectionId ?? null,
        apiKeyCredentialId: input.apiKeyCredentialId,
        environment: input.environment,
        allowInsecureHttp: input.allowInsecureHttp ?? false,
        active: input.active ?? true,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.browserExecutorInstance.findFirst({ where: { id, tenantId } });
  }

  async findByKey({
    tenantId,
    provider,
    engine,
    instanceKey,
    environment,
  }: {
    tenantId: string;
    provider: string;
    engine: string;
    instanceKey: string;
    environment: string;
  }) {
    return this.db.browserExecutorInstance.findFirst({
      where: { tenantId, provider, engine, instanceKey, environment },
    });
  }

  async listActive({
    tenantId,
    provider,
    environment,
  }: {
    tenantId: string;
    provider: string;
    environment: string;
  }) {
    return this.db.browserExecutorInstance.findMany({
      where: { tenantId, provider, environment, active: true },
      orderBy: { instanceKey: 'asc' },
    });
  }

  async update({ tenantId, id, data }: { tenantId: string; id: string; data: UpdateBrowserExecutorInstanceInput }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.browserExecutorInstance.update({
      where: { id },
      data: {
        baseUrl: data.baseUrl,
        dedicatedConnectionId: data.dedicatedConnectionId,
        apiKeyCredentialId: data.apiKeyCredentialId,
        allowInsecureHttp: data.allowInsecureHttp,
        active: data.active,
        lastHealthAt: data.lastHealthAt,
        lastHealthStatus: data.lastHealthStatus,
        lastHealthMessage: data.lastHealthMessage,
      },
    });
  }
}
