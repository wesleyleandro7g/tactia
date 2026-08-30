import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buildChartGeometry, type ChartPoint } from '@/lib/chart';
import { formatCurrency, formatDayMonth, formatInteger } from '@/lib/format';

export type TrendChartProps = {
  title: string;
  description?: string;
  points: ChartPoint[];
  format: 'currency' | 'integer';
};

const WIDTH = 640;
const HEIGHT = 180;

/**
 * Série temporal em SVG próprio (sem dependência de biblioteca de gráficos).
 *
 * O dado nunca fica só no desenho: há `aria-label` com o resumo e uma tabela
 * `sr-only` com todos os pontos, então leitor de tela e ctrl+F alcançam tudo.
 */
export function TrendChart({ title, description, points, format }: TrendChartProps) {
  const formatValue = (value: number) =>
    format === 'currency' ? formatCurrency(value) : formatInteger(value);

  if (points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
        </CardHeader>
        <p className="py-10 text-center text-sm text-muted">Sem vendas no período.</p>
      </Card>
    );
  }

  const geometry = buildChartGeometry(points, { width: WIDTH, height: HEIGHT });
  const summary =
    points.length === 1
      ? `${title}: ${formatValue(points[0]!.value)} em ${formatDayMonth(points[0]!.key)}.`
      : `${title} de ${formatDayMonth(points[0]!.key)} a ${formatDayMonth(points[points.length - 1]!.key)}. ` +
        `Total ${formatValue(geometry.total)}, mínimo ${formatValue(geometry.min)}, máximo ${formatValue(geometry.max)}.`;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <p className="tabular text-sm text-muted">{formatValue(geometry.total)}</p>
      </CardHeader>

      {points.length === 1 ? (
        <p className="py-8 text-center text-sm text-muted">
          Apenas um dia com dados — sem tendência para exibir.
        </p>
      ) : (
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-[180px] w-full"
        >
          <path d={geometry.areaPath} fill="var(--accent-soft)" />
          <path
            d={geometry.linePath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}

      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>{formatDayMonth(points[0]!.key)}</span>
        <span>{formatDayMonth(points[points.length - 1]!.key)}</span>
      </div>

      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">{title}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <td>{formatDayMonth(point.key)}</td>
              <td>{formatValue(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
