import type { FieldMapping, SyncMode } from './types';

/** Cadastros: o sync incremental lê a tabela inteira e só grava o que mudou. */
export const DIMENSION_ENTITY_TYPES = new Set(['customer', 'product', 'seller', 'lead']);

/**
 * Fatos: coluna canônica cuja origem vira o `WHERE` da janela (primeiro hit ganha).
 */
export const FACT_DATE_TARGETS: Record<string, readonly string[]> = {
  sale: ['sold_at'],
  payment: ['paid_at', 'due_at'],
  interaction: ['occurred_at'],
  activity: ['occurred_at'],
  expense: ['occurred_at'],
  inventory_level: ['recorded_at'],
  campaign: ['starts_at', 'ends_at'],
};

export const INCREMENTAL_LOOKBACK_MONTHS = 3;

export type IncrementalFetchDecision =
  | { fetch: true; dateColumn?: string }
  | { fetch: false; reason: 'incremental_missing_date_column' };

export function isFactEntity(entityType: string): boolean {
  return Object.prototype.hasOwnProperty.call(FACT_DATE_TARGETS, entityType);
}

export function incrementalDateColumn(
  targetEntity: string,
  fields: FieldMapping[] | undefined,
): string | null {
  const targets = FACT_DATE_TARGETS[targetEntity];
  if (!targets) return null;
  for (const target of targets) {
    const field = fields?.find((item) => item.target === target);
    if (field?.source) return field.source;
  }
  return null;
}

/**
 * Incremental: cadastros (e entidades desconhecidas) sem filtro de data;
 * fatos exigem uma coluna de data mapeada.
 */
export function incrementalFetchDecision(
  mode: SyncMode | undefined,
  targetEntity: string,
  fields: FieldMapping[] | undefined,
): IncrementalFetchDecision {
  if (mode !== 'incremental') return { fetch: true };
  if (!isFactEntity(targetEntity)) return { fetch: true };
  const dateColumn = incrementalDateColumn(targetEntity, fields);
  if (!dateColumn) return { fetch: false, reason: 'incremental_missing_date_column' };
  return { fetch: true, dateColumn };
}

/** Meia-noite UTC da data civil no fuso, menos `months` meses. */
export function incrementalLookbackSince(
  now: Date,
  timeZone = 'America/Sao_Paulo',
  months = INCREMENTAL_LOOKBACK_MONTHS,
): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [year, month, day] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(year!, month! - 1, day));
  utc.setUTCMonth(utc.getUTCMonth() - months);
  return utc;
}
