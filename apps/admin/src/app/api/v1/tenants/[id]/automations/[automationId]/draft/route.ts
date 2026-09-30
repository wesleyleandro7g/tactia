import { notifyEmailVersionBody, reportsPortalVersionBody, type AutomationVersionBody } from '@tactia/domain';
import { createApiHandler, readJson } from '@/lib/api';
import { automationService } from '@/lib/automations';
import { operatorTenantContext } from '@/lib/operator-tenant';

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const body = (await readJson(request)) as AutomationVersionBody & {
    connectionId?: string;
    preauthorizedRecipients?: string[];
    approvalRecipients?: string[];
    name?: string;
    purpose?: string;
    templateKey?: string;
  };
  const scoped = operatorTenantContext(ctx, params['id']!);
  const automationId = params['automationId']!;
  if (Array.isArray(body.steps) && body.inputSchema && body.pageConfig && body.authorizationPolicy) {
    return automationService.updateDraft(scoped, automationId, body);
  }
  if (body.templateKey === 'notify.email') {
    return automationService.updateDraft(
      scoped,
      automationId,
      {
        ...notifyEmailVersionBody({
          preauthorizedRecipients: body.preauthorizedRecipients ?? [],
          approvalRecipients: body.approvalRecipients ?? [],
        }),
        ...(body.name ? { name: body.name } : {}),
        ...(body.purpose ? { purpose: body.purpose } : {}),
      },
    );
  }
  return automationService.updateDraft(scoped, automationId, {
    ...reportsPortalVersionBody({
      connectionId: body.connectionId?.trim() || 'demo-reports-portal',
      preauthorizedRecipients: body.preauthorizedRecipients ?? [],
      approvalRecipients: body.approvalRecipients ?? [],
    }),
    ...(body.name ? { name: body.name } : {}),
    ...(body.purpose ? { purpose: body.purpose } : {}),
  });
});
