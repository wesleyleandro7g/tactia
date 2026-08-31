import { proposeActionSchema } from '@tactia/execution';
import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { actionService, executionEngine } from '@/lib/services';
import { idempotencyKey } from '@/lib/idempotency';

/**
 * GET /api/v1/action-executions
 * Query: status, actionId, page, pageSize. Includes action and approvals.
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return actionService.listExecutions(ctx, searchParamsRecord(request));
});

/**
 * POST /api/v1/action-executions
 * Body: { actionId? | actionType?, input, reason? }
 * Header: `Idempotency-Key` (optional, spec §52).
 *
 * Proposing by `actionType` provisions the tenant definition on first use.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'], rateLimit: RATE_LIMITS.execution },
  async (request, ctx) => {
    const parsed = proposeActionSchema.parse(await readJson(request));
    return executionEngine.propose(ctx, {
      ...parsed,
      idempotencyKey: idempotencyKey(request),
    });
  },
);
