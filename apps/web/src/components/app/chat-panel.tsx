'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUp, Wand, Zap } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { Textarea } from '@/components/ui/textarea';
import { ChatMessageContent } from '@/components/app/chat-message-content';
import { cn } from '@/lib/utils';
import { ACTION_TYPE_LABELS, errorMessage, formatPeriod, metricLabel } from '@/lib/format';

export type ChatSource = {
  metric: string;
  period?: { from: string; to: string };
  value?: number;
  tool?: string;
  label?: string;
};

export type ChatProposal = {
  id: string;
  actionType: string;
  status: string;
  requiresApproval: boolean;
  approvalId?: string | null;
  input?: Record<string, unknown>;
};

export type ChatMessageView = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  sources?: ChatSource[];
  proposals?: ChatProposal[];
  /** Perguntas sugeridas pelo assistente (bloco "Próximos passos"). */
  followUps?: string[];
  /** Nomes das tools consultadas para produzir a resposta. */
  toolsUsed?: string[];
  error?: string | null;
};

type StreamEvent =
  | { type: 'start'; conversationId: string; userMessageId: string }
  | { type: 'tool_call'; name: string; input: unknown }
  | {
      type: 'tool_result';
      name: string;
      sources?: ChatSource[];
      proposal?: ChatProposal;
      durationMs?: number;
      error?: string;
    }
  | { type: 'text'; delta: string }
  | {
      type: 'done';
      messageId: string;
      content: string;
      sources?: ChatSource[];
      proposals?: ChatProposal[];
      followUps?: string[];
      toolCalls?: Array<{ name: string; input?: unknown }>;
    }
  | { type: 'error'; code: string; message: string };

const SUGGESTIONS = [
  'Quanto vendemos este mês?',
  'Qual foi nosso melhor produto?',
  'Quem mais vendeu?',
  'Por que nossas vendas caíram?',
];

const TOOL_LABELS: Record<string, string> = {
  get_revenue: 'consultando a receita',
  get_sales: 'consultando as vendas',
  get_customers: 'consultando os clientes',
  get_products: 'consultando os produtos',
  get_sellers: 'consultando os vendedores',
  get_insights: 'consultando os insights',
  get_complaints: 'consultando as reclamações',
  get_customer_profile: 'consultando o perfil do cliente',
  get_customer_segments: 'analisando segmentos de clientes',
  get_customer_voice: 'analisando a voz do cliente',
  get_data_freshness: 'verificando atualização dos dados',
  get_period_projection: 'calculando projeção do período',
  get_pipeline: 'analisando o funil de leads',
  get_product_affinity: 'analisando cross-sell',
  get_product_performance: 'analisando desempenho dos produtos',
  get_sales_health: 'analisando saúde das vendas',
  get_seller_performance: 'analisando desempenho dos vendedores',
  search_interactions: 'buscando nas conversas',
  search_documents: 'buscando nos documentos',
  search_catalog: 'buscando no catálogo',
  propose_action: 'preparando uma proposta de ação',
  compare_periods: 'comparando períodos',
  explain_change: 'investigando a causa da variação',
  get_trend: 'analisando a tendência',
  get_insight_detail: 'lendo o detalhe do insight',
  get_forecast: 'calculando a projeção',
  get_latest_briefing: 'lendo o último briefing',
  get_goals_progress: 'verificando as metas',
  get_funnel: 'analisando o funil',
  remember_fact: 'anotando o fato',
  list_business_facts: 'consultando fatos do negócio',
  get_cohorts: 'analisando coortes',
  get_rfm: 'segmentando clientes (RFM)',
  simulate: 'simulando o cenário',
  get_profitability: 'analisando a lucratividade',
  get_cash_flow: 'analisando o caixa',
  get_inventory_risk: 'analisando o estoque',
  get_acquisition: 'analisando aquisição',
};

