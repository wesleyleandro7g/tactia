'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Eye, EyeOff, RotateCcw, StopCircle, Wand, Zap } from 'lucide-react';
import {
  BROWSER_PROGRESS_STATUS_LABELS,
  BROWSER_RETRY_POLL_MS,
  BROWSER_STATUS_LABELS,
  isBrowserTaskQueuedStale,
  browserTaskPollDelay,
  canStopBrowserTask,
  isBrowserTaskActive,
} from '../browser-task-ui';
import { ACTION_TYPE_LABELS, errorMessage, formatPeriod, metricLabel } from '../format';
import type { ChatMessageView, ChatProposal, ChatSource } from '../protocol';
import {
  STREAMING_MESSAGE_ID,
  appendBrowserResponse,
  applyStreamEvent,
  historyFromMessages,
  parseSseFrames,
  streamEventEffects,
  uniqueToolLabels,
} from './chat-client';
import { cn } from './cn';
import type { ChatEndpoints } from './endpoints';
import { ChatMessageContent } from './message-content';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from './message-scroller';
import {
  Alert,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Textarea,
} from './primitives';

export const DEFAULT_CHAT_SUGGESTIONS = [
  'Quanto vendemos este mês?',
  'Qual foi nosso melhor produto?',
  'Quem mais vendeu?',
  'Por que nossas vendas caíram?',
] as const;

export type ChatPanelProps = {
  endpoints: ChatEndpoints;
  /**
   * `persistent`: conversation stored server-side (web). `ephemeral`: history
   * lives only in this component and is replayed on each turn (admin test chat).
   */
  mode: 'persistent' | 'ephemeral';
  /** Persistent mode: `null` starts a new conversation on the first question. */
  conversationId?: string | null;
  initialMessages?: ChatMessageView[];
  llmConfigured: boolean;
  canApprove: boolean;
  /** Members, admins and owners can follow and stop Browser Agent tasks. */
  canControl: boolean;
  /** Question from `?q=`: sent automatically (`autoSend`) or left as a draft. */
  prefill?: { question: string; autoSend: boolean } | null;
  suggestions?: readonly string[];
  emptyTitle?: string;
  emptyDescription?: string;
  placeholder?: string;
  /** Rendered above the messages (e.g. the admin "test session" notice). */
  notice?: React.ReactNode;
  onTurnComplete?: (info: { conversationId: string | null; createdConversation: boolean }) => void;
  onApprovalResolved?: () => void;
};

/**
 * Chat da Tactia com streaming (SSE), fontes por resposta e proposta de ação.
 *
 * A proposta nunca é executada aqui: o cartão leva para a aprovação, que é o
 * único caminho de execução (spec §44).
 */
