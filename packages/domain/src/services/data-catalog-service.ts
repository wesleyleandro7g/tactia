import type { CustomFieldDefinitionRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertTenantContext } from '../authz';
import { getEntitySpec, listEntitySpecs } from '../data-catalog/canonical-fields';
import {
  asRecord,
  isFlexibleEntityType,
  type CatalogEntity,
  type CatalogField,
  type FlexibleEntityType,
} from '../data-catalog/types';
import { catalogQuerySchema } from '../schemas/custom-fields';

type CacheEntry = { expiresAt: number; value: CatalogEntity[] };

const CACHE_TTL_MS = 30_000;

export class DataCatalogService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly definitions: CustomFieldDefinitionRepository) {}

  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  async getCatalog(ctx: RequestContext, query: { entityType?: string } = {}): Promise<{
    entities: CatalogEntity[];
  }> {
    assertTenantContext(ctx);
    const parsed = catalogQuerySchema.parse(query);
    const entities = await this.forTenant(ctx.tenantId, parsed.entityType);
    return { entities };
  }

  async forTenant(tenantId: string, entityType?: FlexibleEntityType): Promise<CatalogEntity[]> {
    const cached = this.cache.get(tenantId);
    const all =
      cached && cached.expiresAt > Date.now()
        ? cached.value
        : await this.load(tenantId);
    if (!cached || cached.expiresAt <= Date.now()) {
      this.cache.set(tenantId, { expiresAt: Date.now() + CACHE_TTL_MS, value: all });
    }
    if (!entityType) return all;
    return all.filter((entity) => entity.entityType === entityType);
  }

  async summarize(tenantId: string): Promise<{
    total: number;
    byEntity: Array<{ entityType: string; label: string; count: number; keys: string[] }>;
  }> {
    const entities = await this.forTenant(tenantId);
    const byEntity = entities
      .map((entity) => {
        const custom = entity.fields.filter((field) => field.source === 'custom');
        return {
          entityType: entity.entityType,
          label: entity.label,
          count: custom.length,
          keys: custom.map((field) => field.key),
        };
      })
      .filter((row) => row.count > 0);
    return {
      total: byEntity.reduce((sum, row) => sum + row.count, 0),
      byEntity,
    };
  }

  async requireEntity(tenantId: string, entityType: string): Promise<CatalogEntity> {
    if (!isFlexibleEntityType(entityType)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Unknown entity type '${entityType}'`);
    }
    const [entity] = await this.forTenant(tenantId, entityType);
    if (!entity) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Unknown entity type '${entityType}'`);
    }
    return entity;
  }

  async requireField(tenantId: string, entityType: string, fieldKey: string): Promise<CatalogField> {
    const entity = await this.requireEntity(tenantId, entityType);
    const field = entity.fields.find((item) => item.key === fieldKey);
    if (!field) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Unknown field '${fieldKey}' on ${entityType}`);
    }
    return field;
  }

  private async load(tenantId: string): Promise<CatalogEntity[]> {
    const defs = await this.definitions.list({ tenantId });
    return listEntitySpecs().map((spec) => {
      const canonical: CatalogField[] = spec.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        source: 'canonical',
        description: field.description ?? null,
        filterable: field.filterable,
        aggregatable: field.aggregatable,
      }));
      const custom: CatalogField[] = defs
        .filter((row) => row.entityType === spec.entityType)
        .map((row) => {
          const config = asRecord(row.config);
          const options = Array.isArray(config.options)
            ? config.options.filter((item): item is string => typeof item === 'string')
            : undefined;
          return {
            key: row.fieldKey,
            label: row.label,
            type: row.fieldType,
            source: 'custom' as const,
            description: row.description,
            filterable: row.fieldType !== 'object' && row.fieldType !== 'array',
            aggregatable: row.fieldType === 'number',
            required: row.required,
            unit: typeof config.unit === 'string' ? config.unit : undefined,
            options,
          };
        });
      return {
        entityType: spec.entityType,
        label: spec.label,
        fields: [...canonical, ...custom],
      };
    });
  }
}

export function getEntityTable(entityType: FlexibleEntityType) {
  return getEntitySpec(entityType);
}
