import { z } from 'zod';
import type { CampaignRepository } from '@tactia/database';
import { paginationArgs, type RequestContext } from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { listQuerySchema } from '../schemas/business';
import { decimalToNumber } from '../utils/serialize';

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(120),
  spend: z.number().finite().nonnegative(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable().optional(),
  externalId: z.string().trim().min(1).max(120).nullable().optional(),
});

export class CampaignService {
  constructor(private readonly campaigns: CampaignRepository) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.campaigns.list({ tenantId: ctx.tenantId, skip, take });
    return {
      items: result.items.map((item) => this.serialize(item)),
      total: result.total,
      pagination: { page: parsed.page, pageSize: parsed.pageSize },
    };
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createCampaignSchema.parse(raw);
    const campaign = await this.campaigns.create({ tenantId: ctx.tenantId, ...input });
    return this.serialize(campaign);
  }

  private serialize(campaign: Record<string, unknown>) {
    return { ...campaign, spend: decimalToNumber(campaign['spend']) };
  }
}