export function ChatPanel({
  endpoints,
  mode,
  conversationId = null,
  initialMessages = [],
  llmConfigured,
  canApprove,
  canControl,
  prefill = null,
  suggestions = DEFAULT_CHAT_SUGGESTIONS,
  emptyTitle = 'Como posso ajudar?',
  emptyDescription = 'Pergunte sobre vendas, clientes ou insights. Cada número vem dos dados da sua empresa, com fonte citada.',
  placeholder = 'Pergunte sobre o seu negócio…',
  notice = null,
  onTurnComplete,
  onApprovalResolved,
}: ChatPanelProps) {
  const [activeId, setActiveId] = useState(conversationId);
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  const [draft, setDraft] = useState(() =>
    prefill && !prefill.autoSend ? prefill.question.trim() : '',
  );
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prefillHandled = useRef(false);

  const visibleMessages = messages.filter(
    (message) => message.role === 'user' || message.role === 'assistant',
  );
  const isEmpty = visibleMessages.length === 0;
  const lastAssistant = [...visibleMessages].reverse().find((m) => m.role === 'assistant');

  /** Prefill (ex.: "Perguntar no chat" de um insight): enviado uma única vez. */
  useEffect(() => {
    if (prefillHandled.current || !prefill?.question.trim()) return;
    prefillHandled.current = true;
    if (prefill.autoSend && llmConfigured) {
      void send(prefill.question);
    } else {
      inputRef.current?.focus();
    }
  }, [prefill]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [draft]);

  /** Persistent mode creates the conversation only when the first question is sent. */
  async function ensureConversation(): Promise<{ id: string | null; created: boolean }> {
    if (mode === 'ephemeral') return { id: null, created: false };
    if (activeId) return { id: activeId, created: false };
    const id = (await endpoints.createConversation?.()) ?? null;
    if (!id) throw new Error('Não foi possível iniciar a conversa.');
    setActiveId(id);
    return { id, created: true };
  }

  async function send(question: string) {
    const content = question.trim();
    if (!content || streaming) return;

    // Ephemeral sessions replay the completed turns before this question.
    const history = mode === 'ephemeral' ? historyFromMessages(messages) : [];

    setDraft('');
    setError(null);
    setStreaming(true);
    setActivity('pensando');
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: 'user', content },
      { id: STREAMING_MESSAGE_ID, role: 'assistant', content: '', toolsUsed: [] },
    ]);

    let conversation: { id: string | null; created: boolean } = { id: activeId, created: false };

    try {
      conversation = await ensureConversation();
      const response = await endpoints.sendTurn({
        conversationId: conversation.id,
        content,
        history,
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string; message?: string };
        } | null;
        throw new Error(body?.error?.message ?? errorMessage(body?.error?.code));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseFrames(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) {
          setMessages((current) => applyStreamEvent(current, event).messages);
          const effects = streamEventEffects(event);
          if (effects.activity !== undefined) setActivity(effects.activity);
          if (effects.error) setError(errorMessage(effects.error.code, effects.error.message));
        }
      }
    } catch (streamError) {
      const message = streamError instanceof Error ? streamError.message : 'Falha no chat.';
      setError(message);
      setMessages((current) => current.filter((item) => item.id !== STREAMING_MESSAGE_ID));
    } finally {
      setStreaming(false);
      setActivity(null);
      inputRef.current?.focus();
      onTurnComplete?.({
        conversationId: conversation.id,
        createdConversation: conversation.created,
      });
    }
  }

  function receiveBrowserResponse(response: ChatMessageView) {
    setMessages((current) => appendBrowserResponse(current, response));
  }

  function reset() {
    setMessages([]);
    setError(null);
    setDraft('');
    inputRef.current?.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {!llmConfigured ? (
        <div className="shrink-0 px-4 pt-4">
          <Alert tone="warning" title="Chat indisponível">
            Configure <code>LLM_API_KEY</code> (ou <code>LLM_PROVIDER=mock</code>) para conversar com a
            Tactia.
          </Alert>
        </div>
      ) : null}

      {notice ? <div className="shrink-0 px-4 pt-4">{notice}</div> : null}

      {/* Área de mensagens — scroll restrito ao viewport via MessageScroller */}
      <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label="Mensagens da conversa">
            <MessageScrollerContent
              className={cn(
                'mx-auto w-full max-w-3xl px-4 py-6',
                isEmpty && 'items-center justify-center',
              )}
              aria-busy={streaming || undefined}
            >
              {isEmpty ? (
                <MessageScrollerItem messageId="empty-state">
                  <EmptyState
                    llmConfigured={llmConfigured}
                    suggestions={suggestions}
                    title={emptyTitle}
                    description={emptyDescription}
                    onSuggestion={send}
                  />
                </MessageScrollerItem>
              ) : (
                visibleMessages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === 'user'}
                  >
                    <MessageRow
                      message={message}
                      canApprove={canApprove}
                      canControl={canControl}
                      endpoints={endpoints}
                      onBrowserResponse={receiveBrowserResponse}
                      {...(onApprovalResolved ? { onApprovalResolved } : {})}
                    />
                  </MessageScrollerItem>
                ))
              )}

              {!streaming &&
              lastAssistant &&
              !lastAssistant.error &&
              lastAssistant.followUps &&
              lastAssistant.followUps.length > 0 ? (
                <MessageScrollerItem messageId="follow-ups">
                  <FollowUpChips
                    followUps={lastAssistant.followUps}
                    disabled={!llmConfigured}
                    onPick={(question) => void send(question)}
                  />
                </MessageScrollerItem>
              ) : null}

              {activity ? (
                <MessageScrollerItem messageId="activity">
                  <ActivityIndicator activity={activity} />
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      {/* Composer fixo na base */}
      <div className="relative shrink-0 border-t border-border bg-background px-4 py-4 lg:px-6">
        {error ? (
          <div className="mx-auto mb-3 max-w-3xl">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
          className="mx-auto max-w-3xl"
        >
          <div className="relative flex items-end gap-2 rounded-3xl border border-input bg-card p-2 shadow-none transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/40">
            <label htmlFor="chat-input" className="sr-only">
              Sua pergunta
            </label>
            <Textarea
              id="chat-input"
              ref={inputRef}
              rows={1}
              maxLength={4000}
              value={draft}
              disabled={!llmConfigured || streaming}
              placeholder={placeholder}
              className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
                if (event.key === 'Escape') setDraft('');
              }}
            />
            <Button
              type="submit"
              size="icon"
              loading={streaming}
              disabled={!llmConfigured || draft.trim() === ''}
              aria-label="Enviar mensagem"
              className="size-9 shrink-0 rounded-full"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>

          <div className="mt-1.5 flex items-center justify-center gap-3">
            {draft.length > 3500 ? (
              <p className="text-center text-xs text-muted-foreground">{draft.length}/4000 caracteres</p>
            ) : (
              <p className="text-center text-[0.7rem] text-muted-foreground">
                Enter para enviar · Shift+Enter para nova linha
              </p>
            )}
            {mode === 'ephemeral' && !isEmpty ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={streaming}
                onClick={reset}
                className="text-[0.7rem] text-muted-foreground"
              >
                <RotateCcw aria-hidden />
                Limpar conversa
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

function EmptyState({
  llmConfigured,
  suggestions,
  title,
  description,
  onSuggestion,
}: {
  llmConfigured: boolean;
  suggestions: readonly string[];
  title: string;
  description: string;
  onSuggestion: (text: string) => void;
}) {
  return (
    <div className="flex max-w-lg flex-col items-center text-center">
      <div
        className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-primary/15 bg-primary/5"
        aria-hidden="true"
      >
        <Zap className="size-6 text-primary" />
      </div>
      <h2 className="font-display text-3xl tracking-tight">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <ul className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        {suggestions.map((suggestion) => (
          <li key={suggestion}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!llmConfigured}
              onClick={() => onSuggestion(suggestion)}
              className="rounded-full"
            >
              {suggestion}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageRow({
  message,
  canApprove,
  canControl,
  endpoints,
  onApprovalResolved,
  onBrowserResponse,
}: {
  message: ChatMessageView;
  canApprove: boolean;
  canControl: boolean;
  endpoints: ChatEndpoints;
  onApprovalResolved?: () => void;
  onBrowserResponse: (response: ChatMessageView) => void;
}) {
  const isUser = message.role === 'user';
  const isError = Boolean(message.error);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-3xl rounded-br-md bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground"
          aria-live={message.id === STREAMING_MESSAGE_ID ? 'polite' : undefined}
        >
          <ChatMessageContent content={message.content} variant="user" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'min-w-0 text-sm leading-relaxed',
        isError && 'rounded-xl border border-danger/30 bg-danger-soft px-4 py-3',
      )}
      aria-live={message.id === STREAMING_MESSAGE_ID ? 'polite' : undefined}
    >
      {message.id === STREAMING_MESSAGE_ID && message.toolsUsed && message.toolsUsed.length > 0 ? (
        <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
          Consultou: {uniqueToolLabels(message.toolsUsed).join(', ')}
        </p>
      ) : null}

      <ChatMessageContent
        content={message.content}
        streaming={message.id === STREAMING_MESSAGE_ID}
        variant={isError ? 'error' : 'assistant'}
      />

      {message.attachments && message.attachments.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3">
          {message.attachments.map((attachment) => (
            <figure
              key={attachment.id}
              className="max-w-md overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_12px_40px_-24px_rgba(19,18,18,0.45)] ring-1 ring-black/[0.03]"
            >
              <div className="h-1 w-full bg-brand" aria-hidden />
              <img
                src={endpoints.assetUrl(attachment.url)}
                alt={attachment.title}
                className="h-auto w-full object-cover"
                loading="lazy"
              />
              <figcaption className="flex items-center justify-between gap-3 border-t border-border/80 bg-secondary/40 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                    Infográfico
                  </p>
                  <p className="truncate text-xs font-medium text-foreground">{attachment.title}</p>
                </div>
                <a
                  href={endpoints.assetUrl(attachment.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  Abrir
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {message.id !== STREAMING_MESSAGE_ID && message.sources && message.sources.length > 0 ? (
        <SourceChips sources={message.sources} toolsUsed={message.toolsUsed ?? []} />
      ) : null}

      {message.proposals?.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          canApprove={canApprove}
          endpoints={endpoints}
          {...(onApprovalResolved ? { onResolved: onApprovalResolved } : {})}
        />
      ))}

      {message.browserTaskIds?.map((id) => (
        <BrowserTaskCard key={id} taskId={id} canControl={canControl} endpoints={endpoints} onResponse={onBrowserResponse} />
      ))}
    </div>
  );
}

type BrowserTaskProgress = {
  id: string;
  actionType: string;
  label: string;
  status: string;
  errorCode: string | null;
  url: string | null;
  createdAt: string;
};

type BrowserTaskView = {
  id: string;
  status: string;
  objective: string;
  stepCount: number;
  createdAt?: string;
  legacyApproval?: boolean;
  result?: { summary?: string; text?: string } | null;
  safeError?: string | null;
  artifacts: Array<{ id: string; filename: string; type: string; url: string }>;
  progress?: BrowserTaskProgress[];
  chatResponse?: ChatMessageView | null;
};

const BROWSER_ERROR_MESSAGES: Record<string, string> = {
  BROWSER_RUNTIME_UNAUTHORIZED:
    'O Browser Runtime rejeitou a autenticação. Verifique se o token do Web e dos containers é o mesmo.',
  BROWSER_RUNTIME_UNAVAILABLE: 'O Browser Runtime está indisponível no momento.',
  NETWORK_BLOCKED: 'O domínio acessado não está autorizado no perfil deste sistema.',
  ELEMENT_NOT_FOUND:
    'O elemento indicado não existe mais no snapshot atual da página. A tarefa foi interrompida antes de executar uma ação no elemento errado.',
  NO_PROGRESS:
    'A página não mudou após três tentativas de recuperação. O agente interrompeu a tarefa para não entrar em loop.',
  'Browser Agent reached its step limit':
    'O Browser Agent atingiu o limite de ações sem concluir a tarefa. A execução foi interrompida para evitar um loop.',
};

function browserErrorMessage(error: string): string {
  return BROWSER_ERROR_MESSAGES[error] ?? error;
}

function progressLocation(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.hash}`;
  } catch {
    return null;
  }
}

function progressTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Cartão do Browser Agent: a tarefa roda de forma autônoma; o usuário acompanha
 * as ações ao vivo e pode interrompê-la a qualquer momento.
 */
function BrowserTaskCard({
  taskId,
  canControl,
  endpoints,
  onResponse,
}: {
  taskId: string;
  canControl: boolean;
  endpoints: ChatEndpoints;
  onResponse: (response: ChatMessageView) => void;
}) {
  const [task, setTask] = useState<BrowserTaskView | null>(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState('');
  const onResponseRef = useRef(onResponse);
  onResponseRef.current = onResponse;

  const status = task?.status ?? 'QUEUED';
  const active = isBrowserTaskActive(status);
  const queuedStale = isBrowserTaskQueuedStale(status, task?.createdAt);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(endpoints.browserTaskUrl(taskId), { cache: 'no-store' });
        const payload = (await response.json()) as {
          data?: BrowserTaskView;
          error?: { message?: string };
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.error?.message ?? 'Falha ao consultar tarefa.');
        }
        if (cancelled) return;
        const next = payload.data;
        setError('');
        if (next.chatResponse) onResponseRef.current(next.chatResponse);
        // A poll that started before "Parar agente" must not resurrect the task in the UI.
        setTask((current) =>
          current && !isBrowserTaskActive(current.status) && isBrowserTaskActive(next.status)
            ? current
            : next,
        );
        const delay = browserTaskPollDelay(next.status, live);
        if (delay !== null) timer = setTimeout(() => void poll(), delay);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Falha ao consultar tarefa.');
        timer = setTimeout(() => void poll(), BROWSER_RETRY_POLL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [taskId, live, endpoints]);

  async function stop() {
    setStopping(true);
    setStopError('');
    try {
      const response = await fetch(endpoints.cancelBrowserTaskUrl(taskId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: BrowserTaskView;
        error?: { code?: string; message?: string };
      } | null;
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.error?.message ?? errorMessage(payload?.error?.code));
      }
      setTask(payload.data);
    } catch (cause) {
      setStopError(cause instanceof Error ? cause.message : 'Não foi possível parar o agente.');
    } finally {
      setStopping(false);
    }
  }

  const progress = task?.progress ?? [];
  const latest = progress.at(-1);
  const showStop = canStopBrowserTask(status, canControl);
  const showTimelineToggle = active || progress.length > 0;

  return (
    <section
      className="mt-4 max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      aria-label="Tarefa do Browser Agent"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'size-2 rounded-full',
              active ? 'animate-pulse bg-primary' : status === 'COMPLETED' ? 'bg-success' : 'bg-muted-foreground/60',
            )}
            aria-hidden
          />
          <strong className="font-mono text-xs uppercase tracking-[0.12em]">Browser Agent</strong>
        </div>
        <span role="status" className="text-xs text-muted-foreground">
          {BROWSER_STATUS_LABELS[status] ?? status}
        </span>
      </div>

      <div className="space-y-3 px-4 py-4">
        {task ? (
          <p className="text-sm">{task.objective}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Carregando tarefa…</p>
        )}

        {status === 'RUNNING' ? (
          <p className="text-xs text-muted-foreground">
            {task?.stepCount ?? 0} {task?.stepCount === 1 ? 'ação concluída' : 'ações concluídas'}
            {latest ? ` · ${latest.label}` : ''}
          </p>
        ) : null}

        {queuedStale ? (
          <Alert tone="warning" title="Aguardando serviço de execução">
            A tarefa foi enfileirada, mas o worker ainda não a iniciou. Confirme que o processo Web está ativo com JOBS_ENABLED=true.
          </Alert>
        ) : null}

        {task?.legacyApproval ? (
          <Alert tone="warning" title="Execução antiga">
            Esta tarefa foi criada quando o Browser Agent ainda pedia aprovação e não continuará.
            Interrompa-a e solicite a tarefa novamente para rodar no modo autônomo.
          </Alert>
        ) : null}

        {task?.result?.summary ? (
          <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
            {task.result.summary}
          </p>
        ) : null}

        {status === 'CANCELLED' && !task?.safeError ? (
          <p className="text-xs text-muted-foreground">Interrompida pelo usuário.</p>
        ) : null}

        {task?.safeError ? (
          <Alert
            tone={status === 'CANCELLED' ? 'warning' : 'danger'}
            title={status === 'CANCELLED' ? 'Tarefa encerrada' : 'Não foi possível concluir a tarefa'}
          >
            {browserErrorMessage(task.safeError)}
            {status === 'FAILED' && latest ? ` Última ação: ${latest.label.toLowerCase()}.` : ''}
          </Alert>
        ) : null}

        {showTimelineToggle || showStop ? (
          <Collapsible open={live} onOpenChange={setLive}>
            <div className="flex flex-wrap items-center gap-2">
              {showTimelineToggle ? (
                <CollapsibleTrigger render={<Button type="button" variant="outline" size="sm" />}>
                  {live ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  {live
                    ? active
                      ? 'Ocultar acompanhamento'
                      : 'Ocultar histórico'
                    : active
                      ? 'Acompanhar ao vivo'
                      : `Ver histórico (${progress.length})`}
                </CollapsibleTrigger>
              ) : null}
              {showStop ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  loading={stopping}
                  onClick={() => void stop()}
                >
                  {stopping ? null : <StopCircle aria-hidden />}
                  {stopping ? 'Parando…' : 'Parar agente'}
                </Button>
              ) : null}
            </div>
            <CollapsibleContent>
              <ol
                role="log"
                aria-live="polite"
                aria-label="Ações executadas pelo Browser Agent"
                className="mt-3 max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs"
              >
                {progress.length === 0 ? (
                  <li className="text-muted-foreground">
                    {status === 'QUEUED' ? 'Aguardando início…' : 'Nenhuma ação registrada ainda.'}
                  </li>
                ) : (
                  progress.map((item, index) => {
                    const current = active && index === progress.length - 1;
                    const location = progressLocation(item.url);
                    return (
                      <li
                        key={item.id}
                        className="flex items-start gap-2"
                        aria-current={current ? 'step' : undefined}
                      >
                        <span
                          className={cn(
                            'mt-1 size-1.5 shrink-0 rounded-full',
                            item.status === 'FAILED'
                              ? 'bg-danger'
                              : current
                                ? 'animate-pulse bg-primary'
                                : 'bg-muted-foreground/50',
                          )}
                          aria-hidden
                        />
                        <span className="shrink-0 font-mono text-muted-foreground">
                          {progressTime(item.createdAt)}
                        </span>
                        <span className="min-w-0">
                          <span className={cn(current && 'font-medium text-foreground')}>
                            {item.label}
                          </span>
                          {item.status === 'FAILED' ? (
                            <span className="text-danger">
                              {' '}
                              — {BROWSER_PROGRESS_STATUS_LABELS.FAILED}
                              {item.errorCode ? ` (${item.errorCode})` : ''}
                            </span>
                          ) : null}
                          {location ? (
                            <span className="block truncate text-muted-foreground">{location}</span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })
                )}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {stopError ? (
          <p role="alert" className="text-xs text-danger">
            {stopError}
          </p>
        ) : null}
        {error ? (
          <p role="status" className="text-xs text-muted-foreground">
            {error}
          </p>
        ) : null}

        {task?.artifacts?.length ? (
          <ul className="flex flex-wrap gap-2">
            {task.artifacts.map((artifact) => (
              <li key={artifact.id}>
                <a
                  href={endpoints.assetUrl(artifact.url)}
                  className="inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-primary hover:border-primary/40"
                >
                  Baixar {artifact.filename}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function ActivityIndicator({ activity }: { activity: string }) {
  return (
    <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
      <span className="inline-flex gap-1" aria-hidden="true">
        <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
      </span>
      <span>Tactia está {activity}…</span>
    </div>
  );
}

/** Perguntas sugeridas pelo assistente ao final da resposta — um clique envia. */
function FollowUpChips({
  followUps,
  disabled,
  onPick,
}: {
  followUps: string[];
  disabled: boolean;
  onPick: (question: string) => void;
}) {
  return (
    <div className="mt-4" aria-label="Próximos passos sugeridos">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Wand className="size-3.5" aria-hidden="true" />
        Continuar a análise
      </p>
      <ul className="flex flex-wrap gap-2">
        {followUps.map((question) => (
          <li key={question}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onPick(question)}
              className="h-auto whitespace-normal rounded-full px-3 py-1.5 text-left text-xs"
            >
              {question}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Fonte: receita — 01/08/2026 a 01/09/2026" (spec §43). */
function SourceChips({ sources, toolsUsed }: { sources: ChatSource[]; toolsUsed: string[] }) {
  const metricNames = Array.from(new Set(sources.map((source) => metricLabel(source.metric))));
  return (
    <Collapsible className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between text-left text-xs font-medium text-muted-foreground">
        <span>
          Fontes · {metricNames.slice(0, 4).join(', ')}
          {metricNames.length > 4 ? ` +${metricNames.length - 4}` : ''}
        </span>
        {toolsUsed.length > 0 ? (
          <span className="ml-2 shrink-0 font-normal">
            {toolsUsed.length} {toolsUsed.length === 1 ? 'consulta' : 'consultas'}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {toolsUsed.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Consultou: {uniqueToolLabels(toolsUsed).join(', ')}
          </p>
        ) : null}
        <ul className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
          {sources.map((source, index) => (
            <li key={`${source.metric}-${index}`}>
              {metricLabel(source.metric)}
              {source.period ? ` — ${formatPeriod(source.period)}` : ''}
              {source.tool ? ` · ${source.tool}` : ''}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ProposalCard({
  proposal,
  canApprove,
  endpoints,
  onResolved,
}: {
  proposal: ChatProposal;
  canApprove: boolean;
  endpoints: ChatEndpoints;
  onResolved?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [resolved, setResolved] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    if (!proposal.approvalId) return;
    setPending(true);
    setError(null);

    const response = await fetch(endpoints.approvalDecisionUrl(proposal.approvalId, decision), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    setPending(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }

    setResolved(decision === 'approve' ? 'approved' : 'rejected');
    onResolved?.();
  }

  return (
    <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {ACTION_TYPE_LABELS[proposal.actionType] ?? proposal.actionType}
        </p>
        <Badge tone={resolved === 'approved' ? 'success' : resolved === 'rejected' ? 'neutral' : 'warning'}>
          {resolved === 'approved'
            ? 'Aprovada'
            : resolved === 'rejected'
              ? 'Recusada'
              : 'Pendente de aprovação'}
        </Badge>
      </div>

      {proposal.input ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {Object.entries(proposal.input).map(([key, value]) => (
            <div key={key} className="col-span-2 grid grid-cols-subgrid">
              <dt className="font-medium">{key}</dt>
              <dd className="truncate">{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {resolved === null && proposal.approvalId ? (
        canApprove ? (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="success" loading={pending} onClick={() => void decide('approve')}>
              Aprovar e executar
            </Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => void decide('reject')}>
              Recusar
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Apenas owner ou admin pode aprovar. A proposta está na fila de aprovações.
          </p>
        )
      ) : null}
    </div>
  );
}
