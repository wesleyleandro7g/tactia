import { buildClaimAllowlist, collectAllowedFromValues, unsourcedNumbers } from '@tactia/domain';
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

export type ChatRequest = {
  ctx: ToolContext;
  question: string;
  history?: ChatTurn[];
  /** Period used to build the context. Defaults to the current month. */
  period?: { from: Date; to: Date };
  /** Optional channel context (e.g. WhatsApp tone/contact). Absent for web chat. */
  channel?: WhatsappChannelContext;
};

const UNSOURCED_FALLBACK =
  'Não consegui confirmar esses números com os dados da empresa, então prefiro não responder ' +
  'com valores. Tente reformular a pergunta indicando o período desejado.';

export const CLAIM_MISMATCH_FALLBACK =
  'Não consegui cruzar todos os números desta resposta com as evidências internas.\n' +
  'Reformule a pergunta ou peça um período específico.';

const EMPTY_FALLBACK =
  'Não consegui formular uma resposta para essa pergunta. Tente reformulá-la com mais detalhes.';

function containsNumber(text: string): boolean {
  return /\d/.test(text);
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
    const sources: MessageSource[] = [...context.sources];
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
        return this.finalize(completion.text, sources, executed, proposals, attachments, usage, context);
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
    return this.finalize(
      forced.text,
      sources,
      executed,
      proposals,
      attachments,
      usage,
      context,
      'max_iterations',
    );
  }

  /**
   * Streaming variant. Emits tool activity and text deltas, closing with a
   * `done` event that carries the persisted answer (content + sources).
   */
  async *stream(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const { context, system, messages } = await this.prepare(request);
    const sources: MessageSource[] = [...context.sources];
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
            yield { type: 'text', delta: chunk.delta };
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
        if (completion.toolCalls.length === 0 && text) {
          yield { type: 'text', delta: text };
        }
      }

      if (toolCalls.length === 0) {
        yield {
          type: 'done',
          answer: this.finalize(text, sources, executed, proposals, attachments, usage, context),
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
    if (forced.text) yield { type: 'text', delta: forced.text };
    yield {
      type: 'done',
      answer: this.finalize(
        forced.text,
        sources,
        executed,
        proposals,
        attachments,
        usage,
        context,
        'max_iterations',
      ),
    };
  }

  // -------------------------------------------------------------------------

  private async prepare(request: ChatRequest) {
    const context = await this.deps.contextBuilder.build(request.ctx, {
      ...(request.period ? { period: request.period } : {}),
      query: request.question,
    });

    const system = buildSystemPrompt(context, this.deps.tools.names(request.ctx.role), request.channel);
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
      const allowlist = allowContextCalendarYears(
        allowContextGoals(
          buildClaimAllowlist([...context.metrics, ...context.trailing30], deduped),
          context,
        ),
        context,
        deduped,
      );
      const claimText = scrubClaimNoise(content, attachments);
      const offenders = unsourcedNumbers(claimText, allowlist);
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
