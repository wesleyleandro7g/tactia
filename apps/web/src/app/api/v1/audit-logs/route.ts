import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { auditLogService } from '@/lib/services';
import { paginationArgs, paginationQuerySchema } from '@tactia/shared';

export const GET = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => {
    const query = searchParamsRecord(request);
    const pagination = paginationQuerySchema.parse(query);
    const { skip, take } = paginationArgs(pagination);
    const result = await auditLogService.list({
      tenantId: ctx.tenantId!,
      skip,
      take,
      action: query.action,
      entityType: query.entityType,
    });
    return { ...result, pagination };
  },
);
