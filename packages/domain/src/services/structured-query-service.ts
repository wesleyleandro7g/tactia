import { Prisma, type StructuredQueryRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertTenantContext } from '../authz';
import { getEntitySpec } from '../data-catalog/canonical-fields';
import {
  OPERATORS_BY_TYPE,
  asRecord,
  type CatalogField,
  type FlexibleEntityType,
  type QueryOperator,
} from '../data-catalog/types';
import { structuredAggregateSchema, structuredQuerySchema } from '../schemas/custom-fields';
import { decimalToNumber } from '../utils/serialize';
import type { DataCatalogService } from './data-catalog-service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_AGG_LIMIT = 50;
const NUMERIC_RE = '^-?[0-9]+(\\.[0-9]+)?$';

type FilterInput = { field: string; operator: QueryOperator; value?: unknown };

export class StructuredQueryService {
  constructor(
    private readonly catalog: DataCatalogService,
    private readonly queries: StructuredQueryRepository,
  ) {}

  async query(ctx: RequestContext, raw: unknown) {
    assertTenantContext(ctx);
    const input = structuredQuerySchema.parse(raw);
    const entity = await this.catalog.requireEntity(ctx.tenantId, input.entityType);
    const spec = getEntitySpec(input.entityType);
    const requested = input.fields?.length
      ? input.fields
      : spec.fields.slice(0, 8).map((field) => field.key);
    const catalogFields = requested.map((key) => {
      const field = entity.fields.find((item) => item.key === key);
      if (!field) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `Unknown field '${key}' on ${input.entityType}`);
      }
      return field;
    });

    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const filters = input.filters ?? [];
    const where = await this.whereSql(ctx.tenantId, input.entityType, entity.fields, filters);

    const selectParts = [
      Prisma.raw('custom_data'),
      ...catalogFields
        .filter((field) => field.source === 'canonical')
        .map((field) => {
          const column = spec.fields.find((item) => item.key === field.key)!.column;
          return Prisma.raw(`"${column}" AS "${field.key}"`);
        }),
    ];
    const hasId = catalogFields.some((field) => field.key === 'id');
    if (!hasId) selectParts.unshift(Prisma.raw('id'));

    const fetchLimit = limit + 1;
    const sql = Prisma.sql`
      SELECT ${Prisma.join(selectParts, ', ')}
      FROM ${Prisma.raw(`"${spec.table}"`)}
      WHERE ${where}
      ORDER BY ${Prisma.raw(`"${spec.defaultOrderColumn}"`)} DESC
      LIMIT ${fetchLimit}
    `;

    const rawRows = await this.queries.query<Record<string, unknown>>(sql);
    const hasMore = rawRows.length > limit;
    const sliced = hasMore ? rawRows.slice(0, limit) : rawRows;
    const rows = sliced.map((row) => projectRow(row, catalogFields));

    return {
      entityType: input.entityType,
      rows,
      meta: {
        count: rows.length,
        hasMore,
        fields: requested,
      },
    };
  }

  async aggregate(ctx: RequestContext, raw: unknown) {
    assertTenantContext(ctx);
    const input = structuredAggregateSchema.parse(raw);
    const entity = await this.catalog.requireEntity(ctx.tenantId, input.entityType);
    const spec = getEntitySpec(input.entityType);
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_AGG_LIMIT, 1), DEFAULT_AGG_LIMIT);
    const where = await this.whereSql(ctx.tenantId, input.entityType, entity.fields, input.filters ?? []);

    const metricSelects: Prisma.Sql[] = [];
    const aliases: string[] = [];

    for (const [index, metric] of input.metrics.entries()) {
      if (metric.op === 'count' && !metric.field) {
        const alias = `metric_${index}`;
        metricSelects.push(Prisma.sql`COUNT(*)::int AS ${Prisma.raw(`"${alias}"`)}`);
        aliases.push(alias);
        continue;
      }
      const fieldKey = metric.field;
      if (!fieldKey) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Aggregation field is required unless op is count');
      }
      const field = entity.fields.find((item) => item.key === fieldKey);
      if (!field) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `Unknown field '${fieldKey}' on ${input.entityType}`);
      }
      if (!field.aggregatable && metric.op !== 'count') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `Field '${fieldKey}' is not aggregatable`);
      }
      const expr = numericExpr(spec, field);
      const alias = `metric_${index}`;
      const fn = metric.op.toUpperCase();
      metricSelects.push(Prisma.sql`${Prisma.raw(fn)}(${expr}) AS ${Prisma.raw(`"${alias}"`)}`);
      aliases.push(alias);
    }

    const groupField = input.groupBy
      ? entity.fields.find((item) => item.key === input.groupBy)
      : undefined;
    if (input.groupBy && !groupField) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Unknown field '${input.groupBy}' on ${input.entityType}`,
      );
    }

    const groupExpr = groupField ? groupExprSql(spec, groupField) : null;
    const selectHead = groupExpr
      ? Prisma.sql`${groupExpr} AS group_value, ${Prisma.join(metricSelects, ', ')}`
      : Prisma.join(metricSelects, ', ');

    const sql = groupExpr
      ? Prisma.sql`
          SELECT ${selectHead}
          FROM ${Prisma.raw(`"${spec.table}"`)}
          WHERE ${where}
          GROUP BY 1
          ORDER BY 1 ASC NULLS LAST
          LIMIT ${limit}
        `
      : Prisma.sql`
          SELECT ${selectHead}
          FROM ${Prisma.raw(`"${spec.table}"`)}
          WHERE ${where}
        `;

    const rawRows = await this.queries.query<Record<string, unknown>>(sql);
    const metrics = rawRows.map((row) => {
      const out: Record<string, unknown> = {};
      if (groupField) out[groupField.key] = row['group_value'] ?? null;
      input.metrics.forEach((metric, index) => {
        const alias = aliases[index]!;
        const key =
          metric.op === 'count' && !metric.field
            ? 'count'
            : `${metric.op}_${metric.field}`;
        out[key] = toJsonNumber(row[alias]);
      });
      return out;
    });

    return {
      entityType: input.entityType,
      metrics,
      meta: {
        count: metrics.length,
        groupBy: input.groupBy ?? null,
        period: null,
      },
    };
  }

  private async whereSql(
    tenantId: string,
    entityType: FlexibleEntityType,
    fields: CatalogField[],
    filters: FilterInput[],
  ): Promise<Prisma.Sql> {
    const spec = getEntitySpec(entityType);
    const clauses: Prisma.Sql[] = [Prisma.sql`tenant_id = (${tenantId})::uuid`];
    if (spec.deletedAtColumn) {
      clauses.push(Prisma.raw(`"${spec.deletedAtColumn}" IS NULL`));
    }

    for (const filter of filters) {
      const field = fields.find((item) => item.key === filter.field);
      if (!field) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Unknown field '${filter.field}' on ${entityType}`,
        );
      }
      if (!field.filterable) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `Field '${field.key}' is not filterable`);
      }
      const allowed: ReadonlySet<QueryOperator> =
        OPERATORS_BY_TYPE[field.type] ?? OPERATORS_BY_TYPE.text ?? new Set(['eq', 'is_null']);
      if (!allowed.has(filter.operator)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Operator '${filter.operator}' is not valid for ${field.type} field '${field.key}'`,
        );
      }
      clauses.push(filterClause(spec, field, filter));
    }

    return Prisma.join(clauses, ' AND ');
  }
}

function projectRow(row: Record<string, unknown>, fields: CatalogField[]): Record<string, unknown> {
  const custom = asRecord(row.custom_data ?? row.customData);
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.source === 'custom') {
      out[field.key] = custom[field.key] ?? null;
    } else {
      out[field.key] = serializeValue(row[field.key]);
    }
  }
  return out;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toNumber' in value) return decimalToNumber(value);
  return value ?? null;
}

function toJsonNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  return decimalToNumber(value);
}

function identifier(column: string): Prisma.Sql {
  return Prisma.raw(`"${column}"`);
}

function canonicalColumn(spec: ReturnType<typeof getEntitySpec>, field: CatalogField): Prisma.Sql {
  const column = spec.fields.find((item) => item.key === field.key)?.column;
  if (!column) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `Unknown canonical field '${field.key}'`);
  }
  return identifier(column);
}

function jsonText(fieldKey: string): Prisma.Sql {
  return Prisma.sql`(custom_data->>${fieldKey})`;
}

function numericExpr(spec: ReturnType<typeof getEntitySpec>, field: CatalogField): Prisma.Sql {
  if (field.source === 'canonical') {
    return canonicalColumn(spec, field);
  }
  return Prisma.sql`(CASE WHEN ${jsonText(field.key)} ~ ${NUMERIC_RE} THEN (${jsonText(field.key)})::numeric END)`;
}

function groupExprSql(spec: ReturnType<typeof getEntitySpec>, field: CatalogField): Prisma.Sql {
  if (field.source === 'canonical') return canonicalColumn(spec, field);
  return jsonText(field.key);
}

function filterClause(
  spec: ReturnType<typeof getEntitySpec>,
  field: CatalogField,
  filter: FilterInput,
): Prisma.Sql {
  const left =
    field.source === 'canonical' ? canonicalColumn(spec, field) : jsonText(field.key);

  if (filter.operator === 'is_null') {
    const shouldBeNull = filter.value !== false;
    return shouldBeNull ? Prisma.sql`${left} IS NULL` : Prisma.sql`${left} IS NOT NULL`;
  }

  if (filter.operator === 'in') {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Operator 'in' requires a non-empty array`);
    }
    const values = filter.value.map((item) => Prisma.sql`${String(item)}`);
    return Prisma.sql`${left} IN (${Prisma.join(values)})`;
  }

  if (filter.operator === 'contains') {
    if (typeof filter.value !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Operator 'contains' requires a string`);
    }
    const escaped = escapeIlike(filter.value);
    return Prisma.sql`${left} ILIKE ${`%${escaped}%`}`;
  }

  if (filter.value === undefined) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `Operator '${filter.operator}' requires a value`);
  }

  const comparable =
    field.type === 'number'
      ? field.source === 'canonical'
        ? left
        : numericExpr(spec, field)
      : left;
  const value =
    field.type === 'number'
      ? asNumber(filter.value, field.key)
      : field.type === 'boolean'
        ? field.source === 'custom'
          ? asBoolean(filter.value, field.key)
            ? 'true'
            : 'false'
          : asBoolean(filter.value, field.key)
        : field.source === 'canonical' && (field.type === 'datetime' || field.type === 'date')
          ? asDate(filter.value, field.key)
          : String(filter.value);

  const right =
    field.type === 'uuid' && field.source === 'canonical'
      ? Prisma.sql`(${String(filter.value)})::uuid`
      : Prisma.sql`${value}`;

  switch (filter.operator) {
    case 'eq':
      return Prisma.sql`${comparable} = ${right}`;
    case 'neq':
      return Prisma.sql`${comparable} <> ${right}`;
    case 'gt':
      return Prisma.sql`${comparable} > ${right}`;
    case 'gte':
      return Prisma.sql`${comparable} >= ${right}`;
    case 'lt':
      return Prisma.sql`${comparable} < ${right}`;
    case 'lte':
      return Prisma.sql`${comparable} <= ${right}`;
    default:
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Unsupported operator '${filter.operator}'`);
  }
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `Field '${field}' requires a number`);
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `Field '${field}' requires a boolean`);
  }
  return value;
}

function asDate(value: unknown, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `Field '${field}' requires an ISO date`);
  }
  return parsed;
}

function escapeIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
