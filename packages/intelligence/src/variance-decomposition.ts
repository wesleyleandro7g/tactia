import { Prisma, type PrismaClient } from '@tactia/database';
import { formatDelta, formatMoney, formatPercent, joinNames } from './format';
import {
  type DecompositionDimension,
  type DimensionDrivers,
  type DriverContributor,
  type Drivers,
  type MetricPeriod,
  type PriceVolumeMix,
  periodIso,
} from './types';

/** Metrics whose change can be decomposed by dimension. */
export const DECOMPOSABLE_METRICS = [
  'revenue',
  'sales_count',
  'units_sold',
  'discount_total',
  'gross_margin',
] as const;
export type DecomposableMetric = (typeof DECOMPOSABLE_METRICS)[number];

export function isDecomposable(metric: string): metric is DecomposableMetric {
  return (DECOMPOSABLE_METRICS as readonly string[]).includes(metric);
}

export type DecomposeInput = {
  tenantId: string;
  metric: DecomposableMetric;
  period: MetricPeriod;
  /** Defaults to the previous period of the same duration. */
  comparePeriod?: MetricPeriod;
  /** Defaults to all supported dimensions. */
  dimensions?: DecompositionDimension[];
  /** Contributors listed per dimension. Default 5. */
  topN?: number;
  currency?: string;
};

type AggRow = { key: string | null; label: string | null; value: string; units: string };

const MONEY_METRICS = new Set<DecomposableMetric>(['revenue', 'discount_total', 'gross_margin']);

function previousPeriod(p: MetricPeriod): MetricPeriod {
  const duration = p.to.getTime() - p.from.getTime();
  return { from: new Date(p.from.getTime() - duration), to: new Date(p.to.getTime() - duration) };
}

/**
 * Sale-level dimensions (customer, seller) aggregate over `sales`; item-level
 * dimensions (product, category) aggregate over `sale_items` so a sale with
 * several products is split correctly.
 */
function usesItems(dimension: DecompositionDimension, metric: DecomposableMetric): boolean {
  return (
    dimension === 'product' ||
    dimension === 'category' ||
    metric === 'units_sold' ||
    metric === 'gross_margin'
  );
}

function measureSql(metric: DecomposableMetric, items: boolean): Prisma.Sql {
  if (items) {
    switch (metric) {
      case 'revenue':
        return Prisma.sql`COALESCE(SUM(si.total_amount), 0)`;
      case 'sales_count':
        return Prisma.sql`COUNT(DISTINCT si.sale_id)`;
      case 'units_sold':
        return Prisma.sql`COALESCE(SUM(si.quantity), 0)`;
      case 'discount_total':
        return Prisma.sql`COALESCE(SUM(si.discount_amount), 0)`;
      case 'gross_margin':
        return Prisma.sql`COALESCE(SUM(si.total_amount - si.quantity * COALESCE(p.cost, 0)), 0)`;
    }
  }
  switch (metric) {
    case 'revenue':
      return Prisma.sql`COALESCE(SUM(s.total_amount), 0)`;
    case 'sales_count':
      return Prisma.sql`COUNT(s.id)`;
    case 'discount_total':
      return Prisma.sql`COALESCE(SUM(s.discount_amount), 0)`;
    default:
      // units_sold / gross_margin always go through the items path
      return Prisma.sql`0`;
  }
}

function dimensionExprs(dimension: DecompositionDimension): {
  key: Prisma.Sql;
  label: Prisma.Sql;
  join: Prisma.Sql;
} {
  switch (dimension) {
    case 'product':
      return { key: Prisma.sql`p.id::text`, label: Prisma.sql`p.name`, join: Prisma.empty };
    case 'category':
      return {
        key: Prisma.sql`COALESCE(p.category, 'Sem categoria')`,
        label: Prisma.sql`COALESCE(p.category, 'Sem categoria')`,
        join: Prisma.empty,
      };
    case 'customer':
      return {
        key: Prisma.sql`c.id::text`,
        label: Prisma.sql`c.name`,
        join: Prisma.sql`INNER JOIN customers c ON c.id = s.customer_id`,
      };
    case 'seller':
      return {
        key: Prisma.sql`sel.id::text`,
        label: Prisma.sql`sel.name`,
        join: Prisma.sql`INNER JOIN sellers sel ON sel.id = s.seller_id`,
      };
    case 'channel':
      return {
        key: Prisma.sql`COALESCE(s.channel, 'Sem canal')`,
        label: Prisma.sql`COALESCE(s.channel, 'Sem canal')`,
        join: Prisma.empty,
      };
    case 'region':
      return {
        key: Prisma.sql`COALESCE(s.region, 'Sem região')`,
        label: Prisma.sql`COALESCE(s.region, 'Sem região')`,
        join: Prisma.empty,
      };
  }
}

