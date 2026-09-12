import { z } from 'zod';
import type { PaymentRepository, PaymentStatus, SaleRepository } from '@tactia/database';
import { AppError, ErrorCode, paginationArgs, type RequestContext } from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { listQuerySchema } from '../schemas/business';
import { decimalToNumber } from '../utils/serialize';

export const createPaymentSchema = z.object({
  saleId: z.string().uuid(),
  amount: z.number().finite(),
  method: z.string().trim().max(80).nullable().optional(),
  dueAt: z.coerce.date(),
  paidAt: z.coerce.date().nullable().optional(),
  status: z.enum(['pending', 'paid', 'overdue', 'cancelled']).optional(),
  externalId: z.string().trim().min(1).max(120).nullable().optional(),
});

export class PaymentService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly sales: SaleRepository,
  ) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.payments.list({
      tenantId: ctx.tenantId,
      skip,
      take,
      status: parsed.status as PaymentStatus | undefined,
    });
    return {
      items: result.items.map((item) => this.serialize(item)),
      total: result.total,
      pagination: { page: parsed.page, pageSize: parsed.pageSize },
    };
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createPaymentSchema.parse(raw);
    const sale = await this.sales.findById({ tenantId: ctx.tenantId, id: input.saleId });
    if (!sale) throw new AppError(ErrorCode.NOT_FOUND, 'Sale not found');
    const payment = await this.payments.create({ tenantId: ctx.tenantId, ...input });
    return this.serialize(payment);
  }

  private serialize(payment: Record<string, unknown>) {
    return { ...payment, amount: decimalToNumber(payment['amount']) };
  }
}