/** Nome curto da tool para o rodapé "Consultou: …". */
const TOOL_SHORT_LABELS: Record<string, string> = {
  get_revenue: 'receita',
  get_sales: 'vendas',
  get_customers: 'clientes',
  get_products: 'produtos',
  get_sellers: 'vendedores',
  get_insights: 'insights',
  get_complaints: 'reclamações',
  get_customer_profile: 'perfil do cliente',
  get_customer_segments: 'segmentos',
  get_customer_voice: 'voz do cliente',
  get_data_freshness: 'atualização dos dados',
  get_period_projection: 'projeção',
  get_pipeline: 'funil de leads',
  get_product_affinity: 'cross-sell',
  get_product_performance: 'desempenho de produtos',
  get_sales_health: 'saúde das vendas',
  get_seller_performance: 'desempenho de vendedores',
  search_interactions: 'conversas',
  search_documents: 'documentos',
  search_catalog: 'catálogo',
  propose_action: 'proposta de ação',
  compare_periods: 'comparação de períodos',
  explain_change: 'causa da variação',
  get_trend: 'tendência',
  get_insight_detail: 'detalhe do insight',
  get_forecast: 'projeção',
  get_latest_briefing: 'briefing',
  get_goals_progress: 'metas',
  get_funnel: 'funil',
  remember_fact: 'memória',
  list_business_facts: 'fatos do negócio',
  get_cohorts: 'coortes',
  get_rfm: 'RFM',
  simulate: 'simulação',
  get_profitability: 'lucratividade',
  get_cash_flow: 'caixa',
  get_inventory_risk: 'estoque',
  get_acquisition: 'aquisição',
};

function toolShortLabel(name: string): string {
  return TOOL_SHORT_LABELS[name] ?? name;
}

/**
 * Chat da Tactia com streaming (SSE), fontes por resposta e proposta de ação.
 *
 * A proposta nunca é executada aqui: o cartão leva para a aprovação, que é o
 * único caminho de execução (spec §44).
 */
