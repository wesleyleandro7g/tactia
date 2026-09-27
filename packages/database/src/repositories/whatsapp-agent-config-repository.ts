import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type WhatsappAgentConfigData = {
  tone?: string | null;
  instructions?: string | null;
  companyContext?: string | null;
};

export class WhatsappAgentConfigRepository {
  constructor(private readonly db: PrismaClient) {}

  get({ tenantId }: { tenantId: string }) {
    return this.db.whatsappAgentConfig.findUnique({ where: { tenantId } });
  }

  upsert({ tenantId, data }: { tenantId: string; data: WhatsappAgentConfigData }) {
    return this.db.whatsappAgentConfig.upsert({
      where: { tenantId },
      create: {
        id: createId(),
        tenantId,
        tone: data.tone ?? null,
        instructions: data.instructions ?? null,
        companyContext: data.companyContext ?? null,
      },
      update: {
        ...(data.tone !== undefined ? { tone: data.tone } : {}),
        ...(data.instructions !== undefined ? { instructions: data.instructions } : {}),
        ...(data.companyContext !== undefined ? { companyContext: data.companyContext } : {}),
      },
    });
  }
}
