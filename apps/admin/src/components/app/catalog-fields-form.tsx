'use client';

import type { CatalogField } from '@tactia/domain/data-sources/catalog';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';

export function CatalogFieldsForm({
  fields,
  values,
  onChange,
  idPrefix = '',
  fileAccept,
  onFileChange,
}: {
  fields: CatalogField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  idPrefix?: string;
  fileAccept?: string;
  onFileChange?: (key: string, file: File | null) => void;
}) {
  return (
    <>
      {fields.map((field) => {
        const id = `${idPrefix}${field.key}`;
        if (field.type === 'file') {
          return (
            <Field key={field.key} htmlFor={id} label={field.label} hint={field.hint}>
              <Input
                id={id}
                type="file"
                accept={fileAccept}
                required={field.required}
                onChange={(event) => onFileChange?.(field.key, event.target.files?.[0] ?? null)}
              />
            </Field>
          );
        }
        if (field.type === 'boolean') {
          return (
            <label key={field.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values[field.key] === 'true'}
                onChange={(event) => onChange(field.key, event.target.checked ? 'true' : '')}
              />
              {field.label}
            </label>
          );
        }
        if (field.type === 'json') {
          return (
            <Field key={field.key} htmlFor={id} label={field.label} hint={field.hint}>
              <Textarea
                id={id}
                required={field.required}
                placeholder={field.placeholder}
                value={values[field.key] ?? ''}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            </Field>
          );
        }
        if (field.type === 'select' || field.type === 'multiselect') {
          const selected = new Set((values[field.key] ?? '').split(',').filter(Boolean));
          return (
            <Field key={field.key} htmlFor={id} label={field.label} hint={field.hint}>
              <Select
                id={id}
                multiple={field.type === 'multiselect'}
                required={field.required}
                value={field.type === 'multiselect' ? [...selected] : values[field.key] ?? ''}
                onChange={(event) => {
                  const value = field.type === 'multiselect'
                    ? [...event.currentTarget.selectedOptions].map((option) => option.value).join(',')
                    : event.currentTarget.value;
                  onChange(field.key, value);
                }}
              >
                {field.type === 'select' ? <option value="">Selecione</option> : null}
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          );
        }
        return (
          <Field key={field.key} htmlFor={id} label={field.label} hint={field.hint}>
            <Input
              id={id}
              type={
                field.type === 'number'
                  ? 'number'
                  : field.type === 'time'
                    ? 'time'
                  : field.type === 'secret'
                    ? 'password'
                    : field.type === 'url'
                      ? 'url'
                      : 'text'
              }
              placeholder={field.placeholder}
              required={field.required}
              autoComplete={field.type === 'secret' ? 'off' : undefined}
              value={values[field.key] ?? ''}
              onChange={(event) => onChange(field.key, event.target.value)}
            />
          </Field>
        );
      })}
    </>
  );
}
