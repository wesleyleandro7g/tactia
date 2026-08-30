import { createApiHandler, readJson } from '@/lib/api';
import { operatorTriggerSync } from '@/lib/admin';

/**
 * POST /api/v1/admin/sync
 * Body: { tenantId, dataSourceId }
 *
 * Rota do operador (spec §54): atravessa tenants, portanto exige e-mail na
 * allowlist `TACTIA_OPERATOR_EMAILS` e grava audit log no tenant afetado.
 * Quem não é operador recebe 404.
 */
export const POST = createApiHandler({ auth: 'user' }, async (request, ctx) => {
  const body = (await readJson(request)) as { tenantId?: string; dataSourceId?: string };
  return operatorTriggerSync(ctx, {
    tenantId: String(body.tenantId ?? ''),
    dataSourceId: String(body.dataSourceId ?? ''),
  });
});
