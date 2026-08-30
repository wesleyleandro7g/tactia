/** Convert Prisma Decimal / numeric values into plain JSON-friendly numbers. */
export function decimalToNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

export function mapMoneyFields<T extends Record<string, unknown>>(
  row: T,
  fields: readonly string[],
): T {
  const out: Record<string, unknown> = { ...row };
  for (const field of fields) {
    if (field in out && out[field] != null) {
      out[field] = decimalToNumber(out[field]);
    }
  }
  return out as T;
}
