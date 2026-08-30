import { AppError, logger } from '@tactia/shared';
import type { AiContext } from './context-builder';
import { buildSystemPrompt } from './system-prompt';
import type { ToolRegistry } from './tool-registry';
import type {
  ChatAnswer,
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

/**
 * Minimal contract the orchestrator needs from the context builder — keeps it
 * decoupled from Prisma-backed services (and trivially stubbable in tests).
 */
export type ContextSource = {
  build(
    ctx: ToolContext,
    options?: { period?: { from: Date; to: Date } },
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
};

export type ChatRequest = {
  ctx: ToolContext;
  question: string;
  history?: ChatTurn[];
  /** Period used to build the context. Defaults to the current month. */
  period?: { from: Date; to: Date };
};

const UNSOURCED_FALLBACK =
  'Não consegui confirmar esses números com os dados da empresa, então prefiro não responder ' +
  'com valores. Tente reformular a pergunta indicando o período desejado.';

const EMPTY_FALLBACK =
  'Não consegui formular uma resposta para essa pergunta. Tente reformulá-la com mais detalhes.';

function containsNumber(text: string): boolean {
  return /\d/.test(text);
}

function dedupeSources(sources: MessageSource[]): MessageSource[] {
  const seen = new Map<string, MessageSource>();
  for (const source of sources) {
    const key = `${source.metric}|${source.period?.from ?? ''}|${source.period?.to ?? ''}`;
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

  constructor(
    private readonly deps: OrchestratorDeps,
    config: OrchestratorConfig = {},
  ) {
    this.maxIterations = config.maxIterations ?? 4;
    this.historyLimit = config.historyLimit ?? 12;
    this.enforceSources = config.enforceSources ?? true;
  }

  /** Single-shot answer (no streaming). */
  async run(request: ChatRequest): Promise<ChatAnswer> {
    const { context, system, messages } = await this.prepare(request);
    const sources: MessageSource[] = [...context.sources];
    const executed: ExecutedToolCall[] = [];
    let usage: LLMUsage | undefined;

    for (let round = 0; round < this.maxIterations; round += 1) {
      const completion = await this.deps.llm.complete({
        system,
        messages,
        tools: this.deps.tools.definitions(),
      });
      usage = sumUsage(usage, completion.usage);

      if (completion.toolCalls.length === 0) {
        return this.finalize(completion.text, sources, executed, usage);
      }

      messages.push({
        role: 'assistant',
        content: completion.text,
        toolCalls: completion.toolCalls,
      });

      for (const toolCall of completion.toolCalls) {
        const outcome = await this.executeToolCall(request.ctx, toolCall);
        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          output: outcome.output,
        });
        executed.push(outcome.executed);
        sources.push(...outcome.executed.sources);
      }
    }

    // Tool budget exhausted: force a final answer with the data already gathered.
    const forced = await this.deps.llm.complete({ system, messages });
    usage = sumUsage(usage, forced.usage);
    return this.finalize(forced.text, sources, executed, usage, 'max_iterations');
  }

  /**
   * Streaming variant. Emits tool activity and text deltas, closing with a
   * `done` event that carries the persisted answer (content + sources).
   */
  async *stream(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const { context, system, messages } = await this.prepare(request);
    const sources: MessageSource[] = [...context.sources];
    const executed: ExecutedToolCall[] = [];
    let usage: LLMUsage | undefined;

    for (let round = 0; round < this.maxIterations; round += 1) {
      const request$ = { system, messages, tools: this.deps.tools.definitions() };

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
        yield { type: 'done', answer: this.finalize(text, sources, executed, usage) };
        return;
      }

      messages.push({ role: 'assistant', content: text, toolCalls });

      for (const toolCall of toolCalls) {
        yield { type: 'tool_call', name: toolCall.name, input: toolCall.input };
        const outcome = await this.executeToolCall(request.ctx, toolCall);
        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          output: outcome.output,
        });
        executed.push(outcome.executed);
        sources.push(...outcome.executed.sources);
        yield {
          type: 'tool_result',
          name: toolCall.name,
          sources: outcome.executed.sources,
          ...(outcome.executed.error ? { error: outcome.executed.error } : {}),
        };
      }
    }

    const forced = await this.deps.llm.complete({ system, messages });
    usage = sumUsage(usage, forced.usage);
    if (forced.text) yield { type: 'text', delta: forced.text };
    yield {
      type: 'done',
      answer: this.finalize(forced.text, sources, executed, usage, 'max_iterations'),
    };
  }

  // -------------------------------------------------------------------------

  private async prepare(request: ChatRequest) {
    const context = await this.deps.contextBuilder.build(request.ctx, {
      ...(request.period ? { period: request.period } : {}),
    });

    const system = buildSystemPrompt(context, this.deps.tools.names());
    const history = (request.history ?? []).slice(-this.historyLimit);

    const messages: LLMMessage[] = [
      ...history.map((turn): LLMMessage =>
        turn.role === 'user'
          ? { role: 'user', content: turn.content }
          : { role: 'assistant', content: turn.content },
      ),
      { role: 'user', content: request.question },
    ];

    return { context, system, messages };
  }

  private async executeToolCall(
    ctx: ToolContext,
    toolCall: LLMToolCall,
  ): Promise<{ output: unknown; executed: ExecutedToolCall }> {
    const started = Date.now();
    try {
      const result = await this.deps.tools.execute(toolCall.name, ctx, toolCall.input);
      return {
        output: result.data,
        executed: {
          name: toolCall.name,
          input: toolCall.input,
          durationMs: Date.now() - started,
          sources: result.sources,
        },
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
        output: { error: message },
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
    usage: LLMUsage | undefined,
    guardrail?: ChatAnswer['guardrail'],
  ): ChatAnswer {
    const deduped = dedupeSources(sources);
    let content = text.trim();
    let flag = guardrail;

    if (this.enforceSources && containsNumber(content) && deduped.length === 0) {
      // AI safety: a number without internal evidence never reaches the user.
      logger.warn({ operation: 'ai_guardrail', reason: 'unsourced_numbers' });
      content = UNSOURCED_FALLBACK;
      flag = 'unsourced_numbers';
    }
    if (!content) content = EMPTY_FALLBACK;

    return {
      content,
      sources: deduped,
      toolCalls,
      provider: this.deps.llm.provider,
      model: this.deps.llm.model,
      ...(usage ? { usage } : {}),
      ...(flag ? { guardrail: flag } : {}),
    };
  }
}
