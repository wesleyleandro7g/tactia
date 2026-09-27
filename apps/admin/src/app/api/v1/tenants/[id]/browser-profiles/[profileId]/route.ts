import { createApiHandler, readJson } from '@/lib/api';
import { updateBrowserProfile } from '@/lib/browser-profiles';

export const PATCH = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  return updateBrowserProfile(ctx, params['id']!, params['profileId']!, await readJson(request));
});
