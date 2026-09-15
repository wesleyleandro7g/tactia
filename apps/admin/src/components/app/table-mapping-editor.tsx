'use client';

import { useMemo } from 'react';
import {
  TARGET_ENTITIES,
  guessMapping,
  targetFieldsFor,
  type MappingField,
  type TargetEntity,
} from '@tactia/domain/data-sources/import-mapping';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { DataTable } from '@/components/ui/data-table';

export type DiscoveryColumn = { name: string; type: string; nullable: boolean };
export type DiscoveryResource = { name: string; columns: DiscoveryColumn[] };

export type DraftMapping = {
  sourceEntity: string;
  targetEntity: TargetEntity;
  fields: Array<{ source: string; target: string }>;
};

export function fieldsFromMap(fieldMap: Record<string, string>): Array<{ source: string; target: string }> {
  return Object.entries(fieldMap)
    .filter(([, target]) => target)
    .map(([source, target]) => ({ source, target }));
}

export function TableMappingEditor({
  resources,
  sourceEntity,
  targetEntity,
  fieldMap,
  extraFields = [],
  onSourceEntityChange,
  onTargetEntityChange,
  onFieldMapChange,
}: {
  resources: DiscoveryResource[];
  sourceEntity: string;
  targetEntity: TargetEntity;
  fieldMap: Record<string, string>;
  extraFields?: MappingField[];
  onSourceEntityChange: (sourceEntity: string, fieldMap: Record<string, string>) => void;
  onTargetEntityChange: (targetEntity: TargetEntity, fieldMap: Record<string, string>) => void;
  onFieldMapChange: (fieldMap: Record<string, string>) => void;
}) {
  const selected = useMemo(
    () => resources.find((resource) => resource.name === sourceEntity) ?? null,
    [resources, sourceEntity],
  );
  const targetFields = targetFieldsFor(targetEntity, extraFields);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <Field htmlFor="source-entity" label="Recurso de origem">
          {resources.length > 0 ? (
            <Select
              id="source-entity"
              value={sourceEntity}
              onChange={(event) => {
                const next = event.target.value;
                const resource = resources.find((item) => item.name === next);
                onSourceEntityChange(next, resource ? guessMapping(resource.columns, targetEntity, extraFields) : {});
              }}
            >
              {resources.map((resource) => (
                <option key={resource.name} value={resource.name}>
                  {resource.name}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id="source-entity"
              value={sourceEntity}
              onChange={(event) => onSourceEntityChange(event.target.value, fieldMap)}
              placeholder="data ou nome da tabela"
            />
          )}
        </Field>
        <Field htmlFor="target-entity" label="Entidade Tactia">
          <Select
            id="target-entity"
            value={targetEntity}
            onChange={(event) => {
              const next = event.target.value as TargetEntity;
              onTargetEntityChange(next, selected ? guessMapping(selected.columns, next, extraFields) : fieldMap);
            }}
          >
            {TARGET_ENTITIES.map((entity) => (
              <option key={entity.value} value={entity.value}>
                {entity.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {selected ? (
        <DataTable
          caption="Colunas"
          columns={[
            { key: 'source', header: 'Origem', render: (row: DiscoveryColumn) => row.name },
            {
              key: 'target',
              header: 'Destino',
              render: (row) => (
                <Select
                  aria-label={`Destino de ${row.name}`}
                  value={fieldMap[row.name] ?? ''}
                  onChange={(event) =>
                    onFieldMapChange({ ...fieldMap, [row.name]: event.target.value })
                  }
                >
                  {targetFields.map((field) => (
                    <option key={field.value || 'ignore'} value={field.value}>
                      {field.label}
                    </option>
                  ))}
                </Select>
              ),
            },
          ]}
          rows={selected.columns}
          rowKey={(row) => row.name}
        />
      ) : null}
    </div>
  );
}
