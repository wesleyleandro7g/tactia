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
  'complaint_count',
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
  complaint_count: {
    name: 'Reclamações',
    description: 'Contagem de interações classificadas como reclamação no período.',
  },
};

// ---------------------------------------------------------------------------
// Intelligence types (Etapa 5)
// ---------------------------------------------------------------------------

export type InsightTypeLiteral = 'anomaly' | 'performance' | 'opportunity' | 'warning';
export type InsightSeverityLiteral = 'low' | 'medium' | 'high' | 'critical';

export type DetectedEvent = {
  ruleKey: string;
  type: InsightTypeLiteral;
  severity: InsightSeverityLiteral;
  title: string;
  description: string;
  evidence: MetricResult[];
  periodFrom: Date;
  periodTo: Date;
};

export type TenantThresholds = {
  revenueDrop: number; // default -0.15
  revenueGrowth: number; // default 0.15
  productChange: number; // default 0.20 (both growth and decline)
  inactiveLeadDays: number; // default 7
  inactiveCustomerDays: number; // default 30
  sellerDeviationFactor: number; // default 0.4 (40% below average)
  complaintGrowth: number; // default 0.3 (30% more complaints than previous period)
};

export const DEFAULT_THRESHOLDS: TenantThresholds = {
  revenueDrop: -0.15,
  revenueGrowth: 0.15,
  productChange: 0.2,
  inactiveLeadDays: 7,
  inactiveCustomerDays: 30,
  sellerDeviationFactor: 0.4,
  complaintGrowth: 0.3,
};

