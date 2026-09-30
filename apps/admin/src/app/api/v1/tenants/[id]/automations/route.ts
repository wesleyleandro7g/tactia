import { createApiHandler, readJson } from '@/lib/api';
import { automationService } from '@/lib/automations';
import { operatorTenantContext } from '@/lib/operator-tenant';
import { prisma } from '@tactia/database';
import type { AutomationVersionBody } from '@tactia/domain';

function tenantCtx(ctx: Parameters<typeof operatorTenantContext>[0], tenantId: string) {
  return operatorTenantContext(ctx, tenantId);
}

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  const tenantId = params['id']!;
  const scoped = tenantCtx(ctx, tenantId);
  const [page, tenant] = await Promise.all([
    automationService.list(scoped),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { automationsEnabled: true } }),
  ]);
  return { enabled: tenant?.automationsEnabled === true, items: page.items };
});

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const body = (await readJson(request)) as {
    templateKey?: string;
    definition?: AutomationVersionBody;
    name?: string;
    purpose?: string;
    componentKey?: string | null;
  };
  return automationService.createDraft(tenantCtx(ctx, params['id']!), {
    ...(body.templateKey ? { templateKey: body.templateKey } : {}),
    ...(body.definition ? { definition: body.definition } : {}),
    ...(body.name ? { name: body.name } : {}),
    ...(body.purpose ? { purpose: body.purpose } : {}),
    ...(body.componentKey !== undefined ? { componentKey: body.componentKey } : {}),
  });
});
