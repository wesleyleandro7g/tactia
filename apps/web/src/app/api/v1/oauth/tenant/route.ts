import { AppError, ErrorCode } from '@tactia/shared';
import { auth } from '@/lib/auth';
import { createApiHandler, readJson } from '@/lib/api';
import { tenantService } from '@/lib/services';
import { selectMcpCompany } from '@/lib/mcp-oauth-selection';

export const POST = createApiHandler({ auth: 'user' }, async (request, ctx) => {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Origem inválida');
  }
  const input = (await readJson(request)) as { tenantId?: unknown; oauthQuery?: unknown };
  if (typeof input.tenantId !== 'string' || typeof input.oauthQuery !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenantId é obrigatório');
  }
  await tenantService.switch(ctx, input.tenantId);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.id) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Sessão não encontrada');
  }
  await selectMcpCompany(session.session.id, new URLSearchParams(input.oauthQuery), input.tenantId);
  return { tenantId: input.tenantId };
});
