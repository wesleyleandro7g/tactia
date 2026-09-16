import Link from 'next/link';
import type { MetricResult } from '@tactia/intelligence';
import { BriefingCard } from '@/components/app/briefing-card';
import { CategoryDonutChart } from '@/components/app/dashboard/category-donut-chart';
import { LineTrendChart } from '@/components/app/dashboard/line-trend-chart';
import { RadialProgressChart } from '@/components/app/dashboard/radial-progress-chart';
import { RankingBarChart } from '@/components/app/dashboard/ranking-bar-chart';
import { TimeBarChart } from '@/components/app/dashboard/time-bar-chart';
import { InsightList, type InsightView } from '@/components/app/insight-list';
import { MetricCard } from '@/components/app/metric-card';
import { RecommendationList, type RecommendationView } from '@/components/app/recommendation-list';
import { RunPipelineButton } from '@/components/app/run-pipeline-button';
import { PageHeader } from '@/components/app/page-header';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/feedback';
import type { ChartPoint } from '@/lib/chart';
import { toNamedItems, topNWithOthers } from '@/lib/chart';
import { cn } from '@/lib/cn';
import {
  currentMonthRange,
  formatCurrency,
  formatInteger,
  formatPeriod,
  isSameRange,
  periodLengthDays,
  previousPeriodRange,
  resolveRangeParam,
} from '@/lib/format';
import { goalRadialProgress, marginRadialProgress } from '@/lib/radial-progress';
import { requireTenant } from '@/lib/server-context';
import {
  analyticsService,
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

const BULK_KEYS =
  'revenue,sales_count,customer_count,average_ticket,gross_margin,discount_total,units_sold,complaint_count,new_customers,operating_profit,expense_total';

function presetHref(days: number): string {
  if (days === 0) return '/dashboard';
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return `/dashboard?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;
}

function presetActive(days: number, period: { from: Date; to: Date }, now = new Date()): boolean {
  const month = currentMonthRange(now);
  if (days === 0) return isSameRange(period, month);
  // Setembro tem 30 dias: o mês corrente não deve acender o atalho de 30 dias.
  if (isSameRange(period, month)) return false;
  return periodLengthDays(period) === days;
}

/** Métrica que falhou não derruba a página: a seção apenas degrada. */
async function safeMetric<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

function seriesPoints(result: MetricResult | null): ChartPoint[] {
  return (result?.breakdown?.items ?? []).map((item) => ({ key: item.key, value: item.value }));
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireTenant('/dashboard');
  const params = await searchParams;
  const period = resolveRangeParam(params);
  const previous = previousPeriodRange(period);
  const previousShiftMs = period.from.getTime() - previous.from.getTime();

  const [
    bulk,
    revenueSeries,
    previousRevenueSeries,
    salesSeries,
    productSeries,
    sellerSeries,
    categorySeries,
    insightPage,
    recommendationPage,
    salesTotal,
    latestBriefing,
    goals,
  ] = await Promise.all([
    safeMetric(() =>
      metricService.calculateBulk(ctx, {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        withComparison: 'true',
        keys: BULK_KEYS,
      }),
    ),
    safeMetric(() =>
      metricService.calculate(ctx, 'revenue', {
        period,
        breakdown: { dimension: 'time', granularity: 'day' },
      }),
    ),
    safeMetric(() =>
      metricService.calculate(ctx, 'revenue', {
        period: previous,
        breakdown: { dimension: 'time', granularity: 'day' },
      }),
    ),
    safeMetric(() =>
      metricService.calculate(ctx, 'sales_count', {
        period,
        breakdown: { dimension: 'time', granularity: 'day' },
      }),
    ),
    safeMetric(() =>
      metricService.calculate(ctx, 'revenue', {
        period,
        breakdown: { dimension: 'product' },
      }),
    ),
    safeMetric(() =>
      metricService.calculate(ctx, 'revenue', {
        period,
        breakdown: { dimension: 'seller' },
      }),
    ),
    safeMetric(() =>
      metricService.calculate(ctx, 'revenue', {
        period,
        breakdown: { dimension: 'category' },
      }),
    ),
    insightService.list(ctx, { status: 'open', page: '1', pageSize: '20' }),
    recommendationService.list(ctx, { status: 'pending', page: '1', pageSize: '10' }),
    saleService.list(ctx, { page: '1', pageSize: '1' }),
    briefingService.latest(ctx),
    safeMetric(() => analyticsService.getGoalsProgress(ctx)),
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
  const margin = metric('gross_margin');
  const discounts = metric('discount_total');
  const units = metric('units_sold');
  const complaints = metric('complaint_count');
  const newCustomers = metric('new_customers');
  const profit = metric('operating_profit');

  const revenuePoints = seriesPoints(revenueSeries);
  const previousRevenuePoints = seriesPoints(previousRevenueSeries);
  const salesPoints = seriesPoints(salesSeries);
  const productItems = toNamedItems(productSeries?.breakdown?.items ?? []).slice(0, 8);
  const sellerItems = toNamedItems(sellerSeries?.breakdown?.items ?? []).slice(0, 6);
  const categoryItems = topNWithOthers(toNamedItems(categorySeries?.breakdown?.items ?? []), 4);

  const insights = insightPage.items as unknown as InsightView[];
  const recommendations = recommendationPage.items as unknown as RecommendationView[];

  const primaryGoal =
    (goals ?? []).find((goal) => goal.metricKey === 'revenue' && goal.target > 0) ??
    (goals ?? []).find((goal) => goal.target > 0);
  const radial =
    primaryGoal != null
      ? goalRadialProgress(primaryGoal)
      : (revenue?.value ?? 0) > 0
        ? marginRadialProgress(margin?.value ?? 0, revenue?.value ?? 0)
        : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <DashboardHeader period={period} />

      {bulk === null ? (
        <Alert tone="danger" title="Não foi possível calcular as métricas">
          Tente recarregar a página. Se persistir, verifique os logs do servidor.
        </Alert>
      ) : null}

      <section aria-labelledby="overview" className="min-w-0">
        <h2 id="overview" className="sr-only">
          Visão geral
        </h2>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Receita"
            value={formatCurrency(revenue?.value ?? 0)}
            deltaFraction={revenue?.comparison?.change}
            emphasis
            sparkline={revenuePoints}
            sparklineColor="var(--chart-1)"
          />
          <MetricCard
            label="Vendas"
            value={formatInteger(salesCount?.value ?? 0)}
            deltaFraction={salesCount?.comparison?.change}
            sparkline={salesPoints}
            sparklineColor="var(--chart-2)"
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
          <p className="mt-3 text-sm text-muted-foreground">Sem vendas confirmadas neste período.</p>
        ) : null}
      </section>

      <section aria-labelledby="trends" className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
        <h2 id="trends" className="sr-only">
          Tendências
        </h2>
        <div className="min-w-0 lg:col-span-8">
          <LineTrendChart
            title="Receita no tempo"
            description="Vendas confirmadas, com o período anterior em tracejado"
            points={revenuePoints}
            previousPoints={previousRevenuePoints}
            previousShiftMs={previousShiftMs}
            format="currency"
          />
        </div>
        <div className="min-w-0 lg:col-span-4">
          <BriefingCard briefing={latestBriefing} compact />
        </div>
      </section>

      <section aria-labelledby="composition" className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <h2 id="composition" className="sr-only">
          Composição
        </h2>
        <TimeBarChart
          title="Vendas no tempo"
          description="Quantidade diária de vendas confirmadas"
          points={salesPoints}
          format="integer"
        />
        {categoryItems.length > 0 ? (
          <CategoryDonutChart
            title="Receita por categoria"
            description="Onde o faturamento se concentra"
            items={categoryItems}
          />
        ) : null}
        {productItems.length > 0 ? (
          <RankingBarChart
            title="Top produtos"
            description="Receita dos itens mais vendidos"
            items={productItems}
            format="currency"
            layout="horizontal"
            color="var(--chart-1)"
          />
        ) : null}
      </section>

      <section aria-labelledby="performance" className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
        <h2 id="performance" className="sr-only">
          Desempenho
        </h2>
        {sellerItems.length > 0 ? (
          <div className="min-w-0 lg:col-span-5">
            <RankingBarChart
              title="Top vendedores"
              description="Receita por vendedor no período"
              items={sellerItems}
              format="currency"
              layout="vertical"
              color="var(--chart-3)"
            />
          </div>
        ) : null}
        {radial ? (
          <div className={sellerItems.length > 0 ? 'min-w-0 lg:col-span-3' : 'min-w-0 lg:col-span-4'}>
            <RadialProgressChart progress={radial} />
          </div>
        ) : null}
        <div
          className={cn(
            'grid min-w-0 grid-cols-2 gap-4',
            sellerItems.length > 0 && radial ? 'lg:col-span-4' : 'lg:col-span-8',
            sellerItems.length === 0 && !radial && 'lg:col-span-12',
          )}
        >
          <MetricCard
            size="sm"
            label="Margem bruta"
            value={formatCurrency(margin?.value ?? 0)}
            deltaFraction={margin?.comparison?.change}
          />
          <MetricCard
            size="sm"
            label="Unidades"
            value={formatInteger(units?.value ?? 0)}
            deltaFraction={units?.comparison?.change}
          />
          <MetricCard
            size="sm"
            label="Novos clientes"
            value={formatInteger(newCustomers?.value ?? 0)}
            deltaFraction={newCustomers?.comparison?.change}
          />
          <MetricCard
            size="sm"
            label="Descontos"
            value={formatCurrency(discounts?.value ?? 0)}
            deltaFraction={discounts?.comparison?.change}
          />
          <MetricCard
            size="sm"
            label="Lucro operacional"
            value={formatCurrency(profit?.value ?? 0)}
            deltaFraction={profit?.comparison?.change}
          />
          <MetricCard
            size="sm"
            label="Reclamações"
            value={formatInteger(complaints?.value ?? 0)}
            deltaFraction={complaints?.comparison?.change}
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
        <nav aria-label="Período" className="inline-flex rounded-full border border-border bg-card p-1">
          {RANGE_PRESETS.map((preset) => {
            const active = presetActive(preset.days, period);
            return (
              <Link
                key={preset.label}
                href={presetHref(preset.days)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-accent-soft hover:text-primary',
                )}
              >
                {preset.label}
              </Link>
            );
          })}
        </nav>
      }
    />
  );
}
