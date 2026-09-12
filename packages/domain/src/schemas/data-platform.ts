import { z } from 'zod';

export const createDataSourceSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['csv', 'xlsx', 'postgres', 'rest', 'google_sheets', 'document', 'image', 'audio']),
  configuration: z.record(z.unknown()).optional(),
  credentialId: z.string().uuid().optional().nullable(),
});

export const updateDataSourceSchema = createDataSourceSchema.partial();

export const createMappingSchema = z.object({
  sourceEntity: z.string().min(1),
  targetEntity: z.enum([
    'customer',
    'lead',
    'product',
    'seller',
    'sale',
    'interaction',
    'activity',
    'expense',
    'payment',
    'inventory_level',
    'campaign',
  ]),
  configuration: z.object({
    fields: z.array(
      z.object({
        source: z.string(),
        target: z.string(),
        transform: z.enum(['trim', 'number', 'date', 'currency', 'none']).optional(),
      }),
    ),
  }),
});

export const updateMappingSchema = createMappingSchema.partial();

export const createCredentialSchema = z.object({
  provider: z.string().min(1),
  data: z.record(z.unknown()),
});
