import { createApiHandler } from '@/lib/api';
import { backofficeService } from '@/lib/services';

export const runtime = 'nodejs';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  const artifact = await backofficeService.getIntegrationArtifact(
    ctx,
    params['id'] ?? '',
    params['artifactId'] ?? '',
  );
  return new Response(new Uint8Array(artifact.body), {
    status: 200,
    headers: {
      'Content-Type': artifact.contentType,
      'Content-Disposition': 'attachment; filename="integration-artifact.bin"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
