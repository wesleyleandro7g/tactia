import { z } from 'zod';

/**
 * Client-safe chat protocol shared by apps/web and apps/admin: SSE events,
 * message view model and the ephemeral (non-persisted) turn payload.
 * No server-only imports here — this module is bundled into the browser.
 */

export const CHAT_MAX_CONTENT = 4000;
/** Turns replayed to the model (same limit as the persisted web chat). */
export const CHAT_HISTORY_TURNS = 12;
/** Assistant answers may be longer than a question; history entries are capped here. */
export const CHAT_MAX_HISTORY_CONTENT = 16_000;

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

export type ChatAttachment = {
  id: string;
  type: 'infographic';
  title: string;
  mime: string;
  template: string;
  url: string;
};

export type ChatMessageView = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  sources?: ChatSource[];
  proposals?: ChatProposal[];
  attachments?: ChatAttachment[];
  browserTaskIds?: string[];
  /** Identifica a resposta assíncrona de uma tarefa para deduplicação. */
  browserResultTaskId?: string;
  /** Perguntas sugeridas pelo assistente (bloco "Próximos passos"). */
  followUps?: string[];
  /** Nomes das tools consultadas para produzir a resposta. */
  toolsUsed?: string[];
  error?: string | null;
};

export type ChatStreamEvent =
  | { type: 'start'; conversationId: string | null; userMessageId: string }
  | { type: 'tool_call'; name: string; input: unknown }
  | {
      type: 'tool_result';
      name: string;
      sources?: ChatSource[];
      proposal?: ChatProposal;
      attachment?: ChatAttachment;
      browserTaskId?: string;
      durationMs?: number;
      error?: string;
    }
  | { type: 'text'; delta: string }
  | {
      type: 'done';
      messageId: string;
      content: string;
      sources?: ChatSource[];
      proposals?: ChatProposal[];
      attachments?: ChatAttachment[];
      browserTaskIds?: string[];
      followUps?: string[];
      toolCalls?: Array<{ name: string; input?: unknown }>;
    }
  | { type: 'error'; code: string; message: string };

/**
 * Ephemeral turn (admin test chat): the client owns the history and replays
 * the last turns on every request. Only user/assistant turns are accepted so a
 * client can never inject `system`/`tool` messages into the prompt.
 */
export const ephemeralTurnSchema = z.object({
  content: z.string().trim().min(1).max(CHAT_MAX_CONTENT),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(CHAT_MAX_HISTORY_CONTENT),
      }),
    )
    .max(CHAT_HISTORY_TURNS)
    .default([]),
});

export type EphemeralTurnInput = z.infer<typeof ephemeralTurnSchema>;
