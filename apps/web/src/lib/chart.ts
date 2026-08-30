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
