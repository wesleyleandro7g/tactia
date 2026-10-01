import { buildClaimAllowlist, canonicalizeNumber, collectAllowedFromValues, extractNumberTokens, unsourcedNumbers } from '@tactia/domain';
import { AppError, logger, redactSensitive, redactSensitiveDeep } from '@tactia/shared';
import type { AiContext } from './context-builder';
import { buildSystemPrompt, FOLLOW_UPS_HEADING, type WhatsappChannelContext } from './system-prompt';
import type { ToolRegistry } from './tool-registry';
import type {
  ActionProposal,
  ChatAnswer,
  ChatAttachment,
  ChatStreamEvent,
  ChatTurn,
  ExecutedToolCall,
  LLMAdapter,
  LLMMessage,
  LLMToolCall,
  LLMUsage,
  MessageSource,
  ToolContext,
} from './types';
import { wrapToolOutput, wrapUntrusted } from './untrusted';
import { periodLabel } from './tools/shared';

/**
 * Minimal contract the orchestrator needs from the context builder — keeps it
 * decoupled from Prisma-backed services (and trivially stubbable in tests).
 */
export type ContextSource = {
  build(
    ctx: ToolContext,
    options?: { period?: { from: Date; to: Date }; query?: string },
  ): Promise<AiContext>;
};

export type OrchestratorDeps = {
  llm: LLMAdapter;
  tools: ToolRegistry;
  contextBuilder: ContextSource;
};

export type OrchestratorConfig = {
  /** Maximum tool rounds before forcing a final answer. */
  maxIterations?: number;
  /** How many previous turns of the conversation are sent to the model. */
  historyLimit?: number;
  /** Replace numeric answers that carry no evidence (spec §43). Default: true. */
  enforceSources?: boolean;
  /** Optionally force the first tool call for deterministic intent routing. */
  initialToolChoice?: (
    request: ChatRequest,
    availableToolNames: string[],
  ) => 'required' | { type: 'tool'; toolName: string } | undefined;
};

export type ChatContinuation = {
  /** Trusted instruction appended to the system prompt. Server-authored, never user text. */
  directive: string;
  /** Evidence already in hand, so the final answer can cite it. */
  evidence: MessageSource[];
};

export type ChatRequest = {
  ctx: ToolContext;
  question: string;
  history?: ChatTurn[];
  /** Period used to build the context. Defaults to the current month. */
  period?: { from: Date; to: Date };
  /** Optional channel context (e.g. WhatsApp tone/contact). Absent for web chat. */
  channel?: WhatsappChannelContext;
  /**
   * Continuation after an async tool, such as a finished browser consultation.
   * The directive is trusted; the consultation text inside it stays untrusted.
   */
  continuation?: ChatContinuation;
};

const UNSOURCED_FALLBACK =
  'Não consegui confirmar esses números com os dados da empresa, então prefiro não responder ' +
  'com valores. Tente reformular a pergunta indicando o período desejado.';

export const CLAIM_MISMATCH_FALLBACK =
  'Não consegui cruzar todos os números desta resposta com as evidências internas.\n' +
  'Reformule a pergunta ou peça um período específico.';

const EMPTY_FALLBACK =
  'Não consegui formular uma resposta para essa pergunta. Tente reformulá-la com mais detalhes.';

const MAX_RECOVERY_TOOL_BATCHES = 2;
const MAX_RECOVERY_TOOL_CALLS = 4;
const MAX_RECOVERY_REVISIONS = 2;
const EXPLICIT_PERIOD = /\b(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|ontem|hoje|semana|trimestre|ano|passado|anterior|últim[oa]s?|dias?|meses|bimestre|semestre)\b|\d{1,2}\/\d{1,2}|\b20\d{2}\b/;

function seedSources(contextSources: MessageSource[], request: ChatRequest): MessageSource[] {
  return [...contextSources, ...(request.continuation?.evidence ?? [])];
}

