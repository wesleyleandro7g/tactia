import type { z } from 'zod';
import type { MembershipRole, RequestContext } from '@tactia/shared';

// ---------------------------------------------------------------------------
// Tools (spec §42)
// ---------------------------------------------------------------------------

/**
 * Execution context handed to every tool.
 *
 * `tenantId`/`userId`/`role` always come from the authenticated session — never
 * from LLM output (spec §34). It is a narrowed `RequestContext` so tools can
 * delegate straight to domain services.
 */
export type ToolContext = RequestContext & {
  tenantId: string;
  userId: string;
  role: MembershipRole;
};

/**
 * Internal evidence attached to any answer containing numbers (spec §43).
 * `metric` is a metric key (`revenue`) or a dataset key (`insights`).
 */
export type MessageSource = {
  metric: string;
  period?: { from: string; to: string };
  value?: number;
  /** Tool that produced the evidence */
  tool?: string;
  /** Human readable pt-BR label for the UI ("vendas entre 01/08 e 25/08") */
  label?: string;
};

export type ToolResult<TData = unknown> = {
  data: TData;
  sources: MessageSource[];
};

/** Tool as stored in the registry — input is validated before `execute` runs. */
export type Tool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  execute(context: ToolContext, input: unknown): Promise<ToolResult>;
};

export type ExecutedToolCall = {
  name: string;
  input: unknown;
  durationMs: number;
  sources: MessageSource[];
  error?: string;
};

// ---------------------------------------------------------------------------
// LLM adapter (provider-agnostic)
// ---------------------------------------------------------------------------

export type LLMToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
};

export type LLMToolCall = {
  id: string;
  name: string;
  input: unknown;
};

export type LLMMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LLMToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; output: unknown };

export type LLMRequest = {
  system: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
};

export type LLMUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type LLMCompletion = {
  text: string;
  toolCalls: LLMToolCall[];
  finishReason: string;
  usage?: LLMUsage;
};

export type LLMStreamChunk =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; toolCall: LLMToolCall }
  | { type: 'finish'; completion: LLMCompletion };

/**
 * Own abstraction over the LLM provider. The orchestrator only ever talks to
 * this interface, so swapping provider/model (or mocking in tests) requires no
 * change to the chat logic.
 */
export interface LLMAdapter {
  readonly provider: string;
  readonly model: string;
  complete(request: LLMRequest): Promise<LLMCompletion>;
  /** Optional token streaming. Orchestrator falls back to `complete` when absent. */
  stream?(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChatAnswer = {
  content: string;
  sources: MessageSource[];
  toolCalls: ExecutedToolCall[];
  provider: string;
  model: string;
  usage?: LLMUsage;
  /** Set when a safety guardrail changed the answer (spec §43). */
  guardrail?: 'unsourced_numbers' | 'max_iterations';
};

export type ChatStreamEvent =
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; sources: MessageSource[]; error?: string }
  | { type: 'text'; delta: string }
  | { type: 'done'; answer: ChatAnswer }
  | { type: 'error'; code: string; message: string };
