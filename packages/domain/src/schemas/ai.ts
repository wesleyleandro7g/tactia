import { z } from 'zod';

/** Conversation title is optional — derived from the first user message when absent. */
export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
});

export const listConversationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  /** Stream the answer as Server-Sent Events instead of a single JSON response. */
  stream: z.boolean().optional().default(false),
});

export const appendMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1).max(20000),
  metadata: z.record(z.unknown()).nullable().optional(),
});
