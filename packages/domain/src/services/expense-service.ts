import { z } from 'zod';
import type { ExpenseRepository } from '@tactia/database';
import { paginationArgs, type RequestContext } from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { listQuerySchema } from '../schemas/business';
import { decimalToNumber } from '../utils/serialize';

export const createExpenseSchema = z.object({
  category: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  amount: z.number().finite(),
  occurredAt: z.coerce.date(),
  recurring: z.boolean().optional(),
  supplier: z.string().trim().max(200).nullable().optional(),
  externalId: z.string().trim().min(1).max(120).nullable().optional(),
});

export class ExpenseService {
  constructor(private readonly expenses: ExpenseRepository) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.expenses.list({ tenantId: ctx.tenantId, skip, take });
    return {
      items: result.items.map((item) => this.serialize(item)),
      total: result.total,
      pagination: { page: parsed.page, pageSize: parsed.pageSize },
    };
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createExpenseSchema.parse(raw);
    const expense = await this.expenses.create({ tenantId: ctx.tenantId, ...input });
    return this.serialize(expense);
  }

  private serialize(expense: Record<string, unknown>) {
    return { ...expense, amount: decimalToNumber(expense['amount']) };
  }
}
