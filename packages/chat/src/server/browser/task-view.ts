type BrowserTaskArtifact = {
  id: string;
  filename: string;
  mimeType: string;
  type: string;
  byteSize: number;
};

type BrowserTaskRecord = {
  id: string;
  profileId: string;
  objective: string;
  status: string;
  stepCount: number;
  result: unknown;
  safeError: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  artifacts: BrowserTaskArtifact[];
  resultMessage?: { id: string; content: string; metadata: unknown } | null;
  actionLogs?: Array<{
    id: string;
    actionType: string;
    status: string;
    errorCode: string | null;
    urlAfter: string | null;
    createdAt: Date;
  }>;
};

const BROWSER_REJECTION_LABELS: Record<string, string> = {
  INVALID_TOOL_SCHEMA: 'Rejeitou argumentos fora do contrato',
  INVALID_FINISH: 'Rejeitou uma conclusão incompleta',
  MISSING_TARGET: 'Rejeitou ação sem referência do elemento',
  MISSING_URL: 'Rejeitou navegação sem URL',
  MISSING_VALUE: 'Rejeitou preenchimento sem valor',
  AMBIGUOUS_FILL_SOURCE: 'Rejeitou preenchimento ambíguo',
  MISSING_KEY: 'Rejeitou tecla ausente',
  INVALID_WAIT: 'Rejeitou espera inválida',
};

export const BROWSER_ACTION_LABELS: Record<string, string> = {
  click: 'Clicou em um elemento',
  fill: 'Preencheu um campo',
  press: 'Pressionou uma tecla',
  wait: 'Aguardou a página',
  scroll: 'Rolou a página',
  select: 'Selecionou uma opção',
  check: 'Marcou uma opção',
  hover: 'Posicionou o cursor',
  download: 'Baixou um arquivo',
  navigate: 'Abriu uma página',
  extract: 'Leu o conteúdo da página',
  screenshot: 'Capturou a tela',
};

/**
 * Keeps only origin, path and the hash route. Query strings (and query-like
 * fragments such as `#access_token=…`) may carry tokens, so they never leave
 * the server.
 */
export function safeProgressUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const hashRoute = url.hash.split('?')[0] ?? '';
    const hash = hashRoute.includes('=') || hashRoute.includes('&') ? '' : hashRoute;
    return `${url.origin}${url.pathname}${hash}`;
  } catch {
    return null;
  }
}


/** The assistant reply that follows the card: the answer itself, without the request. */
export function formatBrowserResultMessage(answer: string): string {
  return answer.trim();
}

/** Public, secret-free view of a Browser Agent task consumed by the chat card. */
export function toPublicBrowserTask(task: BrowserTaskRecord) {
  return {
    id: task.id,
    profileId: task.profileId,
    objective: task.objective,
    status: task.status,
    /** Tasks created before autonomous mode may still be parked for approval. */
    legacyApproval: task.status === 'WAITING_APPROVAL',
    stepCount: task.stepCount,
    result: task.result,
    safeError: task.safeError,
    chatResponse: (task.status === 'COMPLETED' || task.status === 'FAILED') && task.resultMessage
      ? {
          id: task.resultMessage.id,
          role: 'assistant' as const,
          content: task.resultMessage.content,
          browserResultTaskId: task.id,
          toolsUsed: ['browser_agent'],
        }
      : null,
    createdAt: task.createdAt,
    finishedAt: task.finishedAt,
    artifacts: task.artifacts.map((artifact) => ({
      ...artifact,
      url: `/api/v1/browser/artifacts/${artifact.id}`,
    })),
    progress: [...(task.actionLogs ?? [])]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-50)
      .map((action) => ({
        id: action.id,
        actionType: action.actionType,
        label: action.status === 'REJECTED'
          ? BROWSER_REJECTION_LABELS[action.errorCode ?? ''] ?? 'Rejeitou uma decisão inválida'
          : BROWSER_ACTION_LABELS[action.actionType] ?? 'Executou uma ação',
        status: action.status,
        errorCode: action.errorCode,
        url: safeProgressUrl(action.urlAfter),
        createdAt: action.createdAt,
      })),
  };
}
