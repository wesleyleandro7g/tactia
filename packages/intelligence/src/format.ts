/**
 * Deterministic pt-BR formatting used in insight titles, descriptions and
 * driver summaries. Kept here (not in the web app) because the text is
 * persisted with the insight and must not depend on the UI.
 */

export function formatMoney(value: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

/** 0.153 → "15%" ; -0.4 → "-40%" */
export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits).replace('.', ',')}%`;
}

/** 0.153 → "+15%" ; -0.4 → "-40%" */
export function formatDelta(fraction: number, digits = 0): string {
  const sign = fraction > 0 ? '+' : '';
  return `${sign}${formatPercent(fraction, digits)}`;
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** "A, B e C" */
export function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}
