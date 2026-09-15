'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CUSTOM_FIELD_TYPES, FLEXIBLE_ENTITY_TYPES } from '@tactia/domain/data-catalog/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { opsJson } from '@/lib/ops-fetch';

const ENTITY_LABELS: Record<string, string> = {
  customer: 'Clientes',
  product: 'Produtos',
  sale: 'Vendas',
  sale_item: 'Itens de venda',
};

const TYPE_LABELS: Record<string, string> = {
  text: 'Texto',
  number: 'Número',
  boolean: 'Sim/Não',
  date: 'Data',
  datetime: 'Data e hora',
  select: 'Seleção',
  multiselect: 'Seleção múltipla',
  object: 'Objeto',
  array: 'Lista',
};

export type CustomFieldRow = {
  id: string;
  entityType: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  required: boolean;
  description: string | null;
};

export function CustomFieldsPanel({
  tenantId,
  fields,
}: {
  tenantId: string;
  fields: CustomFieldRow[];
}) {
  const router = useRouter();
  const [entityType, setEntityType] = useState<(typeof FLEXIBLE_ENTITY_TYPES)[number]>('customer');
  const [fieldKey, setFieldKey] = useState('');
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<(typeof CUSTOM_FIELD_TYPES)[number]>('text');
  const [description, setDescription] = useState('');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsOptions = fieldType === 'select' || fieldType === 'multiselect';

  async function createField() {
    setPending(true);
    setError(null);
    try {
      const config =
        needsOptions
          ? {
              options: options
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            }
          : {};
      await opsJson(`/api/v1/tenants/${tenantId}/custom-fields`, {
        body: {
          entityType,
          fieldKey: fieldKey.trim(),
          label: label.trim(),
          fieldType,
          description: description.trim() || null,
          required,
          config,
        },
      });
      setFieldKey('');
      setLabel('');
      setDescription('');
      setOptions('');
      setRequired(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar campo');
    } finally {
      setPending(false);
    }
  }

  async function removeField(id: string) {
    setPending(true);
    setError(null);
    try {
      await opsJson(`/api/v1/tenants/${tenantId}/custom-fields/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover campo');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
        Campos customizados
      </h2>
      <p className="text-sm text-muted-foreground">
        Atributos específicos deste cliente, consultáveis pelo agente sem alterar o schema.
      </p>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void createField();
        }}
      >
        <Field htmlFor="cf-entity" label="Entidade">
          <Select
            id="cf-entity"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value as typeof entityType)}
          >
            {FLEXIBLE_ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {ENTITY_LABELS[type] ?? type}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="cf-type" label="Tipo">
          <Select
            id="cf-type"
            value={fieldType}
            onChange={(event) => setFieldType(event.target.value as typeof fieldType)}
          >
            {CUSTOM_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type] ?? type}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="cf-key" label="Chave" hint="snake_case, única por entidade">
          <Input
            id="cf-key"
            value={fieldKey}
            onChange={(event) => setFieldKey(event.target.value)}
            placeholder="estimated_hours"
            required
          />
        </Field>
        <Field htmlFor="cf-label" label="Rótulo">
          <Input
            id="cf-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Horas estimadas"
            required
          />
        </Field>
        <Field htmlFor="cf-description" label="Descrição" className="md:col-span-2">
          <Input
            id="cf-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Opcional — o agente usa isto para interpretar o campo"
          />
        </Field>
        {needsOptions ? (
          <Field htmlFor="cf-options" label="Opções" hint="Uma por linha" className="md:col-span-2">
            <Textarea
              id="cf-options"
              value={options}
              onChange={(event) => setOptions(event.target.value)}
              required
            />
          </Field>
        ) : null}
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={required}
            onChange={(event) => setRequired(event.target.checked)}
          />
          Obrigatório
        </label>
        <div>
          <Button type="submit" loading={pending}>
            Adicionar campo
          </Button>
        </div>
      </form>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <DataTable
        caption="Campos customizados"
        columns={[
          {
            key: 'entity',
            header: 'Entidade',
            render: (row: CustomFieldRow) => ENTITY_LABELS[row.entityType] ?? row.entityType,
          },
          { key: 'key', header: 'Chave', render: (row) => row.fieldKey },
          { key: 'label', header: 'Rótulo', render: (row) => row.label },
          {
            key: 'type',
            header: 'Tipo',
            render: (row) => TYPE_LABELS[row.fieldType] ?? row.fieldType,
          },
          {
            key: 'required',
            header: 'Obrigatório',
            render: (row) => (row.required ? 'sim' : 'não'),
          },
          {
            key: 'actions',
            header: 'Ações',
            render: (row) => (
              <Button
                size="sm"
                variant="danger"
                loading={pending}
                onClick={() => void removeField(row.id)}
              >
                Remover
              </Button>
            ),
          },
        ]}
        rows={fields}
        rowKey={(row) => row.id}
        emptyLabel="Nenhum campo customizado."
      />
    </section>
  );
}
