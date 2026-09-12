import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';
import { asJson } from '../json';

export class TenantSettingsRepository {
  constructor(private readonly db: PrismaClient) {}

  async getOrCreate(tenantId: string) {
    const existing = await this.db.tenantSettings.findUnique({ where: { tenantId } });
    if (existing) return existing;
    return this.db.tenantSettings.create({
      data: {
        id: createId(),
        tenantId,
        thresholds: {},
      },
    });
  }

  async updateThresholds(tenantId: string, thresholds: unknown) {
    await this.getOrCreate(tenantId);
    return this.db.tenantSettings.update({
      where: { tenantId },
      data: { thresholds: asJson(thresholds) ?? {} },
    });
  }
}
