import { logger } from '@tactia/shared';
import { cronSecretMatches, enqueueQueuedClarifications } from '@/lib/jobs';

/**
 * POST /api/v1/clarifications/dispatch
 * Header: `x-cron-secret`
 *
 * Delivers clarifications prepared by Ops. Runs in apps/web because this app
 * owns the WhatsApp adapter and the job queue; each send revalidates the gap and
 * the contact policy, so a gap resolved meanwhile cancels the question.
 */
export async function POST(request: Request) {
  if (!cronSecretMatches(request.headers.get('x-cron-secret'))) {
    return Response.json({ error: { code: 'AUTHORIZATION_ERROR' } }, { status: 403 });
  }
  const result = await enqueueQueuedClarifications();
  logger.info({ operation: 'clarification_dispatch', enqueued: result.enqueued });
  return Response.json({ data: result });
}
