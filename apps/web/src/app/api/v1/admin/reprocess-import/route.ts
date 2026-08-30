import { createApiHandler, readJson } from '@/lib/api';
import { operatorReprocessImport } from '@/lib/admin';

/**
 * POST /api/v1/admin/reprocess-import
 * Body: { tenantId, importId }
 *
 * Reexecuta o sync da fonte que originou o import. Idempotente por
 * `(tenant, data_source, external_id)`, então não duplica dados (spec §38).
 * Restrita à allowlist de operador; caso contrário, 404.
 */
export const POST = createApiHandler({ auth: 'user' }, async (request, ctx) => {
  const body = (await readJson(request)) as { tenantId?: string; importId?: string };
  return operatorReprocessImport(ctx, {
    tenantId: String(body.tenantId ?? ''),
    importId: String(body.importId ?? ''),
  });
});
