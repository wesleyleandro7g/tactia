import { formatPeriod, metricLabel } from '../format';
import {
  CHAT_HISTORY_TURNS,
  CHAT_MAX_HISTORY_CONTENT,
  type ChatMessageView,
  type ChatSource,
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
  search_public_web: 'pesquisando o mercado',
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
  search_public_web: 'fontes públicas',
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
  return TOOL_SHORT_LABELS[name] ?? 'dados da empresa';
}

export function uniqueToolLabels(tools: string[]): string[] {
  return Array.from(new Set(tools.map(toolShortLabel)));
}

export type WorkPhaseId = 'numbers' | 'search' | 'analysis' | 'prepare' | 'system' | 'other';

export const WORK_PHASE_LABELS: Record<WorkPhaseId, string> = {
  numbers: 'Consultando os números',
  search: 'Procurando nos registros',
  analysis: 'Analisando o que mudou',
  prepare: 'Preparando o próximo passo',
  system: 'Acessando o sistema',
  other: 'Consultando os dados da empresa',
};

const WORK_PHASE_DONE_LABELS: Record<WorkPhaseId, string> = {
  numbers: 'Conferiu os números',
  search: 'Procurou nos registros',
  analysis: 'Analisou o que mudou',
  prepare: 'Preparou o próximo passo',
  system: 'Acessou o sistema',
  other: 'Consultou os dados da empresa',
};

export const WORK_RETRY_LABEL = 'Não encontrei por aqui. Vou tentar de outro jeito.';
export const WORK_THINKING_LABEL = 'Pensando';
export const WORK_CHECKED_LABEL = 'Conferi os dados';

const TOOL_PHASES: Record<string, WorkPhaseId> = {
  get_revenue: 'numbers',
  get_sales: 'numbers',
  get_customers: 'numbers',
  get_products: 'numbers',
  get_sellers: 'numbers',
  get_complaints: 'numbers',
  get_data_freshness: 'numbers',
  get_customer_profile: 'numbers',
  search_documents: 'search',
  search_interactions: 'search',
  search_catalog: 'search',
  get_insights: 'analysis',
  get_customer_segments: 'analysis',
  get_customer_voice: 'analysis',
  get_period_projection: 'analysis',
  get_pipeline: 'analysis',
  get_product_affinity: 'analysis',
  get_product_performance: 'analysis',
  get_sales_health: 'analysis',
  get_seller_performance: 'analysis',
  compare_periods: 'analysis',
  explain_change: 'analysis',
  get_trend: 'analysis',
  get_insight_detail: 'analysis',
  get_forecast: 'analysis',
  get_latest_briefing: 'analysis',
  get_goals_progress: 'analysis',
  get_funnel: 'analysis',
  get_cohorts: 'analysis',
  get_rfm: 'analysis',
  simulate: 'analysis',
  get_profitability: 'analysis',
  get_cash_flow: 'analysis',
  get_inventory_risk: 'analysis',
  get_acquisition: 'analysis',
  remember_fact: 'analysis',
  list_business_facts: 'analysis',
  propose_action: 'prepare',
  generate_infographic: 'prepare',
  list_browser_profiles: 'system',
  browser_delegate: 'system',
  browser_agent: 'system',
};

/** Unknown tools stay in the generic phase so a slug never reaches the screen. */
export function workPhaseForTool(name: string): WorkPhaseId {
  return TOOL_PHASES[name] ?? 'other';
}

export type WorkCursor = {
  phase: WorkPhaseId;
  retrying: boolean;
};

export type WorkTrailStep = {
  phase: WorkPhaseId;
  label: string;
  status: 'active' | 'done' | 'retry';
};

const VISIBLE_WORK_STEPS = 3;

/**
 * Collapses consecutive tools of the same phase into one step. The live cursor
 * marks the last matching phase as active or retrying. System steps can be
 * omitted once the access card is already on screen.
 */
export function buildWorkTrail(
  tools: string[],
  cursor: WorkCursor | null,
  options?: { omitSystem?: boolean },
): { visible: WorkTrailStep[]; hidden: WorkTrailStep[] } {
  const phases: WorkPhaseId[] = [];
  for (const tool of tools) {
    const phase = workPhaseForTool(tool);
    if (options?.omitSystem && phase === 'system') continue;
    if (phases.at(-1) !== phase) phases.push(phase);
  }
  if (cursor && !(options?.omitSystem && cursor.phase === 'system')) {
    if (phases.at(-1) !== cursor.phase) phases.push(cursor.phase);
  }

  const steps: WorkTrailStep[] = phases.map((phase, index) => {
    const live = index === phases.length - 1 && cursor?.phase === phase;
    if (live && cursor.retrying) {
      return { phase, label: WORK_RETRY_LABEL, status: 'retry' };
    }
    if (live) {
      return { phase, label: WORK_PHASE_LABELS[phase], status: 'active' };
    }
    return { phase, label: WORK_PHASE_DONE_LABELS[phase], status: 'done' };
  });

  if (steps.length <= VISIBLE_WORK_STEPS) return { visible: steps, hidden: [] };
  return {
    hidden: steps.slice(0, steps.length - VISIBLE_WORK_STEPS),
    visible: steps.slice(-VISIBLE_WORK_STEPS),
  };
}

export function hasNonSystemWork(tools: string[]): boolean {
  return tools.some((tool) => workPhaseForTool(tool) !== 'system');
}

export type SourceLine = {
  key: string;
  label: string;
  url?: string;
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}

/** One line per metric and period. Tool names are never included. */
export function sourceLines(sources: ChatSource[]): SourceLine[] {
  const lines = new Map<string, SourceLine>();
  for (const source of sources) {
    if (source.url) {
      if (!lines.has(source.url)) {
        lines.set(source.url, {
          key: source.url,
          label: `${source.label ?? source.url}${source.publishedAt ? ` · ${source.publishedAt.slice(0, 10)}` : ''}`,
          url: source.url,
        });
      }
      continue;
    }
    const name = metricLabel(source.metric);
    const period = source.period ? formatPeriod(source.period) : '';
    const key = `${source.metric}|${period}`;
    if (lines.has(key)) continue;
    lines.set(key, { key, label: period ? `${name} — ${period}` : name });
  }
  return [...lines.values()];
}

/** Closed footer: "Baseado em Receita e Vendas · 01/08/2026 a 01/09/2026". */
export function sourceSummary(sources: ChatSource[]): string | null {
  const lines = sourceLines(sources);
  if (lines.length === 0) return null;

  const names: string[] = [];
  const periods: string[] = [];
  for (const source of sources) {
    const name = source.url ? 'fontes públicas' : metricLabel(source.metric);
    if (!names.includes(name)) names.push(name);
    if (source.period) {
      const period = formatPeriod(source.period);
      if (!periods.includes(period)) periods.push(period);
    }
  }

  const shown = names.length > 3 ? [...names.slice(0, 2), 'outros'] : names;
  const summary = `Baseado em ${joinNames(shown)}`;
  return periods.length === 1 ? `${summary} · ${periods[0]}` : summary;
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
  /** `undefined` keeps the current phase; `null` clears it (answer text started). */
  work?: WorkCursor | null;
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
    return { work: { phase: workPhaseForTool(event.name), retrying: false } };
  }
  if (event.type === 'tool_result' && event.error) {
    return { work: { phase: workPhaseForTool(event.name), retrying: true } };
  }
  if (event.type === 'text') return { work: null };
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