function contextualClarification(question: string, context: AiContext, history: ChatTurn[] = []): string {
  const previous = [...history].reverse().find((turn) => turn.role === 'user')?.content ?? '';
  const normalized = `${question} ${previous}`.toLocaleLowerCase('pt-BR');
  if (/\b(ela|ele|dela|dele)\b/.test(question.toLocaleLowerCase('pt-BR')) && previous) {
    if (/meta|objetiv/.test(previous.toLocaleLowerCase('pt-BR'))) return 'A qual meta mencionada antes você está se referindo?';
    if (/client/.test(previous.toLocaleLowerCase('pt-BR'))) return 'A qual cliente da conversa você está se referindo?';
    if (/vendedor/.test(previous.toLocaleLowerCase('pt-BR'))) return 'A qual vendedor mencionado antes você está se referindo?';
    return 'A qual pessoa ou indicador mencionado antes você está se referindo?';
  }
  if (/meta|objetiv/.test(normalized) || context.goals.length > 0 && /como estamos|progresso/.test(normalized)) {
    return 'Sobre as metas, você quer saber os objetivos definidos, o progresso até agora ou a projeção de fechamento?';
  }
  if (/vendedor|quem mais vendeu|quem vendeu/.test(normalized)) {
    return 'Sobre os vendedores, você quer o ranking por receita ou por quantidade de vendas?';
  }
  if (/projeç|previs|estimativ|fechamento|fechamos/.test(normalized) && /receita|fatur|vend/.test(normalized)) {
    return 'Para a projeção de vendas, você quer estimar o fechamento do mês atual ou outro período?';
  }
  if (/receita|fatur|vend/.test(normalized)) {
    if (EXPLICIT_PERIOD.test(question.toLocaleLowerCase('pt-BR'))) {
      return 'Para o período que você indicou, quer a receita de vendas confirmadas, a quantidade de vendas ou ambos?';
    }
    return 'Sobre as vendas, posso analisar o período atual ou comparar com outro período. Qual recorte você prefere?';
  }
  if (/client/.test(normalized)) {
    return 'Sobre os clientes, você quer analisar quantidade, novos clientes ou comportamento de compra?';
  }
  return 'Para seguir com sua análise, qual indicador ou parte do negócio você quer examinar? Posso começar pelo período atual.';
}

function groundedPartialAnswer(question: string, context: AiContext, sources: MessageSource[]): string | null {
  const normalized = question.toLocaleLowerCase('pt-BR');
  if (/\b(pdf|documento|segundo|conforme)\b/.test(normalized)) return null;
  if (EXPLICIT_PERIOD.test(normalized)) return null;
  if (/projeç|previs|estimativ|fechamento|fechamos|vamos|tendência|crescimento|compar|por que|causa|motivo|impacto/.test(normalized)) return null;
  const period = periodLabel(context.period);
  const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
  const money = (value: number) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: context.company.currency, maximumFractionDigits: 0,
  }).format(value);
  const metricValue = (key: string, tool: string): number | undefined => {
    const fresh = [...sources].reverse().find((source) => source.metric === key
      && source.tool === tool
      && source.period?.from === context.period.from
      && source.period?.to === context.period.to);
    return fresh?.value ?? context.metrics.find((metric) => metric.key === key)?.value;
  };

  if (/meta|objetiv/.test(normalized) && context.goals.length > 0) {
    const labels: Record<string, string> = {
      revenue: 'receita', sales_count: 'vendas', customer_count: 'clientes',
      new_customers: 'novos clientes', gross_margin: 'margem bruta',
      average_ticket: 'ticket médio', complaint_count: 'reclamações',
      cancellation_rate: 'taxa de cancelamento', refund_rate: 'taxa de reembolso',
      revenue_growth: 'crescimento de receita', sales_growth: 'crescimento de vendas',
    };
    const lines = context.goals.slice(0, 5).map((goal) => {
      const isRate = ['cancellation_rate', 'refund_rate', 'sales_growth', 'revenue_growth'].includes(goal.metricKey);
      const isMoney = ['revenue', 'average_ticket', 'discount_total', 'gross_margin', 'pending_amount', 'expense_total', 'operating_profit', 'break_even_revenue', 'receivables_open', 'overdue_amount'].includes(goal.metricKey);
      const format = isRate ? percent.format : isMoney ? money : number.format;
      const scope = goal.scopeLabel ? ` (${goal.scopeLabel})` : '';
      const goalPeriod = goal.period ? `, ${periodLabel(goal.period)}` : '';
      return `- ${labels[goal.metricKey] ?? goal.metricKey}${scope}${goalPeriod}: objetivo ${format(goal.target)}, realizado ${format(goal.achieved)}.`;
    });
    return `Estas são as metas registradas que consigo confirmar:\n${lines.join('\n')}`;
  }

  if (/\b(quem|quais|ranking|maior|menor|top|mais|menos)\b/.test(normalized)) return null;

  if (/receita|fatur|vend/.test(normalized)) {
    const revenue = metricValue('revenue', 'get_revenue');
    const sales = metricValue('sales_count', 'get_sales');
    const facts = [
      revenue != null ? `receita confirmada de ${money(revenue)}` : null,
      sales != null ? `${number.format(sales)} vendas confirmadas` : null,
    ].filter(Boolean);
    if (facts.length > 0) return `No período de ${period}, os dados confirmados mostram ${facts.join(' e ')}.`;
  }

  if (/client/.test(normalized)) {
    const customers = metricValue('customer_count', 'get_customers');
    if (customers != null) return `No período de ${period}, há ${number.format(customers)} clientes com compras confirmadas.`;
  }
  return null;
}

