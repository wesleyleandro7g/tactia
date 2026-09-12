export type PeriodGranularity = 'day' | 'week' | 'month';

export type MetricPeriod = {
  from: Date;
  to: Date;
};

export type MetricDimension = 'product' | 'seller' | 'time' | 'category' | 'customer' | 'channel' | 'region';

/** Dimensions a metric change can be decomposed by (no time). */
export type DecompositionDimension = 'product' | 'seller' | 'category' | 'customer' | 'channel' | 'region';

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
  /** Free-form JSON extras (baseline z-score, reference label...). Never used for math. */
  metadata?: { [key: string]: MetricMetadataValue };
};

export type MetricMetadataValue =
  | string
  | number
  | boolean
  | null
  | MetricMetadataValue[]
  | { [key: string]: MetricMetadataValue };

export type MetricInput = {
  tenantId: string;
  period: MetricPeriod;
  /** If true, compute comparison against the previous period of the same duration */
  withComparison?: boolean;
  /** When set, comparison uses this period instead of the previous window of the same duration. */
  compareWith?: MetricPeriod;
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
  'discount_total',
  'gross_margin',
  'units_sold',
  'cancellation_rate',
  'refund_rate',
  'pending_amount',
  'new_customers',
  'expense_total',
  'operating_profit',
  'break_even_revenue',
  'receivables_open',
  'overdue_amount',
  'dso',
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
  discount_total: {
    name: 'Descontos',
    description: 'Soma dos descontos concedidos em vendas confirmadas no período.',
  },
  gross_margin: {
    name: 'Margem bruta',
    description:
      'Receita dos itens com custo cadastrado menos o custo de aquisição no período.',
  },
  units_sold: {
    name: 'Unidades vendidas',
    description: 'Soma das quantidades dos itens de vendas confirmadas no período.',
  },
  cancellation_rate: {
    name: 'Taxa de cancelamento',
    description:
      'Vendas canceladas divididas pelas vendas encerradas (confirmadas + canceladas + reembolsadas).',
  },
  refund_rate: {
    name: 'Taxa de reembolso',
    description: 'Vendas reembolsadas divididas pelas vendas encerradas no período.',
  },
  pending_amount: {
    name: 'Receita pendente',
    description: 'Soma do valor das vendas com status pending no período.',
  },
  new_customers: {
    name: 'Novos clientes',
    description: 'Clientes cuja primeira venda confirmada aconteceu no período.',
  },
  expense_total: {
    name: 'Despesas',
    description: 'Soma das despesas no período.',
  },
  operating_profit: {
    name: 'Lucro operacional',
    description: 'Margem bruta em R$ menos despesas do período.',
  },
  break_even_revenue: {
    name: 'Ponto de equilíbrio',
    description: 'Receita necessária para cobrir despesas dado a margem bruta atual.',
  },
  receivables_open: {
    name: 'A receber',
    description: 'Pagamentos pendentes ou vencidos ainda em aberto.',
  },
  overdue_amount: {
    name: 'Vencido',
    description: 'Pagamentos com status overdue.',
  },
  dso: {
    name: 'Prazo médio de recebimento',
    description: 'Dias médios entre a venda e o pagamento (pagamentos liquidados no período).',
  },
};

// ---------------------------------------------------------------------------
// Intelligence types (Etapa 5)
// ---------------------------------------------------------------------------

export type InsightTypeLiteral = 'anomaly' | 'performance' | 'opportunity' | 'warning';
export type InsightSeverityLiteral = 'low' | 'medium' | 'high' | 'critical';

// ---------------------------------------------------------------------------
// Root-cause decomposition (Insights v2)
// ---------------------------------------------------------------------------

export type DriverContributor = {
  /** Entity id (product/customer/seller) or category name */
  key: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
  /** Fraction of the total delta explained by this contributor (same sign as delta/total). */
  share: number;
  /** New in the current period (previous = 0) / disappeared (current = 0). */
  status: 'new' | 'lost' | 'changed';
};

export type DimensionDrivers = {
  dimension: DecompositionDimension;
  contributors: DriverContributor[];
  /** Sum of shares of the listed contributors (how much of the change they explain). */
  explainedShare: number;
};

export type PriceVolumeMix = {
  /** Effect of selling more/less units at previous prices. */
  volumeEffect: number;
  /** Effect of price changes on current units. */
  priceEffect: number;
  /** Effect of the product mix shift (residual of volume at aggregate vs. per product). */
  mixEffect: number;
  currentUnits: number;
  previousUnits: number;
  currentAvgPrice: number;
  previousAvgPrice: number;
};

