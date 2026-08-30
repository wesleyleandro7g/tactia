import { TENANT_COOKIE } from '@tactia/shared';
import { cookies } from 'next/headers';
import { createApiHandler } from '@/lib/api';
import { tenantService } from '@/lib/services';

export const POST = createApiHandler({ auth: 'user' }, async (_request, ctx, params) => {
  const result = await tenantService.switch(ctx, params.id ?? '');
  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE, result.tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
  return result;
});
