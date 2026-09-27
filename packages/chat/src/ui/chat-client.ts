import {
  CHAT_HISTORY_TURNS,
  CHAT_MAX_HISTORY_CONTENT,
  type ChatMessageView,
  type ChatStreamEvent,
} from '../protocol';

/**
 * Framework-free chat client logic (SSE parsing, streaming reducer, history)
 * shared by ChatPanel in both apps and covered by unit tests.
 */

export const STREAMING_MESSAGE_ID = 'streaming';

export const TOOL_LABELS: Record<string, string> = {
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
  generate_infographic: 'gerando um infográfico',
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
  list_browser_profiles: 'verificando os sistemas disponíveis',
  browser_delegate: 'iniciando o Browser Agent',
  browser_agent: 'concluindo a navegação',
};

/** Nome curto da tool para o rodapé "Consultou: …". */
export const TOOL_SHORT_LABELS: Record<string, string> = {
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
  list_browser_profiles: 'sistemas web',
  browser_delegate: 'Browser Agent',
  browser_agent: 'Browser Agent',
};

export function toolShortLabel(name: string): string {
  return TOOL_SHORT_LABELS[name] ?? name;
}

export function uniqueToolLabels(tools: string[]): string[] {
  return Array.from(new Set(tools.map(toolShortLabel)));
}

export function appendBrowserResponse(
  messages: ChatMessageView[],
  response: ChatMessageView,
): ChatMessageView[] {
  if (messages.some((message) =>
    message.browserResultTaskId === response.browserResultTaskId || message.id === response.id
  )) return messages;
  return [...messages, response];
}

/**
 * Splits an SSE buffer into complete `data:` events. Returns the parsed events
 * and the trailing partial frame to be prepended to the next chunk.
 */
export function parseSseFrames(buffer: string): { events: ChatStreamEvent[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: ChatStreamEvent[] = [];
  for (const frame of frames) {
    const line = frame.split('\n').find((part) => part.startsWith('data: '));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(6)) as ChatStreamEvent);
    } catch {
      // A malformed frame never breaks the stream; the next frames still apply.
    }
  }
  return { events, rest };
}

export type StreamReduction = {
  messages: ChatMessageView[];
  /** `undefined` keeps the current activity line; `null` clears it. */
  activity?: string | null;
  /** Set on `error` events so the panel can show the banner. */
  error?: { code: string; message: string };
};

function updateStreaming(
  messages: ChatMessageView[],
  update: (message: ChatMessageView) => ChatMessageView,
): ChatMessageView[] {
  return messages.map((message) => (message.id === STREAMING_MESSAGE_ID ? update(message) : message));
}

/** Side effects of an event that do not depend on the message list. */
export function streamEventEffects(event: ChatStreamEvent): Omit<StreamReduction, 'messages'> {
  if (event.type === 'tool_call') {
    return { activity: TOOL_LABELS[event.name] ?? `usando ${event.name}` };
  }
  if (event.type === 'tool_result' && event.error) {
    return { activity: `não conseguiu ${toolShortLabel(event.name)} — tentando outra abordagem` };
  }
  if (event.type === 'text') return { activity: null };
  if (event.type === 'error') return { error: { code: event.code, message: event.message } };
  return {};
}

/** Applies one SSE event to the message list (the `streaming` placeholder). */
export function applyStreamEvent(
  messages: ChatMessageView[],
  event: ChatStreamEvent,
  now: () => number = Date.now,
): StreamReduction {
  switch (event.type) {
    case 'start':
      return { messages };
    case 'tool_call':
      return { messages, ...streamEventEffects(event) };
    case 'tool_result':
      // Accumulates tools and partial sources so the user sees what was checked
      // before the final text arrives.
      return {
        messages: updateStreaming(messages, (message) => ({
          ...message,
          toolsUsed: [...(message.toolsUsed ?? []), event.name],
          sources: [...(message.sources ?? []), ...(event.sources ?? [])],
          attachments: event.attachment
            ? [...(message.attachments ?? []), event.attachment]
            : message.attachments,
          browserTaskIds: event.browserTaskId
            ? [...(message.browserTaskIds ?? []), event.browserTaskId]
            : message.browserTaskIds,
        })),
        ...streamEventEffects(event),
      };
    case 'text':
      return {
        messages: updateStreaming(messages, (message) => ({
          ...message,
          content: message.content + event.delta,
        })),
        ...streamEventEffects(event),
      };
    case 'done':
      return {
        messages: updateStreaming(messages, (message) => ({
          id: event.messageId,
          role: 'assistant',
          content: event.content,
          sources: event.sources ?? [],
          proposals: event.proposals ?? [],
          attachments: event.attachments ?? [],
          browserTaskIds: event.browserTaskIds ?? [],
          followUps: event.followUps ?? [],
          toolsUsed: event.toolCalls?.map((call) => call.name) ?? message.toolsUsed ?? [],
        })),
      };
    case 'error':
      return {
        messages: updateStreaming(messages, () => ({
          id: `error-${now()}`,
          role: 'assistant',
          content: event.message,
          error: event.code,
        })),
        ...streamEventEffects(event),
      };
    default:
      return { messages };
  }
}

/**
 * History replayed by ephemeral sessions: completed user/assistant turns only
 * (no errors, no streaming placeholder), newest `limit`, content capped.
 */
export function historyFromMessages(
  messages: ChatMessageView[],
  limit = CHAT_HISTORY_TURNS,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter(
      (message) =>
        (message.role === 'user' || message.role === 'assistant') &&
        message.id !== STREAMING_MESSAGE_ID &&
        !message.error &&
        message.content.trim().length > 0,
    )
    .slice(-limit)
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content.slice(0, CHAT_MAX_HISTORY_CONTENT),
    }));
}