async function aggregate(
  db: PrismaClient,
  tenantId: string,
  metric: DecomposableMetric,
  dimension: DecompositionDimension,
  period: MetricPeriod,
): Promise<AggRow[]> {
  const items = usesItems(dimension, metric);
  const measure = measureSql(metric, items);
  const { key, label, join } = dimensionExprs(dimension);

  if (items) {
    return db.$queryRaw<AggRow[]>(Prisma.sql`
      SELECT ${key} AS key, ${label} AS label,
             (${measure})::text AS value,
             COALESCE(SUM(si.quantity), 0)::text AS units
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      INNER JOIN products p ON p.id = si.product_id
      ${join}
      WHERE si.tenant_id = ${tenantId}::uuid
        AND s.status = 'confirmed'
        AND s.sold_at >= ${period.from}
        AND s.sold_at < ${period.to}
      GROUP BY 1, 2
    `);
  }

  return db.$queryRaw<AggRow[]>(Prisma.sql`
    SELECT ${key} AS key, ${label} AS label,
           (${measure})::text AS value,
           '0' AS units
    FROM sales s
    ${join}
    WHERE s.tenant_id = ${tenantId}::uuid
      AND s.status = 'confirmed'
      AND s.sold_at >= ${period.from}
      AND s.sold_at < ${period.to}
    GROUP BY 1, 2
  `);
}

type Bucket = { label: string; current: number; previous: number; currentUnits: number; previousUnits: number };

function merge(current: AggRow[], previous: AggRow[]): Map<string, Bucket> {
  const map = new Map<string, Bucket>();
  for (const row of current) {
    const key = row.key ?? 'unknown';
    map.set(key, {
      label: row.label ?? key,
      current: parseFloat(row.value),
      previous: 0,
      currentUnits: parseFloat(row.units),
      previousUnits: 0,
    });
  }
  for (const row of previous) {
    const key = row.key ?? 'unknown';
    const bucket = map.get(key) ?? {
      label: row.label ?? key,
      current: 0,
      previous: 0,
      currentUnits: 0,
      previousUnits: 0,
    };
    bucket.previous = parseFloat(row.value);
    bucket.previousUnits = parseFloat(row.units);
    map.set(key, bucket);
  }
  return map;
}

export function contributorsFrom(
  buckets: Map<string, Bucket>,
  totalDelta: number,
  topN: number,
): { contributors: DriverContributor[]; explainedShare: number } {
  const all: DriverContributor[] = [...buckets.entries()].map(([key, b]) => {
    const delta = b.current - b.previous;
    return {
      key,
      label: b.label,
      current: b.current,
      previous: b.previous,
      delta,
      share: totalDelta === 0 ? 0 : delta / totalDelta,
      status: b.previous === 0 ? 'new' : b.current === 0 ? 'lost' : 'changed',
    };
  });

  // Contributors that move in the same direction as the total explain it;
  // opposite movers are listed after (they partially offset the change).
  const sameSign = all
    .filter((c) => totalDelta === 0 || Math.sign(c.delta) === Math.sign(totalDelta))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const opposite = all
    .filter((c) => totalDelta !== 0 && c.delta !== 0 && Math.sign(c.delta) !== Math.sign(totalDelta))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const picked = [...sameSign.slice(0, topN), ...opposite.slice(0, Math.max(0, topN - 3))].filter(
    (c) => c.delta !== 0,
  );
  const explainedShare = sameSign.slice(0, topN).reduce((sum, c) => sum + c.share, 0);
  return { contributors: picked, explainedShare };
}

