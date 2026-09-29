import { createApiHandler, readJson } from '@/lib/api';
import { evidenceGapService } from '@/lib/services';

export const PATCH = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  return evidenceGapService.update(ctx, params.id ?? '', await readJson(request));
});
