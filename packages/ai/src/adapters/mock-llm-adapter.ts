import { AppError, ErrorCode } from '@tactia/shared';
import type {
  LLMAdapter,
  LLMCompletion,
  LLMRequest,
  LLMStreamChunk,
  LLMToolCall,
} from '../types';

export type ScriptedTurn = {
  /** Tool calls the fake model should emit on this turn. */
  toolCalls?: Array<{ name: string; input?: unknown }>;
  /** Text answer for this turn. */
  text?: string;
};

export type MockLLMAdapterOptions = {
  /** One entry per orchestrator round, consumed in order. */
  script: ScriptedTurn[];
  /** When set, `complete` throws to exercise AI_ERROR handling. */
  failWith?: string;
  model?: string;
};

/**
 * Deterministic LLM used in tests: no network, scripted turns.
 * Records every request so tests can assert what the model actually received
 * (system prompt, tool results, tool definitions).
 */
export class MockLLMAdapter implements LLMAdapter {
  readonly provider = 'mock';
  readonly model: string;
  readonly requests: LLMRequest[] = [];
  private turn = 0;

  constructor(private readonly options: MockLLMAdapterOptions) {
    this.model = options.model ?? 'mock-model';
  }

  get turnsUsed(): number {
    return this.turn;
  }

  async complete(request: LLMRequest): Promise<LLMCompletion> {
    this.requests.push(request);

    if (this.options.failWith) {
      throw new AppError(ErrorCode.AI_ERROR, this.options.failWith);
    }

    const scripted = this.options.script[this.turn] ?? { text: '' };
    this.turn += 1;

    const toolCalls: LLMToolCall[] = (scripted.toolCalls ?? []).map((call, index) => ({
      id: `call-${this.turn}-${index}`,
      name: call.name,
      input: call.input ?? {},
    }));

    return {
      text: scripted.text ?? '',
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool-calls' : 'stop',
      usage: { inputTokens: 10, outputTokens: 20 },
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const completion = await this.complete(request);
    for (const toolCall of completion.toolCalls) {
      yield { type: 'tool-call', toolCall };
    }
    for (const word of completion.text ? completion.text.split(' ') : []) {
      yield { type: 'text-delta', delta: `${word} ` };
    }
    yield { type: 'finish', completion };
  }
}
