import { prisma, TenantRepository } from '@tactia/database';
import { createChatRuntime, createChatServices, isLlmConfigured } from '@tactia/chat/server';
import { DEFAULT_JOB_RETRY_LIMIT, PgBossJobQueue } from '@tactia/execution';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { operatorTenantContext } from './operator-tenant';

/**
 * Admin test chat: the same chat stack as apps/web (`@tactia/chat`), with the
 * operator as principal. The admin only *publishes* jobs (Browser Agent
 * tasks, queued action executions); the web worker consumes them.
 */
let queue: PgBossJobQueue | null | undefined;

function adminChatQueue(): PgBossJobQueue | null {
  if (queue !== undefined) return queue;
  const connectionString = process.env['DATABASE_URL'];
  queue =
    process.env['JOBS_ENABLED'] === 'true' && connectionString
      ? new PgBossJobQueue({ connectionString, retryLimit: DEFAULT_JOB_RETRY_LIMIT })
      : null;
  return queue;
}

// Action executions run inline in the admin request: the admin never registers
// the pg-boss action runner, so `enqueue` would fall back to inline anyway.
export const chatServices = createChatServices({
  prisma,
  browserQueue: adminChatQueue,
});

export const chatRuntime = createChatRuntime(chatServices);

export function adminLlmConfigured(): boolean {
  return isLlmConfigured();
}

const tenants = new TenantRepository(prisma);

/**
 * Tenant-scoped operator context for the chat routes. Deleted tenants are
 * hidden (404) like everywhere else in the backoffice.
 */
export async function chatTenantContext(ctx: RequestContext, tenantId: string): Promise<RequestContext> {
  const scoped = operatorTenantContext(ctx, tenantId);
  if (!(await tenants.findByIdForOperator(tenantId))) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');
  }
  return scoped;
}
