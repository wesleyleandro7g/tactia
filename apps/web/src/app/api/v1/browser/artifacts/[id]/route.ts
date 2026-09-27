import { createApiHandler } from '@/lib/api';
import { browserAutomationService } from '@/lib/browser-automation';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  const artifact = await browserAutomationService.getArtifact(ctx, params['id']!);
  return new Response(new Uint8Array(artifact.body), {
    headers: {
      'Content-Type': artifact.contentType,
      'Content-Disposition': `attachment; filename="${artifact.filename.replace(/["\\\r\n]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