function unlabeledEstimates(content: string, context: AiContext, sources: MessageSource[]): string[] {
  if (/estimativ|projeç|aproximad|previst|simulaç/i.test(content)) return [];
  const estimated = new Set<string>();
  const observed = new Set<string>();
  const key = (value: number, unit: 'number' | 'percent') => `${unit === 'percent' ? 'p' : 'n'}:${Math.round(value)}`;
  for (const metric of [...context.metrics, ...context.trailing30]) observed.add(key(metric.value, 'number'));
  for (const goal of context.goals) {
    observed.add(key(goal.target, 'number'));
    observed.add(key(goal.achieved, 'number'));
  }
  for (const source of sources) {
    if (source.value != null && source.tool !== 'get_forecast') observed.add(key(source.value, 'number'));
    for (const claim of source.numericEvidence ?? []) {
      (claim.kind === 'estimated' ? estimated : observed).add(key(claim.value, claim.unit));
    }
  }
  return [...new Set(extractNumberTokens(content).filter((token) => {
    const canonical = canonicalizeNumber(token);
    return estimated.has(canonical) && !observed.has(canonical);
  }))];
}

function containsNumber(text: string): boolean {
  return /\d/.test(text);
}

function isUnhelpfulFailure(content: string): boolean {
  const trimmed = content.trim();
  if (/^não (?:consegui|consigo) (?:registrar|enviar|criar|executar|iniciar)\b/i.test(trimmed)) return false;
  return /^(?:não (?:consegui|consigo|entendi|tenho (?:dados|informações)|há dados suficientes)|não foi possível|sem dados suficientes)/i.test(trimmed);
}

/** Years from company "today" and cited periods — prose like "setembro de 2026". */
function allowContextCalendarYears(
  allowed: Set<string>,
  context: AiContext,
  sources: MessageSource[],
): Set<string> {
  const addYear = (iso?: string | null) => {
    if (!iso) return;
    const year = new Date(iso).getFullYear();
    if (Number.isFinite(year) && year >= 2000 && year <= 2100) {
      allowed.add(`n:${year}`);
    }
  };

  addYear(context.company.today);
  addYear(context.period.from);
  addYear(context.period.to);
  addYear(context.trailingPeriod?.from);
  addYear(context.trailingPeriod?.to);
  for (const source of sources) {
    addYear(source.period?.from);
    addYear(source.period?.to);
  }
  return allowed;
}

/** Goal figures are injected into the system prompt, so they are valid claims too. */
function allowContextGoals(allowed: Set<string>, context: AiContext): Set<string> {
  for (const goal of context.goals) {
    const values = [goal.target, goal.achieved, goal.requiredDailyPace, goal.projected]
      .filter((value): value is number => value != null);
    for (const key of collectAllowedFromValues(values)) allowed.add(key);
    if (['cancellation_rate', 'refund_rate', 'sales_growth', 'revenue_growth'].includes(goal.metricKey)) {
      for (const value of values) allowed.add(`p:${Math.round(value * 100)}`);
    }
    if (Number.isFinite(goal.progress)) {
      allowed.add(`p:${Math.round(goal.progress * 100)}`);
    }
  }
  return allowed;
}

