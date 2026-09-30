import { createApiHandler } from '@/lib/api';
import { automationService } from '@/lib/automations';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  const { artifact, body } = await automationService.readArtifact(ctx, params['artifactId']!);
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': artifact.mime,
      'Content-Disposition': `attachment; filename="${artifact.name.replace(/"/g, '')}"`,
    },
  });
});
