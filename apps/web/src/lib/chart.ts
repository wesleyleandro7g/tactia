/**
 * Geometria dos gráficos de tendência.
 *
 * Funções puras (sem React, sem DOM) para poderem ser testadas e usadas em RSC.
 * O gráfico é SVG próprio: a V0.1 precisa de duas séries simples, não de um BI.
 */

export type ChartPoint = { key: string; value: number };

export type ChartGeometry = {
  /** Coordenadas em unidades do viewBox. */
  coords: Array<{ x: number; y: number; point: ChartPoint }>;
  linePath: string;
  areaPath: string;
  min: number;
  max: number;
  total: number;
};

export type ChartOptions = {
  width?: number;
  height?: number;
  padding?: number;
};

/**
 * Escala os pontos para o viewBox. Séries constantes (min === max) ficam na
 * linha do meio em vez de dividirem por zero.
 */
export function buildChartGeometry(
  points: ChartPoint[],
  { width = 640, height = 180, padding = 8 }: ChartOptions = {},
): ChartGeometry {
  const values = points.map((point) => point.value);
  const max = values.length > 0 ? Math.max(...values) : 0;
  const min = values.length > 0 ? Math.min(...values) : 0;
  const total = values.reduce((sum, value) => sum + value, 0);

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const span = max - min;

  const coords = points.map((point, index) => {
    const x =
      points.length === 1 ? width / 2 : padding + (innerWidth * index) / (points.length - 1);
    const ratio = span === 0 ? 0.5 : (point.value - min) / span;
    const y = padding + innerHeight * (1 - ratio);
    return { x, y, point };
  });

  const linePath = coords
    .map((coord, index) => `${index === 0 ? 'M' : 'L'}${round(coord.x)},${round(coord.y)}`)
    .join(' ');

  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPath =
    coords.length > 1 && first && last
      ? `${linePath} L${round(last.x)},${height - padding} L${round(first.x)},${height - padding} Z`
      : '';

  return { coords, linePath, areaPath, min, max, total };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export type NamedChartItem = {
  key: string;
  label: string;
  value: number;
};

export function toNamedItems(
  items: Array<{ key: string; label?: string; value: number }>,
): NamedChartItem[] {
  return items.map((item) => ({
    key: item.key,
    label: item.label?.trim() || item.key,
    value: item.value,
  }));
}

/** Mantém os N maiores e agrupa o restante em “Outros”. */
export function topNWithOthers(items: NamedChartItem[], n: number): NamedChartItem[] {
  const ranked = [...items].sort((a, b) => b.value - a.value);
  if (ranked.length <= n) return ranked;
  const head = ranked.slice(0, n);
  const rest = ranked.slice(n);
  const othersValue = rest.reduce((sum, item) => sum + item.value, 0);
  if (othersValue <= 0) return head;
  return [...head, { key: '__others__', label: 'Outros', value: othersValue }];
}

export type OverlayPoint = {
  key: string;
  current: number;
  previous: number | null;
};

/** Alinha a série anterior no eixo do período atual, deslocando pela duração. */
export function overlayTimeSeries(
  current: ChartPoint[],
  previous: ChartPoint[],
  shiftMs: number,
): OverlayPoint[] {
  const previousByDay = new Map<string, number>();
  for (const point of previous) {
    const shifted = new Date(new Date(point.key).getTime() + shiftMs);
    if (Number.isNaN(shifted.getTime())) continue;
    previousByDay.set(shifted.toISOString().slice(0, 10), point.value);
  }

  return current.map((point) => {
    const day = new Date(point.key);
    const dayKey = Number.isNaN(day.getTime()) ? point.key.slice(0, 10) : day.toISOString().slice(0, 10);
    return {
      key: point.key,
      current: point.value,
      previous: previousByDay.get(dayKey) ?? null,
    };
  });
}
