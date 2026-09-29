import { CommandCenterMetricsPanel } from '@/components/app/command-center-metrics-panel';
import {
  getCommandCenterMetrics,
  isMetricsValidationError,
  metricsQueryFromSearch,
} from '@/lib/command-center-metrics';
import { loadOperator } from '@/lib/tenant-loaders';
import type { CommandCenterMetricsService } from '@tactia/domain';

export const metadata = { title: 'Piloto · Empresa · Tactia Ops' };

type Metrics = Awaited<ReturnType<CommandCenterMetricsService['summarize']>>;

export default async function TenantMetricsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; name?: string; page?: string }>;
}) {
  const { id } = await params;
  const { ctx } = await loadOperator(id);
  const query = metricsQueryFromSearch(await searchParams);

  let metrics: Metrics | undefined;
  let error: string | undefined;
  try {
    metrics = await getCommandCenterMetrics(ctx, id, query);
  } catch (cause) {
    if (!isMetricsValidationError(cause)) throw cause;
    error = cause.message;
  }

  return <CommandCenterMetricsPanel tenantId={id} metrics={metrics} error={error} />;
}