/**
 * Price × volume × mix for revenue, computed on per-product units and prices.
 *   volume  = Σ (q1 - q0) · p̄0            (at aggregate average price)
 *   mix     = Σ (q1 - q0) · (p0 - p̄0)     (shift toward cheaper/pricier products)
 *   price   = Σ q1 · (p1 - p0)
 * New products (q0 = 0) count as volume at their current price; lost products
 * as volume at their previous price.
 */
export function priceVolumeMix(buckets: Map<string, Bucket>): PriceVolumeMix {
  let currentUnits = 0;
  let previousUnits = 0;
  let currentRevenue = 0;
  let previousRevenue = 0;
  for (const b of buckets.values()) {
    currentUnits += b.currentUnits;
    previousUnits += b.previousUnits;
    currentRevenue += b.current;
    previousRevenue += b.previous;
  }
  const previousAvgPrice = previousUnits === 0 ? 0 : previousRevenue / previousUnits;
  const currentAvgPrice = currentUnits === 0 ? 0 : currentRevenue / currentUnits;

  let volumeEffect = 0;
  let mixEffect = 0;
  let priceEffect = 0;
  for (const b of buckets.values()) {
    const p0 = b.previousUnits === 0 ? null : b.previous / b.previousUnits;
    const p1 = b.currentUnits === 0 ? null : b.current / b.currentUnits;
    const dq = b.currentUnits - b.previousUnits;
    if (p0 == null && p1 == null) continue;
    if (p0 == null) {
      // new product: all of it is volume at its own price
      volumeEffect += dq * previousAvgPrice;
      mixEffect += dq * ((p1 ?? 0) - previousAvgPrice);
      continue;
    }
    volumeEffect += dq * previousAvgPrice;
    mixEffect += dq * (p0 - previousAvgPrice);
    if (p1 != null) priceEffect += b.currentUnits * (p1 - p0);
  }

  return {
    volumeEffect,
    priceEffect,
    mixEffect,
    currentUnits,
    previousUnits,
    currentAvgPrice,
    previousAvgPrice,
  };
}

const METRIC_LABEL: Record<DecomposableMetric, string> = {
  revenue: 'A receita',
  sales_count: 'O número de vendas',
  units_sold: 'As unidades vendidas',
  discount_total: 'Os descontos',
  gross_margin: 'A margem bruta',
};

const DIMENSION_LABEL: Record<DecompositionDimension, string> = {
  customer: 'clientes',
  product: 'produtos',
  seller: 'vendedores',
  category: 'categorias',
  channel: 'canais',
  region: 'regiões',
};

