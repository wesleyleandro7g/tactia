import { z } from 'zod';

export const ACTION_TYPES = [
  'create_task',
  'send_email',
  'send_whatsapp',
  'generate_report',
  'browser_action',
] as const;

export const createActionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  configuration: z.record(z.unknown()).optional(),
  requiresApproval: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const updateActionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  configuration: z.record(z.unknown()).optional(),
  requiresApproval: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const listActionsQuerySchema = z.object({
  enabled: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const proposeActionSchema = z
  .object({
    actionId: z.string().uuid().optional(),
    actionType: z.enum(ACTION_TYPES).optional(),
    input: z.record(z.unknown()).default({}),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Boolean(value.actionId ?? value.actionType), {
    message: 'Informe actionId ou actionType',
    path: ['actionType'],
  });

export const listExecutionsQuerySchema = z.object({
  status: z
    .enum([
      'pending',
      'awaiting_approval',
      'approved',
      'running',
      'completed',
      'failed',
      'cancelled',
    ])
    .optional(),
  actionId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listApprovalsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const approvalDecisionSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});
