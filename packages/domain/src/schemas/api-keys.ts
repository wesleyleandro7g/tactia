import { z } from 'zod';

export const API_KEY_SCOPES = ['tools:read', 'tools:propose'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).optional(),
});
