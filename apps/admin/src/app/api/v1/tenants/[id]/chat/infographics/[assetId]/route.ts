import { createApiHandler } from '@/lib/api';
import { chatServices, chatTenantContext } from '@/lib/chat';

export const runtime = 'nodejs';

/** GET /api/v1/tenants/:id/chat/infographics/:assetId — PNG for the test chat. */
export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  const tenantCtx = await chatTenantContext(ctx, params['id']!);
  const asset = await chatServices.infographicService.getBytes(tenantCtx, params['assetId']!);
  return new Response(new Uint8Array(asset.body), {
    status: 200,
    headers: {
      'Content-Type': asset.contentType,
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline; filename="infographic.png"',
    },
  });
});
