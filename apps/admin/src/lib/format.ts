const INTEGER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return INTEGER.format(value);
}

export function formatRatio(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 }).format(value);
}

export function formatMetricValue(value: number | null, unit: 'count' | 'ratio'): string {
  if (value == null) return '—';
  return unit === 'ratio' ? formatRatio(value) : formatInteger(value);
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_TIME.format(date);
}

export const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'Os dados enviados são inválidos.',
  AUTHENTICATION_ERROR: 'Sua sessão expirou. Entre novamente.',
  AUTHORIZATION_ERROR: 'Você não tem permissão para esta ação.',
  NOT_FOUND: 'Registro não encontrado.',
  CONFLICT: 'Este registro já existe.',
  CONNECTOR_ERROR: 'Não foi possível falar com a fonte de dados.',
  SYNC_ERROR: 'A importação falhou.',
  INTERNAL_ERROR: 'Erro interno. Tente novamente.',
  RATE_LIMITED: 'Muitas solicitações em pouco tempo. Aguarde um instante.',
};

export function errorMessage(code: string | undefined, fallback = 'Algo deu errado.'): string {
  if (!code) return fallback;
  return ERROR_MESSAGES[code] ?? fallback;
}

export const SYNC_STATUS_LABELS: Record<string, string> = {
  pending: 'Na fila',
  running: 'Executando',
  completed: 'Concluído',
  partial: 'Parcial',
  needs_attention: 'Requer atenção',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

export const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
};

export const TENANT_STATUS_LABELS: Record<string, string> = {
  active: 'Ativa',
  suspended: 'Suspensa',
  deleted: 'Excluída',
};

export const COMMAND_CENTER_EVENT_LABELS: Record<string, string> = {
  plan_created: 'Plano criado',
  decision_resolved: 'Decisão resolvida',
  execution_state_changed: 'Transição de execução',
  clarification_requested: 'Esclarecimento solicitado',
  clarification_received: 'Esclarecimento recebido',
};

export const METRIC_AVAILABILITY_LABELS: Record<string, string> = {
  ready: 'Com cobertura',
  empty: 'Sem eventos',
};

