/**
 * Formatação pt-BR usada em toda a UI.
 * Todas as funções são puras para serem testáveis e usáveis em RSC.
 */

// Chat-shared labels live in @tactia/chat (single source for web + admin).
export {
  ACTION_TYPE_LABELS,
  ERROR_MESSAGES,
  METRIC_LABELS,
  errorMessage,
  formatDate,
  formatPeriod,
  metricLabel,
} from '@tactia/chat/format';

const CURRENCY = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

const CURRENCY_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const INTEGER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const DATE_DAY = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatCurrency(value: number, options: { compact?: boolean } = {}): string {
  if (!Number.isFinite(value)) return '—';
  return options.compact ? CURRENCY_COMPACT.format(value) : CURRENCY.format(value);
}

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return INTEGER.format(value);
}

/** Recebe fração (0.15) e devolve percentual com sinal ("+15,0%"). */
export function formatPercentDelta(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—';
  const percent = fraction * 100;
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function formatDayMonth(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_DAY.format(date);
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_TIME.format(date);
}

/** Rótulo pt-BR das regras de insight. */
export const RULE_LABELS: Record<string, string> = {
  revenue_drop: 'Queda de receita',
  revenue_growth: 'Crescimento de receita',
  revenue_concentration: 'Concentração de receita',
  product_growth: 'Produto em alta',
  product_decline: 'Produto em queda',
  product_decline_with_complaints: 'Produto em queda com reclamações',
  customer_churn_risk: 'Risco de churn',
  churn_risk_with_open_complaint: 'Churn com reclamação',
  inactive_customers: 'Clientes inativos',
  inactive_leads: 'Leads parados',
  hot_lead_stalled: 'Lead quente parado',
  seller_performance_deviation: 'Vendedor abaixo da média',
  seller_high_discount_low_margin: 'Desconto alto / margem baixa',
  margin_drop: 'Queda de margem',
  discount_share: 'Descontos excessivos',
  cancellation_rate: 'Cancelamentos',
  complaint_volume: 'Volume de reclamações',
  unanswered_interactions: 'Mensagens sem resposta',
  stale_data: 'Dados desatualizados',
  goal_pace_behind: 'Meta abaixo do ritmo',
  goal_reached: 'Meta atingida',
  funnel_bottleneck: 'Gargalo no funil',
  lead_velocity_drop: 'Queda de novos leads',
  retention_drop: 'Queda de retenção',
  champions_at_risk: 'Campeões em risco',
  expense_spike: 'Pico de despesas',
  negative_operating_profit: 'Lucro operacional negativo',
  overdue_spike: 'Aumento de inadimplência',
  customer_overdue_with_new_sale: 'Venda a cliente inadimplente',
  stockout_risk: 'Risco de ruptura',
  dead_stock: 'Estoque parado',
  cac_spike: 'CAC em alta',
  campaign_without_leads: 'Campanha sem leads',
};

export function ruleLabel(key: string): string {
  return RULE_LABELS[key] ?? key;
}

export const DISMISS_REASON_LABELS: Record<string, string> = {
  noise: 'Não é relevante (ruído)',
  known: 'Já sabia disso',
  not_relevant: 'Não se aplica',
  other: 'Outro motivo',
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  customer: 'Cliente',
  product: 'Produto',
  seller: 'Vendedor',
  data_source: 'Fonte de dados',
  goal: 'Meta',
  campaign: 'Campanha',
  source: 'Origem',
};

export const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
};

export const INSIGHT_TYPE_LABELS: Record<string, string> = {
  anomaly: 'Anomalia',
  performance: 'Desempenho',
  opportunity: 'Oportunidade',
  warning: 'Alerta',
};

export const EXECUTION_STATUS_LABELS: Record<string, string> = {
  pending: 'Na fila',
  awaiting_approval: 'Aguardando aprovação',
  approved: 'Aprovada',
  running: 'Executando',
  completed: 'Executada',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

export const SYNC_STATUS_LABELS: Record<string, string> = {
  pending: 'Na fila',
  running: 'Executando',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

/** Período padrão do dashboard: mês corrente. */
export function currentMonthRange(now = new Date()): { from: Date; to: Date } {
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

/** Janela imediatamente anterior, com a mesma duração. */
export function previousPeriodRange(period: { from: Date; to: Date }): { from: Date; to: Date } {
  const duration = period.to.getTime() - period.from.getTime();
  return {
    from: new Date(period.from.getTime() - duration),
    to: new Date(period.to.getTime() - duration),
  };
}

export function periodLengthDays(period: { from: Date; to: Date }): number {
  return Math.round((period.to.getTime() - period.from.getTime()) / (24 * 60 * 60 * 1000));
}

export function isSameRange(
  left: { from: Date; to: Date },
  right: { from: Date; to: Date },
): boolean {
  return left.from.getTime() === right.from.getTime() && left.to.getTime() === right.to.getTime();
}

/** Tira a lista de números que duplica os KPIs e o título da semana. */
export function briefingNarrative(content: string): string {
  const stripped = content
    .replace(/^##[^\n]*\n+/, '')
    .replace(/### Números[\s\S]*?(?=\n## |\n### |$)/, '')
    .trim();
  return stripped || content;
}

/** Interpreta ?from=&to= da URL, caindo no mês corrente quando ausente/inválido. */
export function resolveRangeParam(
  params: { from?: string; to?: string },
  now = new Date(),
): { from: Date; to: Date } {
  const fallback = currentMonthRange(now);
  const from = params.from ? new Date(params.from) : fallback.from;
  const to = params.to ? new Date(params.to) : fallback.to;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return fallback;
  return { from, to };
}
