import { z } from 'zod';

const idSchema = z.string().min(8).max(64);

export const createWhatsappNumberSchema = z.object({
  userId: idSchema,
  phone: z.string().trim().min(1).max(32),
  label: z.string().trim().min(1).max(80).optional(),
  contactName: z.string().trim().min(1).max(120).optional(),
  contactRole: z.string().trim().min(1).max(120).optional(),
});

export const updateWhatsappNumberSchema = z
  .object({
    userId: idSchema.optional(),
    phone: z.string().trim().min(1).max(32).optional(),
    label: z.string().trim().min(1).max(80).nullable().optional(),
    contactName: z.string().trim().min(1).max(120).nullable().optional(),
    contactRole: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .refine(
    (value) =>
      value.userId !== undefined ||
      value.phone !== undefined ||
      value.label !== undefined ||
      value.contactName !== undefined ||
      value.contactRole !== undefined,
    { message: 'At least one field is required' },
  );

export const whatsappAgentConfigSchema = z
  .object({
    tone: z.string().trim().max(80).nullable().optional(),
    instructions: z.string().trim().max(2000).nullable().optional(),
    companyContext: z.string().trim().max(2000).nullable().optional(),
    clarificationsEnabled: z.boolean().optional(),
    clarificationStartHour: z.number().int().min(0).max(23).optional(),
    clarificationEndHour: z.number().int().min(1).max(24).optional(),
    clarificationMaxPerDay: z.number().int().min(1).max(10).optional(),
    clarificationCooldownHours: z.number().int().min(1).max(168).optional(),
    clarificationWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  })
  .refine(
    (value) =>
      value.tone !== undefined ||
      value.instructions !== undefined ||
      value.companyContext !== undefined ||
      value.clarificationsEnabled !== undefined ||
      value.clarificationStartHour !== undefined ||
      value.clarificationEndHour !== undefined ||
      value.clarificationMaxPerDay !== undefined ||
      value.clarificationCooldownHours !== undefined ||
      value.clarificationWeekdays !== undefined,
    { message: 'At least one field is required' },
  )
  .refine(
    (value) =>
      value.clarificationStartHour === undefined ||
      value.clarificationEndHour === undefined ||
      value.clarificationStartHour < value.clarificationEndHour,
    { message: 'Start hour must be before end hour', path: ['clarificationEndHour'] },
  );