export function ChatPanel({
  conversationId,
  initialMessages,
  llmConfigured,
  canApprove,
}: {
  /** `null` inicia uma conversa nova na primeira pergunta. */
  conversationId: string | null;
  initialMessages: ChatMessageView[];
  llmConfigured: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeId, setActiveId] = useState(conversationId);
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  // Em conversa existente, `?q=` vira rascunho editável (em conversa nova é enviado; ver efeito abaixo).
  const [draft, setDraft] = useState(() =>
    conversationId !== null ? (searchParams.get('q')?.trim() ?? '') : '',
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

  /**
   * Prefill via `?q=` (ex.: botão "Perguntar no chat" de um insight). Em conversa
   * nova a pergunta é enviada automaticamente, uma única vez.
   */
  useEffect(() => {
    if (prefillHandled.current) return;
    const q = searchParams.get('q')?.trim();
    if (!q) return;
    prefillHandled.current = true;
    if (conversationId === null && llmConfigured) {
      void send(q);
    } else {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [draft]);

  /** Cria a conversa só quando a primeira pergunta é enviada. */
  async function ensureConversation(): Promise<string | null> {
    if (activeId) return activeId;
    const response = await fetch('/api/v1/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data: { id: string } };
    setActiveId(body.data.id);
    return body.data.id;
  }

  async function send(question: string) {
    const content = question.trim();
    if (!content || streaming) return;

    setDraft('');
    setError(null);
    setStreaming(true);
    setActivity('pensando');
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: 'user', content },
      { id: 'streaming', role: 'assistant', content: '', toolsUsed: [] },
    ]);

    let createdNow = false;

    try {
      const cid = await ensureConversation();
      if (!cid) throw new Error('Não foi possível iniciar a conversa.');
      createdNow = activeId === null;

      const response = await fetch(`/api/v1/conversations/${cid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, stream: true }),
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        throw new Error(body?.error?.message ?? errorMessage(body?.error?.code));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame.split('\n').find((part) => part.startsWith('data: '));
          if (!line) continue;
          handleEvent(JSON.parse(line.slice(6)) as StreamEvent);
        }
      }

      if (createdNow && cid) router.replace(`/chat/${cid}`);
    } catch (streamError) {
      const message = streamError instanceof Error ? streamError.message : 'Falha no chat.';
      setError(message);
      setMessages((current) => current.filter((item) => item.id !== 'streaming'));
    } finally {
      setStreaming(false);
      setActivity(null);
      inputRef.current?.focus();
      router.refresh();
    }
  }

  function handleEvent(event: StreamEvent) {
    if (event.type === 'tool_call') {
      setActivity(TOOL_LABELS[event.name] ?? `usando ${event.name}`);
      return;
    }
    if (event.type === 'tool_result') {
      // Acumula as tools consultadas e as fontes parciais na mensagem em streaming
      // para que o usuário veja o que já foi verificado antes do texto final.
      setMessages((current) =>
        current.map((message) =>
          message.id === 'streaming'
            ? {
                ...message,
                toolsUsed: [...(message.toolsUsed ?? []), event.name],
                sources: [...(message.sources ?? []), ...(event.sources ?? [])],
              }
            : message,
        ),
      );
      if (event.error) setActivity(`não conseguiu ${toolShortLabel(event.name)} — tentando outra abordagem`);
      return;
    }
    if (event.type === 'text') {
      setActivity(null);
      setMessages((current) =>
        current.map((message) =>
          message.id === 'streaming'
            ? { ...message, content: message.content + event.delta }
            : message,
        ),
      );
      return;
    }
    if (event.type === 'done') {
      setMessages((current) =>
        current.map((message) =>
          message.id === 'streaming'
            ? {
                id: event.messageId,
                role: 'assistant',
                content: event.content,
                sources: event.sources ?? [],
                proposals: event.proposals ?? [],
                followUps: event.followUps ?? [],
                toolsUsed: event.toolCalls?.map((call) => call.name) ?? message.toolsUsed ?? [],
              }
            : message,
        ),
      );
      return;
    }
    if (event.type === 'error') {
      setMessages((current) =>
        current.map((message) =>
          message.id === 'streaming'
            ? { id: `error-${Date.now()}`, role: 'assistant', content: event.message, error: event.code }
            : message,
        ),
      );
      setError(errorMessage(event.code, event.message));
    }
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
                  <EmptyState llmConfigured={llmConfigured} onSuggestion={send} />
                </MessageScrollerItem>
              ) : (
                visibleMessages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === 'user'}
                  >
                    <MessageRow message={message} canApprove={canApprove} />
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
              placeholder="Pergunte sobre o seu negócio…"
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

          {draft.length > 3500 ? (
            <p className="mt-1.5 text-center text-xs text-muted-foreground">
              {draft.length}/4000 caracteres
            </p>
          ) : (
            <p className="mt-1.5 text-center text-[0.7rem] text-muted-foreground">
              Enter para enviar · Shift+Enter para nova linha
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

function EmptyState({
  llmConfigured,
  onSuggestion,
}: {
  llmConfigured: boolean;
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
      <h2 className="font-display text-3xl tracking-tight">Como posso ajudar?</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Pergunte sobre vendas, clientes ou insights. Cada número vem dos dados da sua empresa, com
        fonte citada.
      </p>
      <ul className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        {SUGGESTIONS.map((suggestion) => (
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
}: {
  message: ChatMessageView;
  canApprove: boolean;
}) {
  const isUser = message.role === 'user';
  const isError = Boolean(message.error);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-3xl rounded-br-md bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground"
          aria-live={message.id === 'streaming' ? 'polite' : undefined}
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
      aria-live={message.id === 'streaming' ? 'polite' : undefined}
    >
      {message.id === 'streaming' && message.toolsUsed && message.toolsUsed.length > 0 ? (
        <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
          Consultou: {uniqueLabels(message.toolsUsed).join(', ')}
        </p>
      ) : null}

      <ChatMessageContent
        content={message.content}
        streaming={message.id === 'streaming'}
        variant={isError ? 'error' : 'assistant'}
      />

      {message.id !== 'streaming' && message.sources && message.sources.length > 0 ? (
        <SourceChips sources={message.sources} toolsUsed={message.toolsUsed ?? []} />
      ) : null}

      {message.proposals?.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} canApprove={canApprove} />
      ))}
    </div>
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

function uniqueLabels(tools: string[]): string[] {
  return Array.from(new Set(tools.map(toolShortLabel)));
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
            Consultou: {uniqueLabels(toolsUsed).join(', ')}
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
}: {
  proposal: ChatProposal;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [resolved, setResolved] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    if (!proposal.approvalId) return;
    setPending(true);
    setError(null);

    const response = await fetch(`/api/v1/approvals/${proposal.approvalId}/${decision}`, {
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
    router.refresh();
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
