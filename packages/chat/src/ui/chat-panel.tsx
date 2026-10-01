'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, RotateCcw, StopCircle, Wand, Zap } from 'lucide-react';
import {
  BROWSER_RETRY_POLL_MS,
  browserResultWaitExpired,
  browserDownloadLabel,
  browserProgressHost,
  browserStatusLabel,
  browserUserError,
  isBrowserTaskQueuedStale,
  browserCardBlocksFollowUps,
  browserTaskPollDelay,
  canStopBrowserTask,
  conversationBlocksFollowUps,
  isBrowserTaskActive,
} from '../browser-task-ui';
import { ACTION_TYPE_LABELS, errorMessage } from '../format';
import type { ChatMessageView, ChatProposal, ChatSource } from '../protocol';
import {
  STREAMING_MESSAGE_ID,
  WORK_CHECKED_LABEL,
  WORK_THINKING_LABEL,
  appendBrowserResponse,
  applyStreamEvent,
  buildWorkTrail,
  hasNonSystemWork,
  historyFromMessages,
  parseSseFrames,
  sourceLines,
  sourceSummary,
  streamEventEffects,
  type WorkCursor,
  type WorkTrailStep,
} from './chat-client';
import { cn } from './cn';
import './tactia-shine.css';
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
  const [work, setWork] = useState<WorkCursor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prefillHandled = useRef(false);
  const initialBrowserIds = useRef(
    new Set(initialMessages.flatMap((message) => message.browserTaskIds ?? [])),
  );
  const [browserActivity, setBrowserActivity] = useState<Record<string, boolean>>({});
  const reportBrowserActivity = useCallback((taskId: string, working: boolean) => {
    setBrowserActivity((current) => (current[taskId] === working ? current : { ...current, [taskId]: working }));
  }, []);

  const visibleMessages = messages.filter(
    (message) => message.role === 'user' || message.role === 'assistant',
  );
  const isEmpty = visibleMessages.length === 0;
  const lastAssistant = [...visibleMessages].reverse().find((m) => m.role === 'assistant');
  const browserTaskIds = visibleMessages.flatMap((message) => message.browserTaskIds ?? []);
  const pendingBrowserIds = new Set(
    browserTaskIds.filter((id) => !initialBrowserIds.current.has(id)),
  );
  const browserWorking = conversationBlocksFollowUps(browserTaskIds, browserActivity, pendingBrowserIds);

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
    setWork(null);
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
          if (effects.work !== undefined) setWork(effects.work);
          if (effects.error) setError(errorMessage(effects.error.code, effects.error.message));
        }
      }
    } catch (streamError) {
      const message = streamError instanceof Error ? streamError.message : 'Falha no chat.';
      setError(message);
      setMessages((current) => current.filter((item) => item.id !== STREAMING_MESSAGE_ID));
    } finally {
      setStreaming(false);
      setWork(null);
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
                      work={message.id === STREAMING_MESSAGE_ID ? work : null}
                      canApprove={canApprove}
                      canControl={canControl}
                      endpoints={endpoints}
                      onBrowserResponse={receiveBrowserResponse}
                      onBrowserActivity={reportBrowserActivity}
                      pendingBrowserIds={pendingBrowserIds}
                      {...(onApprovalResolved ? { onApprovalResolved } : {})}
                    />
                  </MessageScrollerItem>
                ))
              )}

              {!streaming &&
              !browserWorking &&
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
          <div className="relative flex items-end gap-2 rounded-3xl border border-input bg-card p-2 shadow-none transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus-within:border-primary">
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
              className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none outline-none focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-none! disabled:cursor-not-allowed disabled:opacity-60"
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
              {streaming ? null : <ArrowUp className="size-4" />}
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
  work,
  canApprove,
  canControl,
  endpoints,
  onApprovalResolved,
  onBrowserResponse,
  onBrowserActivity,
  pendingBrowserIds,
}: {
  message: ChatMessageView;
  work: WorkCursor | null;
  canApprove: boolean;
  canControl: boolean;
  endpoints: ChatEndpoints;
  onApprovalResolved?: () => void;
  onBrowserResponse: (response: ChatMessageView) => void;
  onBrowserActivity: (taskId: string, working: boolean) => void;
  pendingBrowserIds: ReadonlySet<string>;
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
    >
      {message.id === STREAMING_MESSAGE_ID ? (
        <WorkTrail
          toolsUsed={message.toolsUsed ?? []}
          cursor={work}
          answering={message.content.length > 0}
          hasSystemCard={(message.browserTaskIds?.length ?? 0) > 0}
        />
      ) : null}

      {message.content || message.id !== STREAMING_MESSAGE_ID ? (
        <ChatMessageContent
          content={message.content}
          streaming={message.id === STREAMING_MESSAGE_ID}
          variant={isError ? 'error' : 'assistant'}
        />
      ) : null}

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
        <SourceFooter sources={message.sources} />
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
        <BrowserTaskCard
          key={id}
          taskId={id}
          canControl={canControl}
          endpoints={endpoints}
          assumeWorking={pendingBrowserIds.has(id)}
          onResponse={onBrowserResponse}
          onActivity={onBrowserActivity}
        />
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

/**
 * Acesso a um sistema web: o objetivo e o passo atual ficam à vista.
 * O histórico é uma lista de frases, sem horário, código ou caminho.
 */
function BrowserTaskCard({
  taskId,
  canControl,
  endpoints,
  assumeWorking,
  onResponse,
  onActivity,
}: {
  taskId: string;
  canControl: boolean;
  endpoints: ChatEndpoints;
  /** Task started in this visit: treat it as working before the first status arrives. */
  assumeWorking: boolean;
  onResponse: (response: ChatMessageView) => void;
  onActivity: (taskId: string, working: boolean) => void;
}) {
  const [task, setTask] = useState<BrowserTaskView | null>(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState('');
  const [resultWaitExpired, setResultWaitExpired] = useState(false);
  const onResponseRef = useRef(onResponse);
  const resultWaitStarted = useRef<number | null>(null);
  onResponseRef.current = onResponse;

  const status = task?.status ?? 'QUEUED';
  const active = isBrowserTaskActive(status);
  const queuedStale = isBrowserTaskQueuedStale(status, task?.createdAt);
  const working =
    task != null &&
    !resultWaitExpired &&
    browserCardBlocksFollowUps(task.status, Boolean(task.chatResponse));
  const awaitingAnswer = task != null && !active && working;

  useEffect(() => {
    if (!task) return;
    onActivity(taskId, working);
  }, [task, taskId, working, onActivity]);

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
        // A poll that started before "Parar" must not resurrect the task in the UI.
        setTask((current) =>
          current && !isBrowserTaskActive(current.status) && isBrowserTaskActive(next.status)
            ? current
            : next,
        );
        const awaitingResult =
          !isBrowserTaskActive(next.status) &&
          browserCardBlocksFollowUps(next.status, Boolean(next.chatResponse));
        if (!awaitingResult) resultWaitStarted.current = null;
        else resultWaitStarted.current ??= Date.now();
        const expired = browserResultWaitExpired(resultWaitStarted.current);
        if (expired) setResultWaitExpired(true);
        const delay = expired
          ? null
          : browserTaskPollDelay(
              next.status,
              live,
              browserCardBlocksFollowUps(next.status, Boolean(next.chatResponse)),
            );
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
      setStopError(cause instanceof Error ? cause.message : 'Não foi possível parar.');
    } finally {
      setStopping(false);
    }
  }

  const progress = task?.progress ?? [];
  const latest = progress.at(-1);
  const showStop = canStopBrowserTask(status, canControl);
  const showTimelineToggle = active || progress.length > 0;

  const currentAction = active && latest ? progressSentence(latest) : null;

  const showShine = task ? working : assumeWorking;

  return (
    <section
      className={cn(
        'relative mt-4 overflow-hidden rounded-2xl border border-border bg-card',
        showShine && 'tactia-card-working',
      )}
      aria-label="Acessando o sistema"
      aria-busy={showShine || undefined}
    >
      {showShine ? <div className="tactia-card-shine" aria-hidden /> : null}
      <div className="relative">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'size-2 rounded-full',
              active ? 'bg-primary motion-safe:animate-pulse' : status === 'COMPLETED' ? 'bg-success' : 'bg-muted-foreground/60',
            )}
            aria-hidden
          />
          <h3 className="text-sm font-medium">Acessando o sistema</h3>
        </div>
        <span role="status" className="text-xs text-muted-foreground">
          {awaitingAnswer ? 'Escrevendo a resposta' : browserStatusLabel(status)}
        </span>
      </div>

      <div className="space-y-3 px-4 py-4">
        {!task ? (
          <p className="text-sm text-muted-foreground">Preparando o acesso…</p>
        ) : null}

        {currentAction ? (
          <p className="text-sm" aria-live="polite">
            {currentAction}
          </p>
        ) : null}

        {queuedStale ? (
          <Alert tone="warning" title="Ainda não começou">
            Se continuar assim, quem administra a Tactia precisa conferir o serviço.
          </Alert>
        ) : null}

        {task?.legacyApproval ? (
          <Alert tone="warning" title="Esta tarefa não continua">
            Peça de novo.
          </Alert>
        ) : null}

        {status === 'CANCELLED' && !task?.safeError ? (
          <p className="text-xs text-muted-foreground">Interrompida por você.</p>
        ) : null}

        {task?.safeError ? (
          <Alert
            tone={status === 'CANCELLED' ? 'warning' : 'danger'}
            title={status === 'CANCELLED' ? 'Acesso encerrado' : 'Não consegui concluir'}
          >
            {browserUserError(task.safeError)}
          </Alert>
        ) : null}

        {showTimelineToggle || showStop ? (
          <Collapsible open={live} onOpenChange={setLive}>
            <div className="flex flex-wrap items-center gap-2">
              {showTimelineToggle ? (
                <CollapsibleTrigger
                  render={<Button type="button" variant="outline" className="min-h-11" />}
                >
                  {live ? 'Ocultar' : 'Ver o que foi feito'}
                </CollapsibleTrigger>
              ) : null}
              {showStop ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="min-h-11"
                  loading={stopping}
                  onClick={() => void stop()}
                >
                  {stopping ? null : <StopCircle aria-hidden />}
                  {stopping ? 'Parando…' : 'Parar'}
                </Button>
              ) : null}
            </div>
            <CollapsibleContent>
              <ol aria-label="O que foi feito" className="mt-3 space-y-2 text-sm">
                {progress.length === 0 ? (
                  <li className="text-muted-foreground">
                    {status === 'QUEUED' ? 'Preparando o acesso…' : 'Ainda não há passos.'}
                  </li>
                ) : (
                  progress.map((item, index) => {
                    const current = active && index === progress.length - 1;
                    const host = browserProgressHost(item.url);
                    const failed = item.status === 'FAILED' || item.status === 'REJECTED';
                    return (
                      <li
                        key={item.id}
                        className="flex items-start gap-2"
                        aria-current={current ? 'step' : undefined}
                      >
                        <span
                          className={cn(
                            'mt-2 h-px w-3 shrink-0',
                            failed ? 'bg-danger' : current ? 'bg-primary' : 'bg-muted-foreground/40',
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className={cn(current ? 'text-foreground' : 'text-muted-foreground')}>
                            {progressSentence(item)}
                          </span>
                          {host ? (
                            <span className="block truncate text-xs text-muted-foreground">{host}</span>
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
                  className="inline-flex min-h-11 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-primary hover:border-primary/40"
                >
                  {browserDownloadLabel(artifact.filename)}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      </div>
    </section>
  );
}

function progressSentence(item: BrowserTaskProgress): string {
  if (item.status === 'FAILED' || item.status === 'REJECTED') return 'Não consegui concluir esse passo';
  return item.label;
}

function WorkTrail({
  toolsUsed,
  cursor,
  answering,
  hasSystemCard,
}: {
  toolsUsed: string[];
  cursor: WorkCursor | null;
  answering: boolean;
  hasSystemCard: boolean;
}) {
  const [showHidden, setShowHidden] = useState(false);

  if (answering) {
    if (!hasNonSystemWork(toolsUsed)) return null;
    return <p className="mb-3 text-xs text-muted-foreground">{WORK_CHECKED_LABEL}</p>;
  }

  const { visible, hidden } = buildWorkTrail(toolsUsed, cursor, { omitSystem: hasSystemCard });
  if (visible.length === 0) {
    if (hasSystemCard) return null;
    return (
      <ul className="mb-3">
        <WorkTrailLine label={WORK_THINKING_LABEL} status="active" live />
      </ul>
    );
  }

  const liveStep = visible.find((step) => step.status !== 'done');

  return (
    <div className="mb-3">
      {hidden.length > 0 ? (
        <button
          type="button"
          aria-expanded={showHidden}
          onClick={() => setShowHidden((open) => !open)}
          className="mb-1 min-h-11 text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {showHidden
            ? 'Ocultar'
            : `Já conferi mais ${hidden.length} ${hidden.length === 1 ? 'item' : 'itens'}`}
        </button>
      ) : null}
      <ul className="space-y-1.5">
        {showHidden
          ? hidden.map((step, index) => (
              <WorkTrailLine key={`hidden-${step.phase}-${index}`} label={step.label} status={step.status} />
            ))
          : null}
        {visible.map((step, index) => (
          <WorkTrailLine
            key={`${step.phase}-${index}`}
            label={step.label}
            status={step.status}
            live={liveStep === step}
          />
        ))}
      </ul>
    </div>
  );
}

function WorkTrailLine({
  label,
  status,
  live = false,
}: {
  label: string;
  status: WorkTrailStep['status'];
  live?: boolean;
}) {
  const current = status !== 'done';
  return (
    <li
      className="flex items-start gap-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
      {...(live ? { 'aria-live': 'polite' as const } : {})}
    >
      {current ? (
        <span
          className={cn(
            'mt-1.5 size-1.5 shrink-0 rounded-full bg-primary',
            status === 'active' && 'motion-safe:animate-pulse',
          )}
          aria-hidden
        />
      ) : (
        <span className="mt-2 h-px w-3 shrink-0 bg-muted-foreground/40" aria-hidden />
      )}
      <span className={cn(current ? 'text-sm text-foreground' : 'text-xs text-muted-foreground')}>{label}</span>
    </li>
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

/** Quiet citation: metric and period, never the tool that fetched them. */
function SourceFooter({ sources }: { sources: ChatSource[] }) {
  const summary = sourceSummary(sources);
  const lines = sourceLines(sources);
  if (!summary || lines.length === 0) return null;

  return (
    <Collapsible className="mt-4">
      <CollapsibleTrigger
        className="inline-flex min-h-11 items-center text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {summary}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
          {lines.map((line) => (
            <li key={line.key}>{line.label}</li>
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
