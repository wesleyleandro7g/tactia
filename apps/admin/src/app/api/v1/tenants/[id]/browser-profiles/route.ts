import { createApiHandler, readJson } from '@/lib/api';
import { createBrowserProfile, listBrowserProfiles } from '@/lib/browser-profiles';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  return listBrowserProfiles(ctx, params['id']!);
});

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  return createBrowserProfile(ctx, params['id']!, await readJson(request));
});
