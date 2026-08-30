import { createApiHandler, readJson } from '@/lib/api';
import { credentialService } from '@/lib/services';

/**
 * POST /api/v1/credentials
 * Body: { provider, data }
 *
 * `data` é criptografado com AES-256-GCM antes de ser gravado e só é
 * descriptografado no momento do sync (spec §20). A resposta devolve apenas o
 * id e o provider — o segredo nunca volta pela API.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => {
    const credential = await credentialService.create(ctx, await readJson(request));
    return { id: credential.id, provider: credential.provider, createdAt: credential.createdAt };
  },
);
