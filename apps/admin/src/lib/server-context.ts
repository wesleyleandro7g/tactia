import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { RequestContext } from '@tactia/shared';
import { resolveOperatorContext } from './api';
import { operatorService } from './services';

export async function getOperatorContext(): Promise<RequestContext> {
  const incoming = await headers();
  return resolveOperatorContext(new Request('http://localhost/rsc', { headers: incoming }));
}

export async function requireOperator(returnTo?: string) {
  const ctx = await getOperatorContext();
  if (!ctx.operatorId) {
    redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login');
  }
  const operator = await operatorService.getMe(ctx);
  return { ctx, operator };
}
