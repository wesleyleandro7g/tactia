import { logger } from '@tactia/shared';
import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { evidenceClarificationService } from '@/lib/services';

/**
 * POST /api/v1/evidence-gaps/:id/clarification
 * Body: { numberId, question }
 *
 * Prepares one contextual question for the person who holds the missing fact.
 * The policy (opt-in, window, daily budget, cooldown) is checked here and again
 * at send time. Delivery runs in apps/web, which owns the WhatsApp adapter:
 * this route never sends the message itself.
 */
export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    const clarification = await evidenceClarificationService.prepare(
      ctx,
      params['id'] ?? '',
      await readJson(request),
    );
    logger.info({
      operator_id: ctx.operatorId,
      tenant_id: clarification.tenantId,
      gap_id: clarification.gapId,
      clarification_id: clarification.id,
      operation: 'clarification_prepared',
    });
    return clarification;
  },
);
