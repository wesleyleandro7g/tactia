/**
 * pt-BR labels and formatters used by the chat UI. Pure (no React) so they are
 * shared by apps/web (re-exported from `@/lib/format`) and apps/admin.
 */

const DATE_SHORT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_SHORT.format(date);
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

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key;
}

export const ACTION_TYPE_LABELS: Record<string, string> = {
  create_task: 'Criar tarefa',
  send_email: 'Enviar e-mail',
  send_whatsapp: 'Enviar WhatsApp',
  generate_report: 'Gerar relatório',
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