function fmt(metric: DecomposableMetric, value: number, currency: string): string {
  return MONEY_METRICS.has(metric)
    ? formatMoney(value, currency)
    : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

export function buildSummary(
  metric: DecomposableMetric,
  current: number,
  previous: number,
  byDimension: DimensionDrivers[],
  pvm: PriceVolumeMix | undefined,
  currency: string,
): string {
  const delta = current - previous;
  if (previous === 0 && current === 0) {
    return `${METRIC_LABEL[metric]} ficou em zero nos dois períodos.`;
  }
  const change = previous === 0 ? 1 : delta / previous;
  const verb = delta < 0 ? 'caiu' : delta > 0 ? 'cresceu' : 'ficou estável';
  const parts: string[] = [];
  parts.push(
    delta === 0
      ? `${METRIC_LABEL[metric]} ficou estável em ${fmt(metric, current, currency)}.`
      : `${METRIC_LABEL[metric]} ${verb} ${fmt(metric, Math.abs(delta), currency)} (${formatDelta(change)}): de ${fmt(metric, previous, currency)} para ${fmt(metric, current, currency)}.`,
  );

  // Pick the dimension that explains the most with the fewest contributors.
  const ranked = byDimension
    .filter((d) => d.contributors.length > 0)
    .sort((a, b) => b.explainedShare - a.explainedShare);
  for (const dim of ranked.slice(0, 2)) {
    const same = dim.contributors.filter((c) => Math.sign(c.delta) === Math.sign(delta)).slice(0, 3);
    if (same.length === 0) continue;
    const names = same.map((c) => {
      const tag = c.status === 'new' ? ' (novo)' : c.status === 'lost' ? ' (não comprou/vendeu)' : '';
      return `${c.label}${tag} (${delta < 0 ? '-' : '+'}${fmt(metric, Math.abs(c.delta), currency)}, ${formatPercent(Math.abs(c.share))})`;
    });
    parts.push(
      `Por ${DIMENSION_LABEL[dim.dimension]}, ${formatPercent(Math.min(1, Math.abs(dim.explainedShare)))} da variação vem de ${joinNames(names)}.`,
    );
  }

  if (pvm && metric === 'revenue' && (pvm.currentUnits > 0 || pvm.previousUnits > 0)) {
    const effects = [
      { label: 'volume', value: pvm.volumeEffect },
      { label: 'preço', value: pvm.priceEffect },
      { label: 'mix de produtos', value: pvm.mixEffect },
    ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const dominant = effects[0]!;
    parts.push(
      `Decomposição: efeito ${dominant.label} ${dominant.value < 0 ? '-' : '+'}${formatMoney(Math.abs(dominant.value), currency)} é o principal` +
        effects
          .slice(1)
          .map((e) => `; ${e.label} ${e.value < 0 ? '-' : '+'}${formatMoney(Math.abs(e.value), currency)}`)
          .join('') +
        '.',
    );
  }

  return parts.join(' ');
}

/**
 * Decompose the change of a metric between two periods into contributors per
 * dimension (+ price×volume×mix for revenue). Deterministic — the LLM only
 * narrates what comes out of here.
 */
export async function decomposeChange(db: PrismaClient, input: DecomposeInput): Promise<Drivers> {
  const comparePeriod = input.comparePeriod ?? previousPeriod(input.period);
  const dimensions = input.dimensions ?? ['customer', 'product', 'seller', 'category'];
  const topN = input.topN ?? 5;
  const currency = input.currency ?? 'BRL';

  const perDimension = await Promise.all(
    dimensions.map(async (dimension) => {
      const [current, previous] = await Promise.all([
        aggregate(db, input.tenantId, input.metric, dimension, input.period),
        aggregate(db, input.tenantId, input.metric, dimension, comparePeriod),
      ]);
      return { dimension, buckets: merge(current, previous) };
    }),
  );

  // Totals from the first dimension that has data (all agree on the total for
  // sale-level metrics; item-level totals exclude sales without items).
  const totalsFrom =
    perDimension.find((d) => !usesItems(d.dimension, input.metric)) ?? perDimension[0] ?? null;
  let current = 0;
  let previous = 0;
  if (totalsFrom) {
    for (const b of totalsFrom.buckets.values()) {
      current += b.current;
      previous += b.previous;
    }
  }
  const delta = current - previous;
  const change = previous === 0 ? (current === 0 ? 0 : 1) : delta / previous;

  const byDimension: DimensionDrivers[] = perDimension.map(({ dimension, buckets }) => {
    // Item-level dimensions may not sum to the sale-level total; use their own delta.
    let dimDelta = delta;
    if (usesItems(dimension, input.metric)) {
      dimDelta = 0;
      for (const b of buckets.values()) dimDelta += b.current - b.previous;
    }
    const { contributors, explainedShare } = contributorsFrom(buckets, dimDelta, topN);
    return { dimension, contributors, explainedShare };
  });

  const productBuckets = perDimension.find((d) => d.dimension === 'product')?.buckets;
  const pvm =
    input.metric === 'revenue' && productBuckets ? priceVolumeMix(productBuckets) : undefined;

  return {
    metric: input.metric,
    period: periodIso(input.period),
    comparisonPeriod: periodIso(comparePeriod),
    current,
    previous,
    delta,
    change,
    byDimension,
    ...(pvm ? { priceVolumeMix: pvm } : {}),
    summary: buildSummary(input.metric, current, previous, byDimension, pvm, currency),
  };
}
