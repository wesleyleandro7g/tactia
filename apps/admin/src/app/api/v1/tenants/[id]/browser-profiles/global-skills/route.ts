import { createApiHandler, readJson } from '@/lib/api';
import { updateGlobalBrowserSkills } from '@/lib/browser-profiles';

export const PATCH = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  return updateGlobalBrowserSkills(ctx, params['id']!, await readJson(request));
});
