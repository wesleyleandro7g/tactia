import type { ImportRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertTenantContext } from '../authz';

export class ImportService {
  constructor(private readonly imports: ImportRepository) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const page = parseInt(query['page'] ?? '1', 10);
    const pageSize = parseInt(query['pageSize'] ?? '20', 10);
    const skip = (page - 1) * pageSize;
    const result = await this.imports.list({
      tenantId: ctx.tenantId!,
      dataSourceId: query['dataSourceId'],
      skip,
      take: pageSize,
    });
    return { ...result, pagination: { page, pageSize } };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const imp = await this.imports.findById({ tenantId: ctx.tenantId!, id });
    if (!imp) throw new AppError(ErrorCode.NOT_FOUND, 'Import not found');
    return imp;
  }
}
