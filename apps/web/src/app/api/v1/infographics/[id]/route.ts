import { createApiHandler } from '@/lib/api';
import { infographicService } from '@/lib/services';

export const runtime = 'nodejs';

/**
 * GET /api/v1/infographics/:id
 * Authenticated PNG download for chat UI.
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  const asset = await infographicService.getBytes(ctx, params['id']!);
  return new Response(new Uint8Array(asset.body), {
    status: 200,
    headers: {
      'Content-Type': asset.contentType,
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `inline; filename="infographic.png"`,
    },
  });
});
