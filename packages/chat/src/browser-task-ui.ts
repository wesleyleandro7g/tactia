/**
 * Client-safe helpers for the Browser Agent chat card. Kept free of React so
 * the polling/control rules can be unit-tested in the node test environment.
 */

export const BROWSER_ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'] as const;

export const BROWSER_LIVE_POLL_MS = 1000;
export const BROWSER_COMPACT_POLL_MS = 3000;
export const BROWSER_RETRY_POLL_MS = 10_000;
export const BROWSER_QUEUE_STALE_MS = 15_000;

export function isBrowserTaskQueuedStale(
  status: string,
  createdAt: string | Date | undefined,
  now = Date.now(),
): boolean {
  if (status !== 'QUEUED' || !createdAt) return false;
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) && now - created >= BROWSER_QUEUE_STALE_MS;
}

export function isBrowserTaskActive(status: string): boolean {
  return (BROWSER_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** Next poll delay, or `null` once the task reached a terminal status. */
export function browserTaskPollDelay(status: string, live: boolean): number | null {
  if (!isBrowserTaskActive(status)) return null;
  return live ? BROWSER_LIVE_POLL_MS : BROWSER_COMPACT_POLL_MS;
}

/** The stop button is shown only for active tasks and callers allowed to control them. */
export function canStopBrowserTask(status: string, canControl: boolean): boolean {
  return canControl && isBrowserTaskActive(status);
}

export const BROWSER_STATUS_LABELS: Record<string, string> = {
  QUEUED: 'Aguardando início',
  RUNNING: 'Navegando',
  WAITING_APPROVAL: 'Execução antiga',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  CANCELLED: 'Interrompida',
};

export const BROWSER_PROGRESS_STATUS_LABELS: Record<string, string> = {
  SUCCEEDED: 'concluída',
  FAILED: 'falhou',
};
