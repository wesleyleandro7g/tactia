const STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila',
  running: 'Executando',
  awaiting_approval: 'Aguardando aprovação',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  needs_attention: 'Requer atenção',
  draft: 'Rascunho',
  published: 'Publicada',
  paused: 'Pausada',
  pending: 'Pendente',
  skipped: 'Ignorada',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}
