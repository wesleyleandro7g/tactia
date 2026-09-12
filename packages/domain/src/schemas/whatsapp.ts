import { z } from 'zod';

const idSchema = z.string().min(8).max(64);

export const createWhatsappNumberSchema = z.object({
  userId: idSchema,
  phone: z.string().trim().min(1).max(32),
  label: z.string().trim().min(1).max(80).optional(),
});

export const updateWhatsappNumberSchema = z
  .object({
    userId: idSchema.optional(),
    phone: z.string().trim().min(1).max(32).optional(),
    label: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .refine(
    (value) => value.userId !== undefined || value.phone !== undefined || value.label !== undefined,
    { message: 'At least one field is required' },
  );
