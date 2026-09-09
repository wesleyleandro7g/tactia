'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
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
  error?: string | null;
};

type StreamEvent =
  | { type: 'start'; conversationId: string; userMessageId: string }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; sources?: ChatSource[]; proposal?: ChatProposal }
  | { type: 'text'; delta: string }
  | {
      type: 'done';
      messageId: string;
      content: string;
      sources?: ChatSource[];
      proposals?: ChatProposal[];
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
  search_interactions: 'buscando nas conversas',
  propose_action: 'preparando uma proposta de ação',
};

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
  const [activeId, setActiveId] = useState(conversationId);
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, activity]);

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
      { id: 'streaming', role: 'assistant', content: '' },
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
    <div className="flex min-h-[70vh] flex-col gap-4">
      {!llmConfigured ? (
        <Alert tone="warning" title="Chat indisponível">
          Configure <code>LLM_API_KEY</code> (ou <code>LLM_PROVIDER=mock</code>) para conversar com a
          Tactia.
        </Alert>
      ) : null}

      <div className="flex-1 space-y-4">
        {messages.length === 0 ? (
          <Card>
            <p className="font-medium">Pergunte sobre o seu negócio</p>
            <p className="mt-1 text-sm text-muted">
              As respostas usam apenas dados da sua empresa e mostram a fonte de cada número.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!llmConfigured}
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <ul className="flex flex-col gap-4">
          {messages
            .filter((message) => message.role === 'user' || message.role === 'assistant')
            .map((message) => (
              <li
                key={message.id}
                className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[46rem] rounded-xl px-4 py-3 text-sm',
                    message.role === 'user'
                      ? 'bg-accent-soft text-fg'
                      : message.error
                        ? 'border border-danger/30 bg-danger-soft'
                        : 'border border-border bg-card',
                  )}
                  aria-live={message.id === 'streaming' ? 'polite' : undefined}
                >
                  <p className="whitespace-pre-wrap">
                    {message.content || (message.id === 'streaming' ? '…' : '')}
                  </p>

                  {message.sources && message.sources.length > 0 ? (
                    <SourceChips sources={message.sources} />
                  ) : null}

                  {message.proposals?.map((proposal) => (
                    <ProposalCard key={proposal.id} proposal={proposal} canApprove={canApprove} />
                  ))}
                </div>
              </li>
            ))}
        </ul>

        {activity ? (
          <p aria-live="polite" className="text-sm text-muted">
            Tactia está {activity}…
          </p>
        ) : null}

        <div ref={bottomRef} />
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className="sticky bottom-0 flex items-end gap-2 border-t border-border bg-bg pt-4"
      >
        <label htmlFor="chat-input" className="sr-only">
          Sua pergunta
        </label>
        <Textarea
          id="chat-input"
          ref={inputRef}
          rows={2}
          maxLength={4000}
          value={draft}
          disabled={!llmConfigured || streaming}
          placeholder="Quanto vendemos este mês?"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
            if (event.key === 'Escape') setDraft('');
          }}
        />
        <Button type="submit" loading={streaming} disabled={!llmConfigured || draft.trim() === ''}>
          Enviar
        </Button>
      </form>
      {draft.length > 3500 ? (
        <p className="text-xs text-muted">{draft.length}/4000 caracteres</p>
      ) : null}
    </div>
  );
}

/** "Fonte: receita — 01/08/2026 a 01/09/2026" (spec §43). */
function SourceChips({ sources }: { sources: ChatSource[] }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-muted">
        Fonte: {sources.map((source) => metricLabel(source.metric)).join(', ')}
      </summary>
      <ul className="mt-2 flex flex-col gap-1 text-xs text-subtle">
        {sources.map((source, index) => (
          <li key={`${source.metric}-${index}`}>
            {metricLabel(source.metric)}
            {source.period ? ` — ${formatPeriod(source.period)}` : ''}
            {source.tool ? ` · ${source.tool}` : ''}
          </li>
        ))}
      </ul>
    </details>
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
    <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft p-3">
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
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted">
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
          <p className="mt-2 text-xs text-muted">
            Apenas owner ou admin pode aprovar. A proposta está na fila de aprovações.
          </p>
        )
      ) : null}
    </div>
  );
}
