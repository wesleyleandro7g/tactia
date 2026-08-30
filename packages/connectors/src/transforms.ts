import type { FieldTransform } from './types.js';

export function applyTransform(value: unknown, transform: FieldTransform | undefined): unknown {
  if (transform === undefined || transform === 'none') return value;

  const str = String(value ?? '').trim();

  switch (transform) {
    case 'trim':
      return str;
    case 'number':
      return str === '' ? null : parseFloat(str.replace(/[^\d.,\-]/g, '').replace(',', '.'));
    case 'currency':
      return str === '' ? null : parseFloat(str.replace(/[^\d.,\-]/g, '').replace(',', '.'));
    case 'date': {
      if (str === '') return null;
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    default:
      return value;
  }
}
