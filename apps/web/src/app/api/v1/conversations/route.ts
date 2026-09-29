import { createConversationSchema } from '@tactia/domain';
import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { commandCenterService, conversationService } from '@/lib/services';

/**
 * GET /api/v1/conversations
 * Lists the conversations of the current user (query: page, pageSize).
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return conversationService.list(ctx, searchParamsRecord(request));
});

/**
 * POST /api/v1/conversations
 * Body: { title?: string }
 * The title is derived from the first message when omitted.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx) => {
    const input = createConversationSchema.parse(
      await readJson(request).catch(() => ({})),
    );
    let contextRef = input.contextRef;
    if (contextRef?.type === 'plan') {
      const plan = await commandCenterService.getPlan(ctx, contextRef.resourceId);
      contextRef = {
        type: 'plan',
        resourceId: plan.id,
        version: plan.version,
        label: plan.title,
      };
    } else if (contextRef?.type === 'objective') {
      const objectives = await commandCenterService.listObjectives(ctx);
      const objective = objectives.items.find((item) => item.id === contextRef?.resourceId);
      contextRef = objective
        ? {
            type: 'objective',
            resourceId: objective.id,
            version: objective.version,
            label: objective.title ?? objective.metricKey,
          }
        : undefined;
    } else {
      contextRef = undefined;
    }
    return conversationService.create(ctx, { ...input, contextRef });
  },
);