/**
 * Drop attachment IDs/URLs and UUID-like tokens before claim checks.
 * Models often paste `/api/v1/infographics/<id>`; digit fragments then trip claim_mismatch.
 */
function scrubClaimNoise(content: string, attachments: ChatAttachment[]): string {
  let text = content;
  for (const attachment of attachments) {
    if (attachment.id) text = text.split(attachment.id).join(' ');
    if (attachment.url) text = text.split(attachment.url).join(' ');
  }
  return text
    .replace(/\/api\/v1\/infographics\/[A-Za-z0-9_-]+/gi, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
    .replace(/\b01[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ');
}

function claimOffenders(
  content: string,
  sources: MessageSource[],
  context: AiContext,
  attachments: ChatAttachment[],
): string[] {
  const allowlist = allowContextCalendarYears(
    allowContextGoals(buildClaimAllowlist([...context.metrics, ...context.trailing30], sources), context),
    context,
    sources,
  );
  const claimText = scrubClaimNoise(content, attachments);
  return [...new Set([
    ...unsourcedNumbers(claimText, allowlist),
    ...unlabeledEstimates(claimText, context, sources),
  ])];
}

const FOLLOW_UPS_PATTERN = new RegExp(
  `(?:^|\\n)\\s*(?:#{1,4}\\s*|\\*\\*)?${FOLLOW_UPS_HEADING}:?(?:\\*\\*)?\\s*:?\\s*\\n([\\s\\S]*)$`,
  'i',
);

/**
 * Splits the trailing "Próximos passos" block (see system prompt) into the
 * answer body and a list of suggested follow-up questions. Tolerant: when the
 * block is missing or malformed the content is returned untouched.
 */
export function extractFollowUps(text: string): { content: string; followUps: string[] } {
  const match = FOLLOW_UPS_PATTERN.exec(text);
  if (!match || match.index == null) return { content: text.trim(), followUps: [] };

  const block = match[1] ?? '';
  const followUps = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^([-*•]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^([-*•]|\d+[.)])\s+/, '').replace(/^\*\*|\*\*$/g, '').trim())
    .filter((line) => line.length > 0 && line.length <= 200)
    .slice(0, 3);

  if (followUps.length === 0) return { content: text.trim(), followUps: [] };
  return { content: text.slice(0, match.index).trim(), followUps };
}

function dedupeSources(sources: MessageSource[]): MessageSource[] {
  const seen = new Map<string, MessageSource>();
  for (const source of sources) {
    const key = `${source.metric}|${source.period?.from ?? ''}|${source.period?.to ?? ''}|${source.refId ?? ''}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, source);
      continue;
    }
    // A tool result is stronger evidence than the pre-built context: it was
    // computed for this exact question, so it replaces the context entry.
    if (existing.tool === 'context' && source.tool && source.tool !== 'context') {
      seen.set(key, source);
    }
  }
  return [...seen.values()];
}

function sumUsage(a: LLMUsage | undefined, b: LLMUsage | undefined): LLMUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
  };
}

function redactToolCalls(toolCalls: ExecutedToolCall[]): ExecutedToolCall[] {
  return toolCalls.map((call) => ({
    ...call,
    input: redactSensitiveDeep(call.input),
    ...(call.error ? { error: redactSensitive(call.error) } : {}),
  }));
}

/**
 * Orchestrator (spec §41).
 *
 * Flow: user → context builder → LLM → tool calls → structured data → LLM →
 * validated response. The loop is ours (not the SDK's) so that every tool call
 * is validated, tenant-scoped and turned into citable evidence.
 */
export class Orchestrator {
  private readonly maxIterations: number;
  private readonly historyLimit: number;
  private readonly enforceSources: boolean;
  private readonly initialToolChoice: NonNullable<OrchestratorConfig['initialToolChoice']> | undefined;

  constructor(
    private readonly deps: OrchestratorDeps,
    config: OrchestratorConfig = {},
  ) {
    this.maxIterations = config.maxIterations ?? 8;
    this.historyLimit = config.historyLimit ?? 12;
    this.enforceSources = config.enforceSources ?? true;
    this.initialToolChoice = config.initialToolChoice;
  }

  /** Single-shot answer (no streaming). */
  async run(request: ChatRequest): Promise<ChatAnswer> {
    const { context, system, messages } = await this.prepare(request);
    const sources: MessageSource[] = seedSources(context.sources, request);
    const executed: ExecutedToolCall[] = [];
    const proposals: ActionProposal[] = [];
    const attachments: ChatAttachment[] = [];
    let usage: LLMUsage | undefined;
    const tools = this.deps.tools.definitions(request.ctx.role);
    const initialToolChoice = this.initialToolChoice?.(
      request,
      tools.map((tool) => tool.name),
    );

    for (let round = 0; round < this.maxIterations; round += 1) {
      const completion = await this.deps.llm.complete({
        system,
        messages,
        tools,
        ...(round === 0 && initialToolChoice ? { toolChoice: initialToolChoice } : {}),
      });
      usage = sumUsage(usage, completion.usage);

      if (completion.toolCalls.length === 0) {
        return this.consumeResolution(this.resolveAnswer(request, system, messages, completion.text, sources, executed, proposals, attachments, usage, context));
      }

      messages.push({
        role: 'assistant',
        content: completion.text,
        toolCalls: completion.toolCalls,
      });

      // Tool calls of the same round are independent: run them in parallel.
      const outcomes = await Promise.all(
        completion.toolCalls.map((toolCall) => this.executeToolCall(request.ctx, toolCall)),
      );
      completion.toolCalls.forEach((toolCall, index) => {
        const outcome = outcomes[index]!;
        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          output: outcome.output,
        });
        executed.push(outcome.executed);
        sources.push(...outcome.executed.sources);
        if (outcome.proposal) proposals.push(outcome.proposal);
        if (outcome.attachment) attachments.push(outcome.attachment);
      });
    }

    // Tool budget exhausted: force a final answer with the data already gathered.
    const forced = await this.deps.llm.complete({ system, messages });
    usage = sumUsage(usage, forced.usage);
    return this.consumeResolution(this.resolveAnswer(request, system, messages, forced.text, sources, executed, proposals, attachments, usage, context, 'max_iterations'));
  }

  /**
   * Streaming variant. Emits tool activity and text deltas, closing with a
   * `done` event that carries the persisted answer (content + sources).
   */
  async *stream(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const { context, system, messages } = await this.prepare(request);
    const sources: MessageSource[] = seedSources(context.sources, request);
    const executed: ExecutedToolCall[] = [];
    const proposals: ActionProposal[] = [];
    const attachments: ChatAttachment[] = [];
    let usage: LLMUsage | undefined;
    const tools = this.deps.tools.definitions(request.ctx.role);
    const initialToolChoice = this.initialToolChoice?.(
      request,
      tools.map((tool) => tool.name),
    );

    for (let round = 0; round < this.maxIterations; round += 1) {
      const request$ = {
        system,
        messages,
        tools,
        ...(round === 0 && initialToolChoice ? { toolChoice: initialToolChoice } : {}),
      };

      let text = '';
      const toolCalls: LLMToolCall[] = [];

      if (this.deps.llm.stream) {
        for await (const chunk of this.deps.llm.stream(request$)) {
          if (chunk.type === 'text-delta') {
            text += chunk.delta;
          } else if (chunk.type === 'tool-call') {
            toolCalls.push(chunk.toolCall);
          } else {
            usage = sumUsage(usage, chunk.completion.usage);
            if (chunk.completion.text) text = chunk.completion.text;
          }
        }
      } else {
        const completion = await this.deps.llm.complete(request$);
        usage = sumUsage(usage, completion.usage);
        text = completion.text;
        toolCalls.push(...completion.toolCalls);
      }

      if (toolCalls.length === 0) {
        const resolution = this.resolveAnswer(request, system, messages, text, sources, executed, proposals, attachments, usage, context);
        let next = await resolution.next();
        while (!next.done) {
          yield next.value;
          next = await resolution.next();
        }
        if (next.value.content) yield { type: 'text', delta: next.value.content };
        yield {
          type: 'done',
          answer: next.value,
        };
        return;
      }

      messages.push({ role: 'assistant', content: text, toolCalls });

      for (const toolCall of toolCalls) {
        yield { type: 'tool_call', name: toolCall.name, input: toolCall.input };
      }
      const outcomes = await Promise.all(
        toolCalls.map((toolCall) => this.executeToolCall(request.ctx, toolCall)),
      );
      for (let index = 0; index < toolCalls.length; index += 1) {
        const toolCall = toolCalls[index]!;
        const outcome = outcomes[index]!;
        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          output: outcome.output,
        });
        executed.push(outcome.executed);
        sources.push(...outcome.executed.sources);
        if (outcome.proposal) proposals.push(outcome.proposal);
        if (outcome.attachment) attachments.push(outcome.attachment);
        yield {
          type: 'tool_result',
          name: toolCall.name,
          sources: outcome.executed.sources,
          durationMs: outcome.executed.durationMs,
          ...(outcome.proposal ? { proposal: outcome.proposal } : {}),
          ...(outcome.attachment ? { attachment: outcome.attachment } : {}),
          ...(outcome.executed.browserTaskId ? { browserTaskId: outcome.executed.browserTaskId } : {}),
          ...(outcome.executed.error ? { error: outcome.executed.error } : {}),
        };
      }
    }

    const forced = await this.deps.llm.complete({ system, messages });
    usage = sumUsage(usage, forced.usage);
    const resolution = this.resolveAnswer(request, system, messages, forced.text, sources, executed, proposals, attachments, usage, context, 'max_iterations');
    let next = await resolution.next();
    while (!next.done) {
      yield next.value;
      next = await resolution.next();
    }
    if (next.value.content) yield { type: 'text', delta: next.value.content };
    yield {
      type: 'done',
      answer: next.value,
    };
  }

  // -------------------------------------------------------------------------

  private async consumeResolution(
    resolution: AsyncGenerator<ChatStreamEvent, ChatAnswer>,
  ): Promise<ChatAnswer> {
    let next = await resolution.next();
    while (!next.done) next = await resolution.next();
    return next.value;
  }

  /** Recheck a rejected draft using only tenant-scoped read tools. */
  private async *resolveAnswer(
    request: ChatRequest,
    system: string,
    messages: LLMMessage[],
    text: string,
    sources: MessageSource[],
    executed: ExecutedToolCall[],
    proposals: ActionProposal[],
    attachments: ChatAttachment[],
    initialUsage: LLMUsage | undefined,
    context: AiContext,
    guardrail?: ChatAnswer['guardrail'],
  ): AsyncGenerator<ChatStreamEvent, ChatAnswer> {
    let usage = initialUsage;
    const first = this.finalize(text, sources, executed, proposals, attachments, usage, context, guardrail);
    const rejected = first.guardrail === 'claim_mismatch' || first.guardrail === 'unsourced_numbers' || !text.trim() || isUnhelpfulFailure(first.content);
    if (!rejected) {
      const clarification = /^(você quer|você se refere|qual |a qual |quando você diz)/i.test(first.content) && first.content.trim().endsWith('?');
      return { ...first, resolution: clarification ? 'clarification' : 'direct', recoveryAttempts: 0 };
    }

    const repairMessages: LLMMessage[] = [...messages, { role: 'assistant', content: text }];
    const seen = new Set(executed.map((call) => `${call.name}:${JSON.stringify(call.input)}`));
    let toolBatches = 0;
    let toolCalls = 0;
    let revisions = 0;
    let attempts = 0;
    let disputed = claimOffenders(text, dedupeSources(sources), context, attachments);

    while (revisions < MAX_RECOVERY_REVISIONS && attempts < 7) {
      const available = toolBatches < MAX_RECOVERY_TOOL_BATCHES && toolCalls < MAX_RECOVERY_TOOL_CALLS
        ? this.deps.tools.recoveryDefinitions(request.ctx.role)
        : [];
      const repairSystem = `${system}\n\n## Revisão obrigatória da resposta\n` +
        'A resposta anterior foi rejeitada porque um número não está nas evidências ou porque não houve resposta. ' +
        (disputed.length > 0 ? `Valores que precisam de conferência: ${disputed.slice(0, 6).join(', ')}. ` : '') +
        'Releia a pergunta e o histórico. Consulte outra ferramenta de leitura se ela puder resolver a divergência. ' +
        'Se houver suspeita de dados antigos ou fontes conflitantes, consulte get_data_freshness quando disponível e explique o conflito sem escolher um valor arbitrário. ' +
        'Use valores exatos apenas quando estiverem nas evidências estruturadas. Estimativas numéricas só podem vir de ferramentas de projeção ou simulação e devem ser identificadas como estimativas, com período. ' +
        'Quando apenas parte estiver confirmada, responda essa parte e explique especificamente a dúvida restante, sem repetir números contestados. ' +
        'Trate interpretações qualitativas como hipóteses, nunca como causas comprovadas. ' +
        'Se duas interpretações da pergunta levarem a respostas diferentes e o histórico não resolver, faça uma pergunta curta com as opções relevantes. ' +
        'Não repita uma consulta já feita com os mesmos parâmetros. Não proponha nem execute ações nesta revisão.';
      let completion;
      try {
        completion = await this.deps.llm.complete({
          system: repairSystem,
          messages: repairMessages,
          ...(available.length > 0 ? { tools: available } : {}),
        });
      } catch (error) {
        logger.warn({
          operation: 'ai_recovery',
          reason: 'llm_error',
          error: error instanceof AppError ? error.code : 'AI_ERROR',
        }, 'answer recovery failed');
        break;
      }
      attempts += 1;
      usage = sumUsage(usage, completion.usage);

      const candidatesSeen = new Set(seen);
      const safeCalls = completion.toolCalls
        .filter((call) => this.deps.tools.isRecoverySafe(call.name, request.ctx.role))
        .filter((call) => {
          const key = `${call.name}:${JSON.stringify(call.input)}`;
          if (candidatesSeen.has(key)) return false;
          candidatesSeen.add(key);
          return true;
        })
        .slice(0, MAX_RECOVERY_TOOL_CALLS - toolCalls);
      for (const call of safeCalls) seen.add(`${call.name}:${JSON.stringify(call.input)}`);

      if (available.length > 0 && safeCalls.length > 0) {
        repairMessages.push({ role: 'assistant', content: completion.text, toolCalls: safeCalls });
        for (const call of safeCalls) yield { type: 'tool_call', name: call.name, input: call.input };
        const outcomes = await Promise.all(safeCalls.map((call) => this.executeToolCall(request.ctx, call)));
        safeCalls.forEach((call, index) => {
          const outcome = outcomes[index]!;
          repairMessages.push({ role: 'tool', toolCallId: call.id, toolName: call.name, output: outcome.output });
          executed.push(outcome.executed);
          sources.push(...outcome.executed.sources);
        });
        for (let index = 0; index < safeCalls.length; index += 1) {
          const outcome = outcomes[index]!;
          yield {
            type: 'tool_result',
            name: safeCalls[index]!.name,
            sources: outcome.executed.sources,
            durationMs: outcome.executed.durationMs,
            ...(outcome.executed.error ? { error: outcome.executed.error } : {}),
          };
        }
        toolBatches += 1;
        toolCalls += safeCalls.length;
        continue;
      }

      if (completion.toolCalls.length > 0) {
        // Do not accept text that describes a tool call we deliberately skipped.
        revisions += 1;
        continue;
      }

      revisions += 1;
      const reviewed = this.finalize(completion.text, sources, executed, proposals, attachments, usage, context);
      if (completion.text.trim() && reviewed.guardrail == null && reviewed.content !== EMPTY_FALLBACK && !isUnhelpfulFailure(reviewed.content)) {
        const isQuestion = /^(você quer|você se refere|qual |a qual |quando você diz)/i.test(reviewed.content) && reviewed.content.trim().endsWith('?');
        const resolution = isQuestion
          ? 'clarification'
          : /\d/.test(reviewed.content) ? 'recovered' : 'partial';
        return {
          ...reviewed,
          ...(first.guardrail ? { guardrail: first.guardrail } : {}),
          resolution,
          recoveryAttempts: attempts,
        };
      }
      disputed = claimOffenders(completion.text, dedupeSources(sources), context, attachments);
      repairMessages.push({ role: 'assistant', content: completion.text });
    }

    const partial = groundedPartialAnswer(request.question, context, sources);
    const grounded = partial
      ? this.finalize(partial, sources, executed, proposals, attachments, usage, context)
      : null;
    if (grounded && grounded.guardrail == null) {
      return {
        ...grounded,
        ...(first.guardrail ? { guardrail: first.guardrail } : {}),
        resolution: 'partial',
        recoveryAttempts: attempts,
      };
    }
    const fallback = this.finalize(
      contextualClarification(request.question, context, request.history),
      sources, executed, proposals, attachments, usage, context,
    );
    return {
      ...fallback,
      ...(first.guardrail ? { guardrail: first.guardrail } : {}),
      resolution: 'clarification',
      recoveryAttempts: attempts,
    };
  }

  // -------------------------------------------------------------------------

  private async prepare(request: ChatRequest) {
    const context = await this.deps.contextBuilder.build(request.ctx, {
      ...(request.period ? { period: request.period } : {}),
      query: request.question,
    });

    const system = [
      buildSystemPrompt(context, this.deps.tools.names(request.ctx.role), request.channel),
      request.continuation?.directive,
    ].filter(Boolean).join('\n\n');
    const history = (request.history ?? []).slice(-this.historyLimit);

    const messages: LLMMessage[] = [
      ...history.map((turn): LLMMessage =>
        turn.role === 'user'
          ? { role: 'user', content: wrapUntrusted(turn.content, 'user') }
          : { role: 'assistant', content: turn.content },
      ),
      { role: 'user', content: wrapUntrusted(request.question, 'user') },
    ];

    return { context, system, messages };
  }

  private async executeToolCall(
    ctx: ToolContext,
    toolCall: LLMToolCall,
  ): Promise<{
    output: unknown;
    executed: ExecutedToolCall;
    proposal?: ActionProposal;
    attachment?: ChatAttachment;
  }> {
    const started = Date.now();
    try {
      const result = await this.deps.tools.execute(toolCall.name, ctx, toolCall.input);
      return {
        output: wrapToolOutput(result.data, toolCall.name),
        executed: {
          name: toolCall.name,
          input: toolCall.input,
          durationMs: Date.now() - started,
          sources: result.sources,
          ...(result.browserTaskId ? { browserTaskId: result.browserTaskId } : {}),
        },
        ...(result.proposal ? { proposal: result.proposal } : {}),
        ...(result.attachment ? { attachment: result.attachment } : {}),
      };
    } catch (error) {
      // Tool failures are fed back to the model instead of aborting the chat —
      // it can then explain the limitation to the user.
      const message =
        error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Tool execution failed';
      logger.warn(
        { tenant_id: ctx.tenantId, tool: toolCall.name, err: error },
        'tool execution failed',
      );
      return {
        output: wrapToolOutput({ error: message }, toolCall.name),
        executed: {
          name: toolCall.name,
          input: toolCall.input,
          durationMs: Date.now() - started,
          sources: [],
          error: message,
        },
      };
    }
  }

  private finalize(
    text: string,
    sources: MessageSource[],
    toolCalls: ExecutedToolCall[],
    proposals: ActionProposal[],
    attachments: ChatAttachment[],
    usage: LLMUsage | undefined,
    context: AiContext,
    guardrail?: ChatAnswer['guardrail'],
  ): ChatAnswer {
    const deduped = dedupeSources(sources);
    const split = extractFollowUps(text);
    let content = split.content;
    let followUps = split.followUps;
    let flag = guardrail;

    if (this.enforceSources && containsNumber(content) && deduped.length === 0) {
      // AI safety: a number without internal evidence never reaches the user.
      logger.warn({ operation: 'ai_guardrail', reason: 'unsourced_numbers' });
      content = UNSOURCED_FALLBACK;
      followUps = [];
      flag = 'unsourced_numbers';
    } else if (this.enforceSources) {
      const offenders = claimOffenders(content, deduped, context, attachments);
      if (offenders.length > 0) {
        logger.warn({
          operation: 'ai_guardrail',
          reason: 'claim_mismatch',
          offenders: offenders.map((token) => redactSensitive(token)),
        });
        content = CLAIM_MISMATCH_FALLBACK;
        followUps = [];
        flag = 'claim_mismatch';
      }
    }
    if (!content) content = EMPTY_FALLBACK;

    return {
      content,
      followUps,
      sources: deduped,
      toolCalls: redactToolCalls(toolCalls),
      proposals,
      attachments,
      browserTaskIds: toolCalls.flatMap((call) => call.browserTaskId ? [call.browserTaskId] : []),
      provider: this.deps.llm.provider,
      model: this.deps.llm.model,
      ...(usage ? { usage } : {}),
      ...(flag ? { guardrail: flag } : {}),
    };
  }
}
