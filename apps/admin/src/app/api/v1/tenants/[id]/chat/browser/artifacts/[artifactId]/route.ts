import { createApiHandler } from '@/lib/api';
import { chatServices, chatTenantContext } from '@/lib/chat';

/** GET /api/v1/tenants/:id/chat/browser/artifacts/:artifactId — download. */
export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  const tenantCtx = await chatTenantContext(ctx, params['id']!);
  const artifact = await chatServices.browserAutomationService.getArtifact(
    tenantCtx,
    params['artifactId']!,
  );
  return new Response(new Uint8Array(artifact.body), {
    headers: {
      'Content-Type': artifact.contentType,
      'Content-Disposition': `attachment; filename="${artifact.filename.replace(/["\\\r\n]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
