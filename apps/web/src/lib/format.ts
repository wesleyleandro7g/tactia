/**
 * Formatação pt-BR usada em toda a UI.
 * Todas as funções são puras para serem testáveis e usáveis em RSC.
 */

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

const DATE_SHORT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

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

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_SHORT.format(date);
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

/** "01/08/2026 a 01/09/2026" — usado nas fontes citadas pela IA. */
export function formatPeriod(period: { from: string | Date; to: string | Date }): string {
  return `${formatDate(period.from)} a ${formatDate(period.to)}`;
}

/** Rótulo pt-BR das métricas built-in. */
export const METRIC_LABELS: Record<string, string> = {
  revenue: 'Receita',
  sales_count: 'Vendas',
  average_ticket: 'Ticket médio',
  customer_count: 'Clientes',
  sales_growth: 'Crescimento de vendas',
  revenue_growth: 'Crescimento de receita',
  complaint_count: 'Reclamações',
  discount_total: 'Descontos',
  gross_margin: 'Margem bruta',
  units_sold: 'Unidades vendidas',
  cancellation_rate: 'Taxa de cancelamento',
  refund_rate: 'Taxa de reembolso',
  pending_amount: 'Receita pendente',
  pipeline: 'Funil de leads',
  data_freshness: 'Atualização dos dados',
  customer_profile: 'Perfil do cliente',
  customer_segments: 'Segmentos de clientes',
  product_affinity: 'Cross-sell',
  unsold_active_products: 'Produtos sem venda',
  interactions: 'Interações',
  insights: 'Insights',
  insight: 'Insight',
  inactive_leads_count: 'Leads inativos',
  inactive_customers_count: 'Clientes inativos',
  new_customers: 'Novos clientes',
  churn_risk_customers: 'Clientes em risco',
  hot_leads_stalled: 'Leads quentes parados',
  unanswered_interactions: 'Mensagens sem resposta',
  negative_interactions: 'Interações negativas',
  avg_sentiment: 'Sentimento médio',
  data_age_hours: 'Idade dos dados (h)',
  expected_revenue_at_risk: 'Receita em risco',
  customer_voice: 'Voz do cliente',
  trend: 'Tendência',
  forecast: 'Projeção',
  goal_progress: 'Progresso de meta',
  funnel: 'Funil',
  briefing: 'Briefing',
  business_facts: 'Fatos do negócio',
  cohorts: 'Coortes',
  rfm: 'RFM',
  simulation: 'Simulação',
  expense_total: 'Despesas',
  operating_profit: 'Lucro operacional',
  break_even_revenue: 'Ponto de equilíbrio',
  receivables_open: 'A receber',
  overdue_amount: 'Vencido',
  dso: 'Prazo médio de recebimento',
  stock_cover_days: 'Cobertura de estoque (dias)',
  cac_by_source: 'CAC por origem',
  campaign_roi: 'ROI de campanha',
};

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

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key;
}

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

export const ACTION_TYPE_LABELS: Record<string, string> = {
  create_task: 'Criar tarefa',
  send_email: 'Enviar e-mail',
  send_whatsapp: 'Enviar WhatsApp',
  generate_report: 'Gerar relatório',
};

export const SYNC_STATUS_LABELS: Record<string, string> = {
  pending: 'Na fila',
  running: 'Executando',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

/** Traduz os códigos de erro da API (spec §48) para mensagens de usuário. */
export const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'Os dados enviados são inválidos.',
  AUTHENTICATION_ERROR: 'Sua sessão expirou. Entre novamente.',
  AUTHORIZATION_ERROR: 'Você não tem permissão para esta ação.',
  NOT_FOUND: 'Registro não encontrado.',
  CONFLICT: 'Este registro já foi alterado.',
  CONNECTOR_ERROR: 'Não foi possível falar com a fonte de dados.',
  SYNC_ERROR: 'A importação falhou.',
  AI_ERROR: 'A IA está indisponível agora.',
  ACTION_ERROR: 'A ação não pôde ser executada.',
  INTERNAL_ERROR: 'Erro interno. Tente novamente.',
  RATE_LIMITED: 'Muitas solicitações em pouco tempo. Aguarde um instante.',
};

export function errorMessage(code: string | undefined, fallback = 'Algo deu errado.'): string {
  if (!code) return fallback;
  return ERROR_MESSAGES[code] ?? fallback;
}

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
