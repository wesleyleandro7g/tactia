import type { CustomFieldDefinitionRepository } from '@tactia/database';
import { AppError, ErrorCode } from '@tactia/shared';
import { asRecord, type CustomFieldType } from '../data-catalog/types';

type FieldDefinition = {
  fieldKey: string;
  fieldType: string;
  required: boolean;
  label: string;
  config: Record<string, unknown>;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T/;

export class CustomDataValidationService {
  constructor(private readonly definitions: CustomFieldDefinitionRepository) {}

  async validate(
    tenantId: string,
    entityType: string,
    customData: unknown,
    options: { unknown?: 'reject' | 'drop' } = {},
  ): Promise<Record<string, unknown>> {
    const unknownPolicy = options.unknown ?? 'reject';
    const input = asRecord(customData);
    const defs = await this.definitions.list({ tenantId, entityType });
    const byKey = new Map(defs.map((row) => [row.fieldKey, toDef(row)]));

    const extras = Object.keys(input).filter((key) => !byKey.has(key));
    if (extras.length > 0 && unknownPolicy === 'reject') {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Unknown custom fields: ${extras.join(', ')}`,
        { fields: extras },
      );
    }

    const result: Record<string, unknown> = {};
    for (const def of byKey.values()) {
      const raw = Object.prototype.hasOwnProperty.call(input, def.fieldKey)
        ? input[def.fieldKey]
        : undefined;
      if (raw === undefined || raw === null) {
        if (def.required) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Custom field '${def.fieldKey}' is required`,
            { field: def.fieldKey },
          );
        }
        continue;
      }
      result[def.fieldKey] = coerceAndCheck(def, raw);
    }
    return result;
  }

  /** Keep only catalog keys and coerce; skip invalid values instead of failing the row. */
  async pickValid(
    tenantId: string,
    entityType: string,
    customData: unknown,
  ): Promise<Record<string, unknown>> {
    const input = asRecord(customData);
    if (Object.keys(input).length === 0) return {};
    const defs = await this.definitions.list({ tenantId, entityType });
    const result: Record<string, unknown> = {};
    for (const row of defs) {
      if (!Object.prototype.hasOwnProperty.call(input, row.fieldKey)) continue;
      try {
        result[row.fieldKey] = coerceAndCheck(toDef(row), coerceFromSource(row.fieldType, input[row.fieldKey]));
      } catch {
        // Drop invalid mapped values on ingest rather than failing the canonical upsert.
      }
    }
    return result;
  }
}

function toDef(row: {
  fieldKey: string;
  fieldType: string;
  required: boolean;
  label: string;
  config: unknown;
}): FieldDefinition {
  return {
    fieldKey: row.fieldKey,
    fieldType: row.fieldType,
    required: row.required,
    label: row.label,
    config: asRecord(row.config),
  };
}

function coerceFromSource(fieldType: string, raw: unknown): unknown {
  if (raw == null) return raw;
  if (fieldType === 'number' && typeof raw === 'string') {
    const parsed = Number(raw.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (fieldType === 'boolean' && typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (text === 'true' || text === '1' || text === 'yes' || text === 'sim') return true;
    if (text === 'false' || text === '0' || text === 'no' || text === 'nao') return false;
  }
  if ((fieldType === 'select' || fieldType === 'text') && typeof raw !== 'string') {
    return String(raw);
  }
  return raw;
}

function coerceAndCheck(def: FieldDefinition, raw: unknown): unknown {
  const type = def.fieldType as CustomFieldType;
  switch (type) {
    case 'text':
    case 'select': {
      if (typeof raw !== 'string') {
        throw invalid(def, 'must be a string');
      }
      if (type === 'select') assertOption(def, raw);
      return raw;
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw invalid(def, 'must be a finite number');
      }
      const min = typeof def.config.min === 'number' ? def.config.min : undefined;
      const max = typeof def.config.max === 'number' ? def.config.max : undefined;
      if (min != null && raw < min) throw invalid(def, `must be >= ${min}`);
      if (max != null && raw > max) throw invalid(def, `must be <= ${max}`);
      return raw;
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') throw invalid(def, 'must be a boolean');
      return raw;
    }
    case 'date': {
      if (typeof raw !== 'string' || !ISO_DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
        throw invalid(def, 'must be an ISO date (YYYY-MM-DD)');
      }
      return raw;
    }
    case 'datetime': {
      if (typeof raw !== 'string' || !ISO_DATETIME.test(raw) || Number.isNaN(Date.parse(raw))) {
        throw invalid(def, 'must be an ISO datetime');
      }
      return raw;
    }
    case 'multiselect': {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
        throw invalid(def, 'must be an array of strings');
      }
      for (const item of raw) assertOption(def, item);
      return raw;
    }
    case 'object': {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw invalid(def, 'must be an object');
      }
      return raw;
    }
    case 'array': {
      if (!Array.isArray(raw)) throw invalid(def, 'must be an array');
      return raw;
    }
    default:
      throw invalid(def, `unsupported field type '${def.fieldType}'`);
  }
}

function assertOption(def: FieldDefinition, value: string) {
  const options = def.config.options;
  if (!Array.isArray(options) || options.length === 0) return;
  if (!options.includes(value)) {
    throw invalid(def, `must be one of: ${options.join(', ')}`);
  }
}

function invalid(def: FieldDefinition, message: string): AppError {
  return new AppError(
    ErrorCode.VALIDATION_ERROR,
    `Custom field '${def.fieldKey}' ${message}`,
    { field: def.fieldKey, type: def.fieldType },
  );
}
