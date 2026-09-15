/** Geometry helpers for Satori SVG charts (pie / line / bars). */

export type PolarPoint = { x: number; y: number };

export function polar(cx: number, cy: number, r: number, angleRad: number): PolarPoint {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

/** Donut slice path from startAngle → endAngle (radians, 0 = east, clockwise-friendly via +). */
export function donutSlicePath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const o1 = polar(cx, cy, outerR, startAngle);
  const o2 = polar(cx, cy, outerR, endAngle);
  const i1 = polar(cx, cy, innerR, endAngle);
  const i2 = polar(cx, cy, innerR, startAngle);

  return [
    `M ${o1.x} ${o1.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${o2.x} ${o2.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${i2.x} ${i2.y}`,
    'Z',
  ].join(' ');
}

export function normalizeShares(
  items: Array<{ share?: number; numeric?: number }>,
): number[] {
  const fromShare = items.map((item) => item.share);
  if (fromShare.every((s): s is number => typeof s === 'number' && s > 0)) {
    const sum = fromShare.reduce((a, b) => a + b, 0) || 1;
    return fromShare.map((s) => s / sum);
  }

  const nums = items.map((item) => Math.max(0, item.numeric ?? 0));
  const sum = nums.reduce((a, b) => a + b, 0);
  if (sum > 0) return nums.map((n) => n / sum);

  const equal = 1 / items.length;
  return items.map(() => equal);
}

export type LineLayout = {
  width: number;
  height: number;
  padX: number;
  padTop: number;
  padBottom: number;
  points: Array<{ x: number; y: number; label: string; value: string; numeric: number }>;
  min: number;
  max: number;
  linePath: string;
  areaPath: string;
};

export function layoutLineChart(
  series: Array<{ label: string; value: string; numeric: number }>,
  width: number,
  height: number,
): LineLayout {
  const padX = 28;
  const padTop = 28;
  const padBottom = 48;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;

  const values = series.map((p) => p.numeric);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min = min - Math.abs(min || 1) * 0.1;
    max = max + Math.abs(max || 1) * 0.1;
  }
  const span = max - min || 1;

  const points = series.map((p, i) => {
    const t = series.length === 1 ? 0.5 : i / (series.length - 1);
    const x = padX + t * plotW;
    const y = padTop + (1 - (p.numeric - min) / span) * plotH;
    return { x, y, label: p.label, value: p.value, numeric: p.numeric };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  const baseline = padTop + plotH;
  const areaPath =
    points.length > 0
      ? [
          `M ${points[0]!.x.toFixed(1)} ${baseline}`,
          ...points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`),
          `L ${points[points.length - 1]!.x.toFixed(1)} ${baseline}`,
          'Z',
        ].join(' ')
      : '';

  return { width, height, padX, padTop, padBottom, points, min, max, linePath, areaPath };
}

export function formatAxisNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}
