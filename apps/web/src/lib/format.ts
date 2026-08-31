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
  insights: 'Insights',
  inactive_leads_count: 'Leads inativos',
  inactive_customers_count: 'Clientes inativos',
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
