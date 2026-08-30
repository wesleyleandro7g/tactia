export type PeriodGranularity = 'day' | 'week' | 'month';

export type MetricPeriod = {
  from: Date;
  to: Date;
};

export type MetricDimension = 'product' | 'seller' | 'time';

export type MetricBreakdownItem = {
  /** Product id, seller id, or ISO date string depending on dimension */
  key: string;
  label?: string;
  value: number;
};

export type MetricResult = {
  key: string;
  value: number;
  period: { from: string; to: string };
  comparison?: {
    value: number;
    period: { from: string; to: string };
    /** Fractional change: 0.15 = +15%, -0.1 = -10% */
    change: number;
    direction: 'up' | 'down' | 'flat';
  };
  breakdown?: {
    dimension: MetricDimension;
    granularity?: PeriodGranularity;
    items: MetricBreakdownItem[];
  };
};

export type MetricInput = {
  tenantId: string;
  period: MetricPeriod;
  /** If true, compute comparison against the previous period of the same duration */
  withComparison?: boolean;
  breakdown?: {
    dimension: MetricDimension;
    granularity?: PeriodGranularity;
  };
};

/** Built-in metric keys for V0.1 */
export const METRIC_KEYS = [
  'revenue',
  'sales_count',
  'average_ticket',
  'customer_count',
  'sales_growth',
  'revenue_growth',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_DEFINITIONS: Record<MetricKey, { name: string; description: string }> = {
  revenue: {
    name: 'Receita',
    description: 'Soma do valor total de vendas confirmadas no período.',
  },
  sales_count: {
    name: 'Número de Vendas',
    description: 'Contagem de vendas confirmadas no período.',
  },
  average_ticket: {
    name: 'Ticket Médio',
    description: 'Receita dividida pelo número de vendas confirmadas no período.',
  },
  customer_count: {
    name: 'Clientes Únicos',
    description: 'Número de clientes distintos com ao menos uma venda confirmada no período.',
  },
  sales_growth: {
    name: 'Crescimento de Vendas',
    description: 'Variação percentual no número de vendas em relação ao período anterior de mesma duração.',
  },
  revenue_growth: {
    name: 'Crescimento de Receita',
    description: 'Variação percentual na receita em relação ao período anterior de mesma duração.',
  },
};
