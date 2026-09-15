import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';
import { asJson } from '../json';

export type CreateCustomFieldDefinitionInput = {
  tenantId: string;
  entityType: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  description?: string | null;
  required?: boolean;
  config?: unknown;
};

export type UpdateCustomFieldDefinitionInput = {
  label?: string;
  fieldType?: string;
  description?: string | null;
  required?: boolean;
  config?: unknown;
};

export class CustomFieldDefinitionRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateCustomFieldDefinitionInput) {
    return this.db.customFieldDefinition.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        entityType: input.entityType,
        fieldKey: input.fieldKey,
        label: input.label,
        fieldType: input.fieldType,
        description: input.description ?? null,
        required: input.required ?? false,
        config: asJson(input.config ?? {}),
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.customFieldDefinition.findFirst({
      where: { id, tenantId },
    });
  }

  async findByKey({
    tenantId,
    entityType,
    fieldKey,
  }: {
    tenantId: string;
    entityType: string;
    fieldKey: string;
  }) {
    return this.db.customFieldDefinition.findFirst({
      where: { tenantId, entityType, fieldKey },
    });
  }

  async list({ tenantId, entityType }: { tenantId: string; entityType?: string }) {
    return this.db.customFieldDefinition.findMany({
      where: { tenantId, ...(entityType ? { entityType } : {}) },
      orderBy: [{ entityType: 'asc' }, { fieldKey: 'asc' }],
    });
  }

  async update({
    tenantId,
    id,
    data,
  }: {
    tenantId: string;
    id: string;
    data: UpdateCustomFieldDefinitionInput;
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.customFieldDefinition.update({
      where: { id },
      data: {
        label: data.label,
        fieldType: data.fieldType,
        description: data.description,
        required: data.required,
        ...(data.config !== undefined ? { config: asJson(data.config) } : {}),
      },
    });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.customFieldDefinition.delete({ where: { id } });
    return existing;
  }

  async countByEntity(tenantId: string): Promise<Array<{ entityType: string; count: number }>> {
    const grouped = await this.db.customFieldDefinition.groupBy({
      by: ['entityType'],
      where: { tenantId },
      _count: { _all: true },
    });
    return grouped.map((row) => ({ entityType: row.entityType, count: row._count._all }));
  }
}
