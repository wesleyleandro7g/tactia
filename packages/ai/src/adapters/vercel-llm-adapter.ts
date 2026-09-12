import { createOpenAI } from '@ai-sdk/openai';
import { generateText, streamText, tool, type ModelMessage, type ToolSet } from 'ai';
import { AppError, ErrorCode, logger } from '@tactia/shared';
import type {
  LLMAdapter,
  LLMCompletion,
  LLMMessage,
  LLMRequest,
  LLMStreamChunk,
  LLMToolCall,
} from '../types';

export type VercelLLMAdapterConfig = {
  /** Provider label — only OpenAI-compatible endpoints in V0.1. */
  provider?: string;
  apiKey: string;
  model: string;
  /** Any OpenAI-compatible endpoint (Azure, Groq, OpenRouter, Ollama...). */
  baseURL?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

function toModelMessages(messages: LLMMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === 'user') {
      return { role: 'user', content: message.content };
    }
    if (message.role === 'assistant') {
      if (message.toolCalls?.length) {
        return {
          role: 'assistant',
          content: [
            ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
            ...message.toolCalls.map((call) => ({
              type: 'tool-call' as const,
              toolCallId: call.id,
              toolName: call.name,
              input: call.input,
            })),
          ],
        };
      }
      return { role: 'assistant', content: message.content };
    }
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          output:
            typeof message.output === 'string'
              ? { type: 'text', value: message.output }
              : { type: 'json', value: JSON.parse(JSON.stringify(message.output ?? null)) },
        },
      ],
    };
  });
}

/**
 * Tools are declared *without* `execute` on purpose: the SDK returns the tool
 * calls and the Tactia orchestrator runs them itself, so validation, tenant
 * scoping and evidence collection stay under our control (spec §41).
 */
function toToolSet(request: LLMRequest): ToolSet | undefined {
  if (!request.tools?.length) return undefined;
  const entries = request.tools.map((definition) => [
    definition.name,
    tool({ description: definition.description, inputSchema: definition.inputSchema }),
  ]);
  return Object.fromEntries(entries) as ToolSet;
}

function aiError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : 'LLM request failed';
  logger.error({ err: error }, 'llm request failed');
  return new AppError(ErrorCode.AI_ERROR, `Falha ao consultar o modelo de linguagem: ${message}`);
}

/**
 * LLM Adapter over the Vercel AI SDK. The rest of the codebase depends only on
 * the `LLMAdapter` interface, so provider/model are swappable via env.
 */
export class VercelLLMAdapter implements LLMAdapter {
  readonly provider: string;
  readonly model: string;
  private readonly languageModel: ReturnType<ReturnType<typeof createOpenAI>>;
  private readonly temperature: number;
  private readonly maxOutputTokens: number;

  constructor(config: VercelLLMAdapterConfig) {
    if (!config.apiKey) {
      throw new AppError(ErrorCode.AI_ERROR, 'LLM_API_KEY não configurada');
    }
    this.provider = config.provider ?? 'openai';
    this.model = config.model;
    this.temperature = config.temperature ?? 0.2;
    this.maxOutputTokens = config.maxOutputTokens ?? 1200;

    const openai = createOpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.provider ? { name: config.provider } : {}),
    });
    this.languageModel = openai(config.model);
  }

  async complete(request: LLMRequest): Promise<LLMCompletion> {
    try {
      const result = await generateText({
        model: this.languageModel,
        system: request.system,
        messages: toModelMessages(request.messages),
        tools: toToolSet(request),
        temperature: request.temperature ?? this.temperature,
        maxOutputTokens: request.maxOutputTokens ?? this.maxOutputTokens,
      });

      return {
        text: result.text,
        toolCalls: result.toolCalls.map(
          (call): LLMToolCall => ({
            id: call.toolCallId,
            name: call.toolName,
            input: call.input,
          }),
        ),
        finishReason: result.finishReason,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
      };
    } catch (error) {
      throw aiError(error);
    }
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    let text = '';
    const toolCalls: LLMToolCall[] = [];

    try {
      const result = streamText({
        model: this.languageModel,
        system: request.system,
        messages: toModelMessages(request.messages),
        tools: toToolSet(request),
        temperature: request.temperature ?? this.temperature,
        maxOutputTokens: request.maxOutputTokens ?? this.maxOutputTokens,
      });

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          text += part.text;
          yield { type: 'text-delta', delta: part.text };
        } else if (part.type === 'tool-call') {
          const call: LLMToolCall = {
            id: part.toolCallId,
            name: part.toolName,
            input: part.input,
          };
          toolCalls.push(call);
          yield { type: 'tool-call', toolCall: call };
        } else if (part.type === 'error') {
          throw part.error;
        } else if (part.type === 'finish') {
          yield {
            type: 'finish',
            completion: {
              text,
              toolCalls,
              finishReason: part.finishReason,
              usage: {
                inputTokens: part.totalUsage.inputTokens,
                outputTokens: part.totalUsage.outputTokens,
              },
            },
          };
        }
      }
    } catch (error) {
      throw aiError(error);
    }
  }
}
