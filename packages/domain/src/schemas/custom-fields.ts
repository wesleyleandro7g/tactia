import { z } from 'zod';
import {
  AGGREGATE_OPS,
  CUSTOM_FIELD_TYPES,
  FIELD_KEY_PATTERN,
  FLEXIBLE_ENTITY_TYPES,
  QUERY_OPERATORS,
} from '../data-catalog/types';

export const flexibleEntityTypeSchema = z.enum(FLEXIBLE_ENTITY_TYPES);
export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);

const customFieldConfigObjectSchema = z
  .object({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    unit: z.string().trim().max(40).optional(),
    options: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  })
  .passthrough();

export const createCustomFieldSchema = z.object({
  entityType: flexibleEntityTypeSchema,
  fieldKey: z.string().regex(FIELD_KEY_PATTERN, 'Use snake_case começando com letra (máx. 64).'),
  label: z.string().trim().min(1).max(120),
  fieldType: customFieldTypeSchema,
  description: z.string().trim().max(500).nullable().optional(),
  required: z.boolean().optional().default(false),
  config: customFieldConfigObjectSchema.optional().default({}),
});

export const updateCustomFieldSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  fieldType: customFieldTypeSchema.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  required: z.boolean().optional(),
  config: customFieldConfigObjectSchema.optional(),
});

export const customDataSchema = z.record(z.unknown());

export const catalogQuerySchema = z.object({
  entityType: flexibleEntityTypeSchema.optional(),
});

export const structuredFilterSchema = z.object({
  field: z.string().min(1).max(80),
  operator: z.enum(QUERY_OPERATORS),
  value: z.unknown().optional(),
});

export const structuredQuerySchema = z.object({
  entityType: flexibleEntityTypeSchema,
  fields: z.array(z.string().min(1).max(80)).max(40).optional(),
  filters: z.array(structuredFilterSchema).max(20).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const aggregateMetricSchema = z.object({
  op: z.enum(AGGREGATE_OPS),
  field: z.string().min(1).max(80).optional(),
});

export const structuredAggregateSchema = z.object({
  entityType: flexibleEntityTypeSchema,
  metrics: z.array(aggregateMetricSchema).min(1).max(8),
  groupBy: z.string().min(1).max(80).optional(),
  filters: z.array(structuredFilterSchema).max(20).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
