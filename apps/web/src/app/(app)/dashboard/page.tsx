import Link from 'next/link';
import type { MetricResult } from '@tactia/intelligence';
import { BriefingCard } from '@/components/app/briefing-card';
import { InsightList, type InsightView } from '@/components/app/insight-list';
import { MetricCard } from '@/components/app/metric-card';
import { RecommendationList, type RecommendationView } from '@/components/app/recommendation-list';
import { RunPipelineButton } from '@/components/app/run-pipeline-button';
import { TrendChart } from '@/components/app/trend-chart';
import { PageHeader } from '@/components/app/page-header';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { formatCurrency, formatInteger, formatPeriod, resolveRangeParam } from '@/lib/format';
import { requireTenant } from '@/lib/server-context';
import {
  briefingService,
  insightService,
  metricService,
  recommendationService,
  saleService,
} from '@/lib/services';

export const metadata = { title: 'Dashboard · Tactia' };

type SearchParams = { from?: string; to?: string };

const RANGE_PRESETS = [
  { label: 'Mês atual', days: 0 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
];

function presetHref(days: number): string {
  if (days === 0) return '/dashboard';
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return `/dashboard?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;
}

/** Métrica que falhou não derruba a página: a seção apenas degrada. */
async function safeMetric<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireTenant('/dashboard');
  const params = await searchParams;
  const period = resolveRangeParam(params);

  const [bulk, revenueSeries, salesSeries, insightPage, recommendationPage, salesTotal, latestBriefing] =
    await Promise.all([
      safeMetric(() =>
        metricService.calculateBulk(ctx, {
          from: period.from.toISOString(),
          to: period.to.toISOString(),
          withComparison: 'true',
          keys: 'revenue,sales_count,customer_count,average_ticket',
        }),
      ),
      safeMetric(() =>
        metricService.calculate(ctx, 'revenue', {
          period,
          breakdown: { dimension: 'time', granularity: 'day' },
        }),
      ),
      safeMetric(() =>
        metricService.calculate(ctx, 'sales_count', {
          period,
          breakdown: { dimension: 'time', granularity: 'day' },
        }),
      ),
      insightService.list(ctx, { status: 'open', page: '1', pageSize: '20' }),
      recommendationService.list(ctx, { status: 'pending', page: '1', pageSize: '10' }),
      saleService.list(ctx, { page: '1', pageSize: '1' }),
      briefingService.latest(ctx),
    ]);

  const metrics = new Map((bulk?.metrics ?? []).map((metric) => [metric.key, metric]));
  const metric = (key: string): MetricResult | undefined => metrics.get(key);

  // Tenant sem nenhuma venda: o problema não é o período, é a ausência de dados.
  if (salesTotal.total === 0) {
    return (
      <div className="flex flex-col gap-6">
        <DashboardHeader period={period} />
        <EmptyState
          title="Nenhum dado importado ainda"
          description="A equipe Tactia ainda não conectou os dados desta empresa. Quando as fontes estiverem ativas, as métricas aparecem aqui."
        />
      </div>
    );
  }

  const revenue = metric('revenue');
  const salesCount = metric('sales_count');
  const customers = metric('customer_count');
  const ticket = metric('average_ticket');

  const revenuePoints = (revenueSeries?.breakdown?.items ?? []).map((item) => ({
    key: item.key,
    value: item.value,
  }));
  const salesPoints = (salesSeries?.breakdown?.items ?? []).map((item) => ({
    key: item.key,
    value: item.value,
  }));

  const insights = insightPage.items as unknown as InsightView[];
  const recommendations = recommendationPage.items as unknown as RecommendationView[];

  return (
    <div className="flex flex-col gap-8">
      <DashboardHeader period={period} />
      <BriefingCard briefing={latestBriefing} />

      {bulk === null ? (
        <Alert tone="danger" title="Não foi possível calcular as métricas">
          Tente recarregar a página. Se persistir, verifique os logs do servidor.
        </Alert>
      ) : null}

      <section aria-labelledby="overview">
        <h2 id="overview" className="sr-only">
          Visão geral
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Receita"
            value={formatCurrency(revenue?.value ?? 0)}
            deltaFraction={revenue?.comparison?.change}
            emphasis
          />
          <MetricCard
            label="Vendas"
            value={formatInteger(salesCount?.value ?? 0)}
            deltaFraction={salesCount?.comparison?.change}
          />
          <MetricCard
            label="Clientes"
            value={formatInteger(customers?.value ?? 0)}
            deltaFraction={customers?.comparison?.change}
          />
          <MetricCard
            label="Ticket médio"
            value={formatCurrency(ticket?.value ?? 0)}
            deltaFraction={ticket?.comparison?.change}
          />
        </div>
        {(revenue?.value ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Sem vendas confirmadas neste período.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="trends" className="flex flex-col gap-4">
        <h2 id="trends" className="font-display text-xl tracking-tight text-foreground">
          Tendências
        </h2>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TrendChart
            title="Receita no tempo"
            description="Receita diária de vendas confirmadas"
            points={revenuePoints}
            format="currency"
          />
          <TrendChart
            title="Vendas no tempo"
            description="Quantidade diária de vendas confirmadas"
            points={salesPoints}
            format="integer"
          />
        </div>
      </section>

      <section aria-labelledby="insights" className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="insights" className="font-display text-xl tracking-tight">
              Insights
            </h2>
            <p className="text-sm text-muted-foreground">
              Detectados por regras determinísticas sobre as métricas do período.
            </p>
          </div>
          <RunPipelineButton from={period.from.toISOString()} to={period.to.toISOString()} />
        </div>
        <InsightList insights={insights} />
      </section>

      <section aria-labelledby="recommendations" className="flex flex-col gap-4">
        <h2 id="recommendations" className="font-display text-xl tracking-tight">
          Recomendações pendentes
        </h2>
        <RecommendationList recommendations={recommendations} />
      </section>
    </div>
  );
}

function DashboardHeader({ period }: { period: { from: Date; to: Date } }) {
  return (
    <PageHeader
      title="Dashboard"
      description={`Período: ${formatPeriod({ from: period.from, to: period.to })}`}
      actions={
        <nav aria-label="Período" className="flex gap-2">
          {RANGE_PRESETS.map((preset) => (
            <Link
              key={preset.label}
              href={presetHref(preset.days)}
              className={cn(
                'rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors duration-200',
                'hover:border-primary/40 hover:bg-accent-soft hover:text-primary',
              )}
            >
              {preset.label}
            </Link>
          ))}
        </nav>
      }
    />
  );
}
