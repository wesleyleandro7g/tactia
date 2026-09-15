import { z } from 'zod';
import { isSelectableSourceKind } from '../data-sources/catalog';

export const createDataSourceSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).refine((value) => isSelectableSourceKind(value), {
    message: 'Unknown or non-selectable data source type',
  }),
  configuration: z.record(z.unknown()).optional(),
  credentialId: z.string().uuid().optional().nullable(),
});

export const updateDataSourceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  configuration: z.record(z.unknown()).optional().nullable(),
  credentialId: z.string().uuid().optional().nullable(),
  status: z.enum(['active', 'inactive', 'error']).optional(),
});

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

export const previewQuerySchema = z.object({
  resource: z.string().min(1).default('data'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const probeDataSourceSchema = z.object({
  dialect: z.enum(['postgres', 'mysql']),
  configuration: z.object({
    host: z.string().min(1),
    port: z.coerce.number().int().positive().optional(),
    database: z.string().min(1),
    schema: z.string().optional(),
    ssl: z.boolean().optional(),
  }),
  credentials: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
});
