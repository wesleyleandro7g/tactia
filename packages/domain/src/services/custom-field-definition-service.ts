import type { CustomFieldDefinitionRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertRole, assertTenantScope } from '../authz';
import { getEntitySpec } from '../data-catalog/canonical-fields';
import { isFlexibleEntityType } from '../data-catalog/types';
import { createCustomFieldSchema, updateCustomFieldSchema } from '../schemas/custom-fields';
import { AuditAction, type AuditLogService } from './audit-log-service';
import type { DataCatalogService } from './data-catalog-service';

export class CustomFieldDefinitionService {
  constructor(
    private readonly definitions: CustomFieldDefinitionRepository,
    private readonly auditLogs: AuditLogService,
    private readonly catalog?: DataCatalogService,
  ) {}

  async list(ctx: RequestContext, entityType?: string) {
    assertTenantScope(ctx);
    if (entityType && !isFlexibleEntityType(entityType)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Unknown entity type '${entityType}'`);
    }
    const items = await this.definitions.list({
      tenantId: ctx.tenantId,
      entityType,
    });
    return { items };
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertCanManageCustomFields(ctx);
    const input = createCustomFieldSchema.parse(raw);
    const spec = getEntitySpec(input.entityType);
    if (spec.fields.some((field) => field.key === input.fieldKey)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Field key '${input.fieldKey}' is reserved by the canonical ${input.entityType} model`,
      );
    }
    assertSelectOptions(input.fieldType, input.config);
    const existing = await this.definitions.findByKey({
      tenantId: ctx.tenantId,
      entityType: input.entityType,
      fieldKey: input.fieldKey,
    });
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, 'A field with this key already exists for the entity');
    }
    const row = await this.definitions.create({
      tenantId: ctx.tenantId,
      entityType: input.entityType,
      fieldKey: input.fieldKey,
      label: input.label,
      fieldType: input.fieldType,
      description: input.description,
      required: input.required,
      config: input.config ?? {},
    });
    this.catalog?.invalidate(ctx.tenantId);
    await this.auditLogs.record(ctx, {
      action: AuditAction.CUSTOM_FIELD_CREATED,
      entityType: 'custom_field_definition',
      entityId: row.id,
      metadata: { entityType: row.entityType, fieldKey: row.fieldKey, fieldType: row.fieldType },
    });
    return row;
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertCanManageCustomFields(ctx);
    const input = updateCustomFieldSchema.parse(raw);
    const current = await this.definitions.findById({ tenantId: ctx.tenantId, id });
    if (!current) throw new AppError(ErrorCode.NOT_FOUND, 'Custom field not found');
    const fieldType = input.fieldType ?? current.fieldType;
    const config = input.config ?? current.config;
    assertSelectOptions(fieldType, config);
    const row = await this.definitions.update({
      tenantId: ctx.tenantId,
      id,
      data: {
        label: input.label,
        fieldType: input.fieldType,
        description: input.description,
        required: input.required,
        config: input.config,
      },
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Custom field not found');
    this.catalog?.invalidate(ctx.tenantId);
    await this.auditLogs.record(ctx, {
      action: AuditAction.CUSTOM_FIELD_UPDATED,
      entityType: 'custom_field_definition',
      entityId: id,
      metadata: { ...input },
    });
    return row;
  }

  async remove(ctx: RequestContext, id: string) {
    assertCanManageCustomFields(ctx);
    const row = await this.definitions.delete({ tenantId: ctx.tenantId, id });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Custom field not found');
    this.catalog?.invalidate(ctx.tenantId);
    await this.auditLogs.record(ctx, {
      action: AuditAction.CUSTOM_FIELD_DELETED,
      entityType: 'custom_field_definition',
      entityId: id,
      metadata: { entityType: row.entityType, fieldKey: row.fieldKey },
    });
    return row;
  }
}

function assertCanManageCustomFields(
  ctx: RequestContext,
): asserts ctx is RequestContext & { tenantId: string } {
  if (ctx.operatorId && ctx.tenantId) return;
  assertRole(ctx, 'admin');
}

function assertSelectOptions(fieldType: string, config: unknown) {
  if (fieldType !== 'select' && fieldType !== 'multiselect') return;
  const options =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as { options?: unknown }).options
      : undefined;
  if (!Array.isArray(options) || options.length === 0) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Select fields require config.options with at least one value',
    );
  }
}
