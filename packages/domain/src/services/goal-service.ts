import { z } from 'zod';
import type { GoalRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { decimalToNumber } from '../utils/serialize';

export const createGoalSchema = z
  .object({
    scope: z.enum(['tenant', 'seller', 'product']).default('tenant'),
    scopeId: z.string().uuid().nullable().optional(),
    metricKey: z.string().trim().min(1).max(120),
    periodType: z.enum(['month', 'quarter', 'year']),
    periodStart: z.coerce.date(),
    target: z.number().finite(),
  })
  .refine((data) => data.scope === 'tenant' || Boolean(data.scopeId), {
    message: 'scopeId is required when scope is seller or product',
    path: ['scopeId'],
  });

export class GoalService {
  constructor(private readonly goals: GoalRepository) {}

  async list(ctx: RequestContext) {
    assertTenantContext(ctx);
    const items = await this.goals.list(ctx.tenantId);
    return { items: items.map((goal) => this.serialize(goal)) };
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createGoalSchema.parse(raw);
    const goal = await this.goals.create({ tenantId: ctx.tenantId, ...input });
    return this.serialize(goal);
  }

  async remove(ctx: RequestContext, id: string) {
    assertRole(ctx, 'member');
    const goal = await this.goals.delete({ tenantId: ctx.tenantId, id });
    if (!goal) throw new AppError(ErrorCode.NOT_FOUND, 'Goal not found');
    return this.serialize(goal);
  }

  private serialize(goal: {
    id: string;
    metricKey: string;
    scope: string;
    scopeId: string | null;
    periodType: string;
    periodStart: Date;
    target: unknown;
  }) {
    return {
      id: goal.id,
      metricKey: goal.metricKey,
      scope: goal.scope,
      scopeId: goal.scopeId,
      periodType: goal.periodType,
      periodStart: goal.periodStart,
      target: decimalToNumber(goal.target),
    };
  }
}
