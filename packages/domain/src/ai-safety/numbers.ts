/**
 * Shared numeric claim extraction (briefing + chat guardrails).
 *
 * Tokens like "1.234", "R$ 12.500", "15%", "42". The thousands-separator
 * alternative requires at least one `.000` group so a plain `1500` is one
 * token (the second alternative), not `150` + `0`. Dates with hyphens
 * (`2026-09-01`) are not a single token; hex IDs do not match.
 */

/** Days of the month / short prose counts — same bound the briefing uses. */
export const PROSE_SMALL_INT_MAX = 31;

const NUMBER_TOKEN =
  /(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})+(?:,\d+)?%?|(?:R\$\s*)?-?\d+(?:,\d+)?%?/g;

export function extractNumberTokens(text: string): string[] {
  return text.match(NUMBER_TOKEN) ?? [];
}

/** Canonical digit string, ignoring thousand separators and currency. Percent kept as integer points. */
export function canonicalizeNumber(token: string): string {
  const raw = token.replace(/R\$\s*/g, '').trim();
  const isPercent = raw.endsWith('%');
  const body = raw.replace(/%$/, '').replace(/\./g, '').replace(',', '.');
  const value = Number(body);
  if (!Number.isFinite(value)) return '';
  if (isPercent) return `p:${Math.round(value)}`;
  return `n:${Math.round(value)}`;
}

export function collectAllowedFromValues(values: number[], formatted?: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    allowed.add(`n:${Math.round(value)}`);
  }
  if (formatted) {
    for (const text of formatted) {
      const direct = canonicalizeNumber(text);
      if (direct) allowed.add(direct);
      for (const token of extractNumberTokens(text)) {
        const key = canonicalizeNumber(token);
        if (key) allowed.add(key);
      }
    }
  }
  return allowed;
}

export function allowProseSmallInts(allowed: Set<string>): Set<string> {
  for (let n = 0; n <= PROSE_SMALL_INT_MAX; n++) allowed.add(`n:${n}`);
  return allowed;
}

export function unsourcedNumbers(content: string, allowed: Set<string>): string[] {
  const offenders: string[] = [];
  for (const token of extractNumberTokens(content)) {
    const key = canonicalizeNumber(token);
    if (!key) continue;
    if (!allowed.has(key)) offenders.push(token);
  }
  return [...new Set(offenders)];
}

export type NumberMetricLike = {
  value: number;
  change?: number;
  previous?: number;
};

export type NumberSourceLike = {
  value?: number;
  label?: string;
  excerpt?: string;
};

/** Allowlist for chat `claim_mismatch`: context metrics + cited sources, plus prose small ints. */
export function buildClaimAllowlist(
  metrics: NumberMetricLike[],
  sources: NumberSourceLike[],
): Set<string> {
  const values: number[] = [];
  const formatted: string[] = [];

  for (const metric of metrics) {
    values.push(metric.value);
    if (metric.previous != null) values.push(metric.previous);
    if (metric.change != null) {
      values.push(Math.abs(metric.change) * 100);
      formatted.push(`${Math.round(Math.abs(metric.change) * 100)}%`);
    }
  }
  for (const source of sources) {
    if (source.value != null) values.push(source.value);
    if (source.label) formatted.push(source.label);
    if (source.excerpt) formatted.push(source.excerpt);
  }

  return allowProseSmallInts(collectAllowedFromValues(values, formatted));
}
