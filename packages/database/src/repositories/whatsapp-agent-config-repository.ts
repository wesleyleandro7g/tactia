import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type WhatsappAgentConfigData = {
  tone?: string | null;
  instructions?: string | null;
  companyContext?: string | null;
  clarificationsEnabled?: boolean;
  clarificationStartHour?: number;
  clarificationEndHour?: number;
  clarificationMaxPerDay?: number;
  clarificationCooldownHours?: number;
  clarificationWeekdays?: number[];
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
        clarificationsEnabled: data.clarificationsEnabled ?? false,
        clarificationStartHour: data.clarificationStartHour ?? 9,
        clarificationEndHour: data.clarificationEndHour ?? 18,
        clarificationMaxPerDay: data.clarificationMaxPerDay ?? 2,
        clarificationCooldownHours: data.clarificationCooldownHours ?? 24,
        clarificationWeekdays: data.clarificationWeekdays ?? [1, 2, 3, 4, 5],
      },
      update: {
        ...(data.tone !== undefined ? { tone: data.tone } : {}),
        ...(data.instructions !== undefined ? { instructions: data.instructions } : {}),
        ...(data.companyContext !== undefined ? { companyContext: data.companyContext } : {}),
        ...(data.clarificationsEnabled !== undefined ? { clarificationsEnabled: data.clarificationsEnabled } : {}),
        ...(data.clarificationStartHour !== undefined ? { clarificationStartHour: data.clarificationStartHour } : {}),
        ...(data.clarificationEndHour !== undefined ? { clarificationEndHour: data.clarificationEndHour } : {}),
        ...(data.clarificationMaxPerDay !== undefined ? { clarificationMaxPerDay: data.clarificationMaxPerDay } : {}),
        ...(data.clarificationCooldownHours !== undefined ? { clarificationCooldownHours: data.clarificationCooldownHours } : {}),
        ...(data.clarificationWeekdays !== undefined ? { clarificationWeekdays: data.clarificationWeekdays } : {}),
      },
    });
  }
}
