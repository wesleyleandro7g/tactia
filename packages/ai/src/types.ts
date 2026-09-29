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
  /** `null` when the principal is a backoffice operator (`operatorId` is set). */
  userId: string | null;
  role: MembershipRole;
  /** Set by the MCP adapter so `propose_action` records origin `mcp`. */
  origin?: 'ai' | 'mcp';
  /** Only the authenticated chat route sets this; browser tasks use it for the status card. */
  conversationId?: string;
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
  /** Canonical record cited as qualitative evidence */
  refId?: string;
  excerpt?: string;
  /** Numeric claims extracted from trusted structured results, not from document prose. */
  numericEvidence?: Array<{
    value: number;
    unit: 'number' | 'percent';
    kind: 'observed' | 'estimated';
    metric: string;
    period?: { from: string; to: string };
  }>;
};

/** Media produced by a tool (e.g. generate_infographic) for chat/WhatsApp delivery. */
export type ChatAttachment = {
  id: string;
  type: 'infographic';
  title: string;
  mime: string;
  template: string;
  /** Authenticated path the web client can load, e.g. /api/v1/infographics/:id */
  url: string;
};

export type ToolResult<TData = unknown> = {
  data: TData;
  sources: MessageSource[];
  /**
   * Set when the tool created an action proposal awaiting human approval
   * (Etapa 7). The LLM never executes anything — it can only propose.
   */
  proposal?: ActionProposal;
  /** Optional media attachment produced by the tool (infographic PNG, etc.). */
  attachment?: ChatAttachment;
  browserTaskId?: string;
};

/** Structured action proposed during the conversation (spec §44). */
export type ActionProposal = {
  id: string;
  actionType: string;
  status: string;
  requiresApproval: boolean;
  approvalId?: string | null;
  /** Payload validated by the action schema, echoed for the UI. */
  input?: Record<string, unknown>;
};

/** Tool as stored in the registry — input is validated before `execute` runs. */
export type Tool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  /** Lowest membership that may see/call this tool. Default: viewer. */
  readonly minRole?: MembershipRole;
  /** Safe to call again while recovering a rejected answer. Defaults to false. */
  readonly recoverySafe?: boolean;
  execute(context: ToolContext, input: unknown): Promise<ToolResult>;
};

export type ExecutedToolCall = {
  name: string;
  input: unknown;
  durationMs: number;
  sources: MessageSource[];
  error?: string;
  browserTaskId?: string;
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
  /** Force or require tool selection for deterministic routing policies. */
  toolChoice?: 'auto' | 'required' | { type: 'tool'; toolName: string };
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
  /** Suggested next questions, parsed from the trailing "Próximos passos" block. */
  followUps: string[];
  sources: MessageSource[];
  toolCalls: ExecutedToolCall[];
  /** Actions proposed in this turn, awaiting human approval (Etapa 7). */
  proposals: ActionProposal[];
  /** Infographics / media generated during this turn. */
  attachments: ChatAttachment[];
  browserTaskIds?: string[];
  provider: string;
  model: string;
  usage?: LLMUsage;
  /** Set when a safety guardrail changed the answer (spec §43). */
  guardrail?: 'unsourced_numbers' | 'max_iterations' | 'claim_mismatch';
  resolution?: 'direct' | 'recovered' | 'partial' | 'clarification';
  recoveryAttempts?: number;
};

export type ChatStreamEvent =
  | { type: 'tool_call'; name: string; input: unknown }
  | {
      type: 'tool_result';
      name: string;
      sources: MessageSource[];
      durationMs?: number;
      proposal?: ActionProposal;
      attachment?: ChatAttachment;
      browserTaskId?: string;
      error?: string;
    }
  | { type: 'text'; delta: string }
  | { type: 'done'; answer: ChatAnswer }
  | { type: 'error'; code: string; message: string };
