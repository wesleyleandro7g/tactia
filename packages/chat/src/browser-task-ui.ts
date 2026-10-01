/**
 * Client-safe helpers for the Browser Agent chat card. Kept free of React so
 * the polling/control rules can be unit-tested in the node test environment.
 */

export const BROWSER_ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'] as const;

export const BROWSER_LIVE_POLL_MS = 1000;
export const BROWSER_COMPACT_POLL_MS = 3000;
export const BROWSER_RETRY_POLL_MS = 10_000;
export const BROWSER_QUEUE_STALE_MS = 15_000;
/** How long the card keeps waiting for the elaborated answer after navigation ends. */
export const BROWSER_RESULT_WAIT_MS = 60_000;

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

/**
 * The card still owes a chat message after navigation finishes: the main agent
 * writes that answer, so polling continues until it is saved.
 */
export function browserCardBlocksFollowUps(status: string, hasChatResponse: boolean): boolean {
  if (isBrowserTaskActive(status)) return true;
  return (status === 'COMPLETED' || status === 'FAILED') && !hasChatResponse;
}

/**
 * Hide "Continuar a análise" while any browser task is still working.
 * A task started in this session counts as working until the card reports otherwise.
 * Tasks already on screen when the conversation opened do not, so a finished
 * history does not hide suggestions before the first poll.
 */
export function conversationBlocksFollowUps(
  taskIds: readonly string[],
  activity: Readonly<Record<string, boolean>>,
  pendingTaskIds: ReadonlySet<string>,
): boolean {
  return taskIds.some((id) => {
    const known = activity[id];
    if (typeof known === 'boolean') return known;
    return pendingTaskIds.has(id);
  });
}

export function browserResultWaitExpired(startedAt: number | null, now = Date.now()): boolean {
  return startedAt != null && now - startedAt >= BROWSER_RESULT_WAIT_MS;
}

/** Next poll delay, or `null` once the task reached a terminal status and its answer is saved. */
export function browserTaskPollDelay(
  status: string,
  live: boolean,
  awaitingResult = false,
): number | null {
  if (!isBrowserTaskActive(status) && !awaitingResult) return null;
  return live ? BROWSER_LIVE_POLL_MS : BROWSER_COMPACT_POLL_MS;
}

/** The stop button is shown only for active tasks and callers allowed to control them. */
export function canStopBrowserTask(status: string, canControl: boolean): boolean {
  return canControl && isBrowserTaskActive(status);
}

export const BROWSER_STATUS_LABELS: Record<string, string> = {
  QUEUED: 'Preparando',
  RUNNING: 'Navegando',
  WAITING_APPROVAL: 'Aguardando',
  COMPLETED: 'Pronto',
  FAILED: 'Não concluí',
  CANCELLED: 'Interrompido',
};

export const BROWSER_STATUS_FALLBACK = 'Em andamento';

export function browserStatusLabel(status: string): string {
  return BROWSER_STATUS_LABELS[status] ?? BROWSER_STATUS_FALLBACK;
}

const BROWSER_ERROR_MESSAGES: Record<string, string> = {
  BROWSER_RUNTIME_UNAUTHORIZED: 'Não consegui entrar no sistema agora.',
  BROWSER_RUNTIME_UNAVAILABLE: 'O acesso ao sistema está indisponível no momento.',
  NETWORK_BLOCKED: 'Esse site não está liberado para esta empresa.',
  ELEMENT_NOT_FOUND:
    'A página mudou e não encontrei o que precisava. Interrompi para não agir no lugar errado.',
  NO_PROGRESS: 'A página não mudou depois de algumas tentativas. Interrompi para não ficar preso.',
  'Browser Agent reached its step limit': 'Não consegui concluir o acesso dentro do tempo previsto.',
};

export const BROWSER_ERROR_FALLBACK = 'Não consegui concluir o acesso ao sistema.';

/** Mapped errors stay in plain language. Anything else never shows a raw code. */
export function browserUserError(error: string): string {
  return BROWSER_ERROR_MESSAGES[error] ?? BROWSER_ERROR_FALLBACK;
}

/** Host only. Paths and query strings stay off the card. */
export function browserProgressHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Readable filenames keep their name. Opaque ids become a generic download. */
export function browserDownloadLabel(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? '';
  const stem = base.replace(/\.[a-z0-9]{1,8}$/i, '');
  const readable = /[a-zà-ú]/i.test(stem) && !/^[a-f0-9-]{16,}$/i.test(stem);
  return readable ? `Baixar ${base}` : 'Baixar relatório';
}
