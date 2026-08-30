import { TENANT_COOKIE } from '@tactia/shared';
import { cookies } from 'next/headers';
import { createApiHandler, readJson } from '@/lib/api';
import { tenantService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'user' }, async (_request, ctx) => {
  return tenantService.listForUser(ctx);
});

export const POST = createApiHandler({ auth: 'user' }, async (request, ctx) => {
  const body = await readJson(request);
  const tenant = await tenantService.create(ctx, body);
  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE, tenant.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
  return tenant;
});
