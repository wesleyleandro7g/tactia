import { proposeActionSchema } from '@tactia/execution';
import { createApiHandler, readJson } from '@/lib/api';
import { executionEngine } from '@/lib/services';
import { idempotencyKey } from '@/lib/idempotency';

/**
 * POST /api/v1/actions/:id/execute
 * Body: { input, reason? }
 * Header: `Idempotency-Key` (optional) — replaying the same key returns the
 * original execution instead of creating a new one (spec §52).
 *
 * If the action requires approval the execution stops at `awaiting_approval`;
 * otherwise it runs immediately and the response already carries the outcome.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx, params) => {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    const parsed = proposeActionSchema.parse({ ...(body ?? {}), actionId: params['id']! });

    return executionEngine.propose(ctx, {
      ...parsed,
      idempotencyKey: idempotencyKey(request),
    });
  },
);
