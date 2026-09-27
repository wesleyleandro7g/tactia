import type { WhatsappAgentConfigRepository } from '@tactia/database';
import type { RequestContext } from '@tactia/shared';
import { assertOwnerOrAdmin } from '../authz';
import { whatsappAgentConfigSchema } from '../schemas/whatsapp';
import { AuditAction, type AuditLogService } from './audit-log-service';

/**
 * Per-company communication settings for the WhatsApp agent: tone, extra
 * instructions and company context that get injected into the system prompt.
 */
export class WhatsappAgentConfigService {
  constructor(
    private readonly configs: WhatsappAgentConfigRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async get(ctx: RequestContext) {
    assertOwnerOrAdmin(ctx);
    return this.configs.get({ tenantId: ctx.tenantId });
  }

  /** Read for internal (channel) use — no owner/admin gate. */
  getForChannel(tenantId: string) {
    return this.configs.get({ tenantId });
  }

  async upsert(ctx: RequestContext, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = whatsappAgentConfigSchema.parse(raw);
    const row = await this.configs.upsert({
      tenantId: ctx.tenantId,
      data: {
        ...(input.tone !== undefined ? { tone: input.tone } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
        ...(input.companyContext !== undefined ? { companyContext: input.companyContext } : {}),
      },
    });
    await this.auditLogs.record(ctx, {
      action: AuditAction.WHATSAPP_AGENT_CONFIG_UPDATED,
      entityType: 'whatsapp_agent_config',
      entityId: row.id,
      metadata: {
        hasTone: Boolean(row.tone),
        hasInstructions: Boolean(row.instructions),
        hasCompanyContext: Boolean(row.companyContext),
      },
    });
    return row;
  }
}
