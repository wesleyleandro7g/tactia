import { createApiHandler } from '@/lib/api';
import { actionService } from '@/lib/services';

/**
 * POST /api/v1/actions/defaults
 * Provisions the built-in action definitions (create_task, send_email) for the
 * current tenant. Idempotent: existing definitions are left untouched.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (_request, ctx) => {
    return actionService.seedDefaults(ctx);
  },
);
