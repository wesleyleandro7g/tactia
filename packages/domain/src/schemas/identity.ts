import { z } from 'zod';

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case')
    .optional(),
  timezone: z.string().min(1).max(64).optional(),
  currency: z.string().length(3).optional(),
});

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timezone: z.string().min(1).max(64).optional(),
  currency: z.string().length(3).optional(),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

const idSchema = z.string().min(8).max(64);

export const createMembershipSchema = z.object({
  userId: idSchema,
  role: z.enum(['admin', 'member', 'viewer']),
});

export const updateMembershipSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer']).optional(),
  status: z.enum(['active', 'invited', 'suspended', 'removed']).optional(),
});
