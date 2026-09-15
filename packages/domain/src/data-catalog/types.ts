export const FLEXIBLE_ENTITY_TYPES = ['customer', 'product', 'sale', 'sale_item'] as const;

export type FlexibleEntityType = (typeof FLEXIBLE_ENTITY_TYPES)[number];

export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'multiselect',
  'object',
  'array',
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const QUERY_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'is_null'] as const;

export type QueryOperator = (typeof QUERY_OPERATORS)[number];

export const AGGREGATE_OPS = ['count', 'sum', 'avg', 'min', 'max'] as const;

export type AggregateOp = (typeof AGGREGATE_OPS)[number];

export type CatalogFieldSource = 'canonical' | 'custom';

export type CatalogField = {
  key: string;
  label: string;
  type: string;
  source: CatalogFieldSource;
  description?: string | null;
  filterable: boolean;
  aggregatable: boolean;
  required?: boolean;
  unit?: string;
  options?: string[];
};

export type CatalogEntity = {
  entityType: FlexibleEntityType;
  label: string;
  fields: CatalogField[];
};

export type CanonicalFieldSpec = {
  key: string;
  label: string;
  type: string;
  column: string;
  description?: string;
  filterable: boolean;
  aggregatable: boolean;
};

export type EntityTableSpec = {
  entityType: FlexibleEntityType;
  table: string;
  label: string;
  deletedAtColumn?: string;
  defaultOrderColumn: string;
  fields: CanonicalFieldSpec[];
};

export function isFlexibleEntityType(value: string): value is FlexibleEntityType {
  return (FLEXIBLE_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isCustomFieldType(value: string): value is CustomFieldType {
  return (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

export const CUSTOM_MAPPING_PREFIX = 'custom:';

export function isCustomMappingTarget(target: string): boolean {
  return target.startsWith(CUSTOM_MAPPING_PREFIX);
}

export function customFieldKeyFromTarget(target: string): string {
  return target.slice(CUSTOM_MAPPING_PREFIX.length);
}

export function customMappingTarget(fieldKey: string): string {
  return `${CUSTOM_MAPPING_PREFIX}${fieldKey}`;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const OPERATORS_BY_TYPE: Record<string, ReadonlySet<QueryOperator>> = {
  text: new Set(['eq', 'neq', 'contains', 'in', 'is_null']),
  uuid: new Set(['eq', 'neq', 'in', 'is_null']),
  number: new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is_null']),
  boolean: new Set(['eq', 'neq', 'is_null']),
  date: new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null']),
  datetime: new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null']),
  select: new Set(['eq', 'neq', 'in', 'is_null']),
  multiselect: new Set(['contains', 'in', 'is_null']),
  object: new Set(['is_null']),
  array: new Set(['is_null']),
};
