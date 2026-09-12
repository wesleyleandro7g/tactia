import { z } from 'zod';
import type { BusinessFactRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';

export const createBusinessFactSchema = z.object({
  kind: z.enum(['fact', 'event', 'preference']),
  text: z.string().trim().min(1).max(4000),
  entityType: z.string().trim().min(1).max(80).nullable().optional(),
  entityId: z.string().uuid().nullable().optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validTo: z.coerce.date().nullable().optional(),
  source: z.enum(['user', 'chat']).optional().default('user'),
});

export class BusinessFactService {
  constructor(private readonly facts: BusinessFactRepository) {}

  async listActive(ctx: RequestContext) {
    assertTenantContext(ctx);
    return { items: await this.facts.listActive(ctx.tenantId, new Date()) };
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createBusinessFactSchema.parse(raw);
    return this.facts.create({
      tenantId: ctx.tenantId,
      kind: input.kind,
      text: input.text,
      entityType: input.entityType,
      entityId: input.entityId,
      validFrom: input.validFrom,
      validTo: input.validTo,
      source: input.source,
      createdBy: ctx.userId,
    });
  }

  async remove(ctx: RequestContext, id: string) {
    assertRole(ctx, 'member');
    const fact = await this.facts.delete({ tenantId: ctx.tenantId, id });
    if (!fact) throw new AppError(ErrorCode.NOT_FOUND, 'Business fact not found');
    return fact;
  }
}
