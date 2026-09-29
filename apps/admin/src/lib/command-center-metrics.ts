import { AppError, ErrorCode, isAppError, type RequestContext } from '@tactia/shared';
import { commandCenterMetricsService } from './services';
import { scopedTenant } from './settings-services';

export async function getCommandCenterMetrics(
  ctx: RequestContext,
  tenantId: string,
  query: Record<string, string | undefined> = {},
) {
  const scoped = await scopedTenant(ctx, tenantId);
  return commandCenterMetricsService.summarize(scoped, query);
}

export function firstSearchParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function metricsQueryFromSearch(search: {
  from?: string | string[];
  to?: string | string[];
  name?: string | string[];
  page?: string | string[];
}): Record<string, string | undefined> {
  return {
    from: firstSearchParam(search.from),
    to: firstSearchParam(search.to),
    name: firstSearchParam(search.name),
    page: firstSearchParam(search.page),
  };
}

export function isMetricsValidationError(error: unknown): error is AppError {
  return isAppError(error) && error.code === ErrorCode.VALIDATION_ERROR;
}
