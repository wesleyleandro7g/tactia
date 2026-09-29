import { proposeActionSchema } from '@tactia/execution';
import { createApiHandler, readJson } from '@/lib/api';
import { idempotencyKey } from '@/lib/idempotency';
import { commandCenterService, executionEngine } from '@/lib/services';

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) => {
    const parsed = proposeActionSchema.parse(await readJson(request));
    const planId = params.id ?? '';
    const stepId = params.stepId ?? '';
    const prepared = await commandCenterService.validatePreparedExecution(
      ctx,
      planId,
      stepId,
      parsed,
    );
    const execution = await executionEngine.propose(ctx, {
      ...prepared,
      idempotencyKey: idempotencyKey(request),
    }, { origin: 'ai' });
    const link = await commandCenterService.linkExecution(
      ctx,
      planId,
      stepId,
      {
        actionExecutionId: execution.id,
        actionType: execution.action.type,
        input: execution.input as Record<string, unknown>,
        reason: prepared.reason ?? null,
      },
    );
    const plan = await commandCenterService.reconcileExecution(ctx, execution.id);
    return { execution, link, plan };
  },
);