export type Drivers = {
  metric: string;
  period: { from: string; to: string };
  comparisonPeriod: { from: string; to: string };
  current: number;
  previous: number;
  delta: number;
  /** Fractional change (0.15 = +15%). */
  change: number;
  byDimension: DimensionDrivers[];
  priceVolumeMix?: PriceVolumeMix;
  /** Deterministic one-paragraph explanation in pt-BR — safe to show or narrate. */
  summary: string;
};

export type DetectedEvent = {
  ruleKey: string;
  type: InsightTypeLiteral;
  severity: InsightSeverityLiteral;
  title: string;
  description: string;
  evidence: MetricResult[];
  periodFrom: Date;
  periodTo: Date;
  /** Entity the finding is about. Absent = tenant-wide. */
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  /** Estimated financial impact in tenant currency (always >= 0). */
  impactAmount?: number;
  /** 0..1 — confidence in the signal. Defaults to 0.5 when scoring. */
  confidence?: number;
  drivers?: Drivers;
  /** Defaults to `${ruleKey}:${entityType}:${entityId}`. */
  fingerprint?: string;
};

export type TenantThresholds = {
  revenueDrop: number; // default -0.15
  revenueGrowth: number; // default 0.15
  productChange: number; // default 0.20 (both growth and decline)
  inactiveLeadDays: number; // default 7
  inactiveCustomerDays: number; // default 30
  sellerDeviationFactor: number; // default 0.4 (40% below average)
  complaintGrowth: number; // default 0.3 (30% more complaints than previous period)
  churnIntervalFactor: number; // default 1.5 (recency vs own purchase interval)
  hotLeadScore: number; // default 70
  marginDrop: number; // default -0.15
  discountShare: number; // default 0.12 (discount / (revenue + discount))
  cancellationRate: number; // default 0.08
  unansweredHours: number; // default 24
  staleDataHours: number; // default 48
  revenueConcentration: number; // default 0.3 (top customer share of revenue)
  /** Statistical anomaly threshold (|z-score|) used when a baseline exists. Default 2. */
  anomalyZScore: number;
  /** Behind-goal pace tolerance (fraction). Default 0.1 = flag when 10% behind the required pace. */
  goalPaceTolerance: number;
  retentionDrop: number;
  stockCoverDays: number;
  deadStockDays: number;
  expenseSpike: number;
  overdueShare: number;
  cacSpike: number;
  funnelStallDays: number;
};

export const THRESHOLD_KEYS = [
  'revenueDrop',
  'revenueGrowth',
  'productChange',
  'inactiveLeadDays',
  'inactiveCustomerDays',
  'sellerDeviationFactor',
  'complaintGrowth',
  'churnIntervalFactor',
  'hotLeadScore',
  'marginDrop',
  'discountShare',
  'cancellationRate',
  'unansweredHours',
  'staleDataHours',
  'revenueConcentration',
  'anomalyZScore',
  'goalPaceTolerance',
  'retentionDrop',
  'stockCoverDays',
  'deadStockDays',
  'expenseSpike',
  'overdueShare',
  'cacSpike',
  'funnelStallDays',
] as const satisfies readonly (keyof TenantThresholds)[];

export const DEFAULT_THRESHOLDS: TenantThresholds = {
  revenueDrop: -0.15,
  revenueGrowth: 0.15,
  productChange: 0.2,
  inactiveLeadDays: 7,
  inactiveCustomerDays: 30,
  sellerDeviationFactor: 0.4,
  complaintGrowth: 0.3,
  churnIntervalFactor: 1.5,
  hotLeadScore: 70,
  marginDrop: -0.15,
  discountShare: 0.12,
  cancellationRate: 0.08,
  unansweredHours: 24,
  staleDataHours: 48,
  revenueConcentration: 0.3,
  anomalyZScore: 2,
  goalPaceTolerance: 0.1,
  retentionDrop: -0.15,
  stockCoverDays: 14,
  deadStockDays: 180,
  expenseSpike: 0.25,
  overdueShare: 0.15,
  cacSpike: 0.3,
  funnelStallDays: 14,
};

export function periodIso(period: MetricPeriod) {
  return { from: period.from.toISOString(), to: period.to.toISOString() };
}

export function asMetricResult(key: string, value: number, period: MetricPeriod): MetricResult {
  return { key, value, period: periodIso(period) };
}

