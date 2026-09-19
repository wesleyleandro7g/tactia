import {
  donutSlicePath,
  formatAxisNumber,
  layoutLineChart,
  normalizeShares,
} from './charts';
import type { InfographicSpec } from './schema';
import { LOGO_DISPLAY, loadBrandLogoDataUrl } from './logo';
import {
  THEMES,
  deltaColor,
  deltaSoft,
  formatDelta,
  type ThemePalette,
} from './tokens';

type NodeProps = Record<string, unknown> & {
  style?: Record<string, string | number | undefined>;
  children?: string | Node | Array<string | Node | null | undefined | false>;
};

type Node = {
  type: string;
  props: NodeProps;
};

function el(
  type: string,
  style: Record<string, string | number | undefined>,
  children?: NodeProps['children'],
  extra?: Record<string, string | number | boolean | undefined>,
): Node {
  const cleaned = Array.isArray(children)
    ? children.filter((child): child is string | Node => Boolean(child))
    : children;
  return {
    type,
    props: {
      style,
      ...(extra ?? {}),
      ...(cleaned !== undefined ? { children: cleaned } : {}),
    },
  };
}

/** SVG/XML element without a CSS style bag (Satori path/circle/etc.). */
function svgEl(
  type: string,
  attrs: Record<string, string | number | boolean | undefined>,
  children?: NodeProps['children'],
): Node {
  const cleaned = Array.isArray(children)
    ? children.filter((child): child is string | Node => Boolean(child))
    : children;
  return {
    type,
    props: {
      ...attrs,
      ...(cleaned !== undefined ? { children: cleaned } : {}),
    },
  };
}

function BrandMark({ logoSrc }: { logoSrc: string }): Node {
  return el(
    'img',
    {
      width: LOGO_DISPLAY.width,
      height: LOGO_DISPLAY.height,
      objectFit: 'contain',
    },
    undefined,
    { src: logoSrc },
  );
}

function Kicker({ label, theme }: { label: string; theme: ThemePalette }): Node {
  return el(
    'div',
    {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    },
    [
      el('div', {
        width: 28,
        height: 3,
        borderRadius: 999,
        backgroundImage: `linear-gradient(90deg, ${theme.brandFrom}, ${theme.brandTo})`,
      }),
      el(
        'div',
        {
          fontFamily: 'IBM Plex Sans',
          fontSize: 16,
          fontWeight: 600,
          color: theme.primary,
          textTransform: 'uppercase',
          letterSpacing: 3,
        },
        label,
      ),
    ],
  );
}

function DeltaPill({
  delta,
  theme,
  size = 'md',
}: {
  delta: number | null | undefined;
  theme: ThemePalette;
  size?: 'sm' | 'md';
}): Node | null {
  const text = formatDelta(delta);
  if (!text) return null;
  const pad = size === 'sm' ? '6px 14px' : '8px 16px';
  const fontSize = size === 'sm' ? 18 : 20;
  return el(
    'div',
    {
      display: 'flex',
      alignItems: 'center',
      backgroundColor: deltaSoft(delta, theme),
      borderRadius: 999,
      padding: pad,
    },
    [
      el(
        'div',
        {
          fontFamily: 'IBM Plex Sans',
          fontSize,
          fontWeight: 600,
          color: deltaColor(delta, theme),
          letterSpacing: 0.2,
        },
        text,
      ),
    ],
  );
}

function TrackBar({
  widthPct,
  color,
  theme,
  height = 12,
}: {
  widthPct: number;
  color: string;
  theme: ThemePalette;
  height?: number;
}): Node {
  return el(
    'div',
    {
      display: 'flex',
      width: '100%',
      height,
      borderRadius: 999,
      backgroundColor: theme.track,
      overflow: 'hidden',
    },
    [
      el('div', {
        width: `${Math.min(100, Math.max(4, widthPct))}%`,
        height: '100%',
        borderRadius: 999,
        backgroundColor: color,
      }),
    ],
  );
}

function Header({
  title,
  subtitle,
  theme,
  logoSrc,
  kicker,
}: {
  title: string;
  subtitle?: string;
  theme: ThemePalette;
  logoSrc: string;
  kicker: string;
}): Node {
  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
    },
    [
      el(
        'div',
        {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        [BrandMark({ logoSrc }), Kicker({ label: kicker, theme })],
      ),
      el(
        'div',
        {
          fontFamily: 'Fraunces',
          fontSize: 56,
          fontWeight: 600,
          color: theme.foreground,
          lineHeight: 1.08,
          letterSpacing: -1.5,
        },
        title,
      ),
      subtitle
        ? el(
            'div',
            {
              fontFamily: 'IBM Plex Sans',
              fontSize: 24,
              fontWeight: 400,
              color: theme.mutedForeground,
              lineHeight: 1.35,
            },
            subtitle,
          )
        : null,
      el('div', {
        width: '100%',
        height: 1,
        backgroundColor: theme.hairline,
        marginTop: 4,
      }),
    ],
  );
}

function Footer({ footnote, theme }: { footnote?: string; theme: ThemePalette }): Node {
  return el(
    'div',
    {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 'auto',
      paddingTop: 8,
    },
    [
      el(
        'div',
        {
          fontFamily: 'IBM Plex Sans',
          fontSize: 17,
          color: theme.mutedForeground,
          maxWidth: 700,
          lineHeight: 1.35,
        },
        footnote ?? 'Dados da sua empresa · Tactia',
      ),
      el(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        },
        [
          el(
            'div',
            {
              fontFamily: 'IBM Plex Sans',
              fontSize: 14,
              fontWeight: 600,
              color: theme.mutedForeground,
              textTransform: 'uppercase',
              letterSpacing: 2,
            },
            'Tactia',
          ),
          el('div', {
            width: 48,
            height: 5,
            borderRadius: 999,
            backgroundImage: `linear-gradient(90deg, ${theme.brandFrom}, ${theme.brandTo})`,
          }),
        ],
      ),
    ],
  );
}

function Shell({
  theme,
  children,
}: {
  theme: ThemePalette;
  children: Array<string | Node | null | undefined | false>;
}): Node {
  return el(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'row',
      backgroundColor: theme.background,
      backgroundImage: theme.atmosphere,
    },
    [
      el('div', {
        width: 10,
        height: '100%',
        backgroundImage: `linear-gradient(180deg, ${theme.brandFrom}, ${theme.brandTo})`,
      }),
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          height: '100%',
          padding: '56px 56px 48px 48px',
          gap: 36,
        },
        children,
      ),
    ],
  );
}

function templateKicker(template: InfographicSpec['template']): string {
  switch (template) {
    case 'kpi_snapshot':
      return 'Indicadores';
    case 'comparison':
      return 'Comparativo';
    case 'ranking':
      return 'Ranking';
    case 'insight_card':
      return 'Insight';
    case 'pie_chart':
      return 'Composição';
    case 'line_chart':
      return 'Tendência';
    case 'period_comparison':
      return 'Períodos';
    case 'bar_chart':
      return 'Barras';
  }
}

function KpiGrid(spec: Extract<InfographicSpec, { template: 'kpi_snapshot' }>, theme: ThemePalette): Node {
  const count = spec.payload.items.length;
  const cols = count <= 2 ? count : 2;
  const cardWidth = cols === 1 ? '100%' : 448;

  return el(
    'div',
    {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 20,
      flex: 1,
      alignContent: 'flex-start',
    },
    spec.payload.items.map((item, index) => {
      const isHero = count === 1 || (count === 3 && index === 0);
      const valueSize = isHero ? 72 : count <= 2 ? 58 : 48;
      return el(
        'div',
        {
          display: 'flex',
          flexDirection: 'row',
          width: isHero && count === 3 ? '100%' : cardWidth,
          backgroundColor: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: 20,
          overflow: 'hidden',
        },
        [
          el('div', {
            width: 8,
            backgroundImage: `linear-gradient(180deg, ${theme.brandFrom}, ${theme.brandTo})`,
          }),
          el(
            'div',
            {
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              flex: 1,
              padding: isHero ? '36px 36px 36px 28px' : '28px 28px 28px 24px',
            },
            [
              el(
                'div',
                {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                },
                [
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 18,
                      fontWeight: 600,
                      color: theme.mutedForeground,
                      textTransform: 'uppercase',
                      letterSpacing: 1.5,
                    },
                    item.label,
                  ),
                  DeltaPill({ delta: item.delta, theme, size: 'sm' }),
                ],
              ),
              el(
                'div',
                {
                  fontFamily: 'Fraunces',
                  fontSize: valueSize,
                  fontWeight: 600,
                  color: theme.foreground,
                  letterSpacing: -1.5,
                  lineHeight: 1,
                },
                item.value,
              ),
              item.hint
                ? el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 18,
                      color: theme.mutedForeground,
                      lineHeight: 1.3,
                    },
                    item.hint,
                  )
                : null,
            ],
          ),
        ],
      );
    }),
  );
}

function Comparison(spec: Extract<InfographicSpec, { template: 'comparison' }>, theme: ThemePalette): Node {
  const leftN = spec.payload.left.numeric;
  const rightN = spec.payload.right.numeric;
  const max = Math.max(Math.abs(leftN ?? 0), Math.abs(rightN ?? 0), 1);
  // Cap below 100% so the track remains visible as a proportional cue.
  const leftW = leftN != null ? Math.max(10, Math.round((Math.abs(leftN) / max) * 92)) : 55;
  const rightW = rightN != null ? Math.max(10, Math.round((Math.abs(rightN) / max) * 92)) : 45;
  const delta = formatDelta(spec.payload.delta);

  const side = (label: string, value: string, widthPct: number, color: string, align: 'start' | 'end') =>
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        backgroundColor: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: 20,
        padding: 32,
        alignItems: align === 'end' ? 'flex-end' : 'flex-start',
      },
      [
        el(
          'div',
          {
            fontFamily: 'IBM Plex Sans',
            fontSize: 18,
            fontWeight: 600,
            color: theme.mutedForeground,
            textTransform: 'uppercase',
            letterSpacing: 1.2,
          },
          label,
        ),
        el(
          'div',
          {
            fontFamily: 'Fraunces',
            fontSize: 44,
            fontWeight: 600,
            color: theme.foreground,
            letterSpacing: -1,
            lineHeight: 1.05,
            textAlign: align === 'end' ? 'right' : 'left',
          },
          value,
        ),
        el(
          'div',
          { display: 'flex', width: '100%', marginTop: 8 },
          [TrackBar({ widthPct, color, theme, height: 14 })],
        ),
      ],
    );

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: 24,
      flex: 1,
    },
    [
      el(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        [
          el(
            'div',
            {
              fontFamily: 'IBM Plex Sans',
              fontSize: 22,
              fontWeight: 600,
              color: theme.primary,
            },
            spec.payload.metricLabel,
          ),
          delta
            ? el(
                'div',
                {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  backgroundColor: deltaSoft(spec.payload.delta, theme),
                  borderRadius: 999,
                  padding: '10px 18px',
                },
                [
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 16,
                      fontWeight: 600,
                      color: theme.mutedForeground,
                      textTransform: 'uppercase',
                      letterSpacing: 1,
                    },
                    'Variação',
                  ),
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 22,
                      fontWeight: 600,
                      color: deltaColor(spec.payload.delta, theme),
                    },
                    delta,
                  ),
                ],
              )
            : null,
        ],
      ),
      el(
        'div',
        { display: 'flex', gap: 16, alignItems: 'stretch' },
        [
          side(spec.payload.left.label, spec.payload.left.value, leftW, theme.charts[0]!, 'start'),
          el(
            'div',
            {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              width: 56,
            },
            [
              el(
                'div',
                {
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  width: 48,
                  height: 48,
                  borderRadius: 999,
                  backgroundColor: theme.primarySoft,
                  border: `1px solid ${theme.border}`,
                },
                [
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 14,
                      fontWeight: 600,
                      color: theme.primary,
                      letterSpacing: 1,
                    },
                    'VS',
                  ),
                ],
              ),
            ],
          ),
          side(spec.payload.right.label, spec.payload.right.value, rightW, theme.charts[1]!, 'end'),
        ],
      ),
    ],
  );
}

function Ranking(spec: Extract<InfographicSpec, { template: 'ranking' }>, theme: ThemePalette): Node {
  const maxShare =
    Math.max(...spec.payload.items.map((item) => item.share ?? item.numeric ?? 0), 0.01) || 1;

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      flex: 1,
    },
    [
      spec.payload.metricLabel
        ? el(
            'div',
            {
              fontFamily: 'IBM Plex Sans',
              fontSize: 20,
              fontWeight: 600,
              color: theme.primary,
              marginBottom: 4,
            },
            spec.payload.metricLabel,
          )
        : null,
      ...spec.payload.items.map((item, index) => {
        const share =
          item.share ??
          (item.numeric != null
            ? item.numeric / maxShare
            : (spec.payload.items.length - index) / spec.payload.items.length);
        const widthPct = Math.max(10, Math.round(share * 100));
        const isLeader = index === 0;
        const rank = String(index + 1).padStart(2, '0');
        const chartColor = theme.charts[index % theme.charts.length]!;

        return el(
          'div',
          {
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            backgroundColor: isLeader ? theme.primarySoft : theme.card,
            border: `1px solid ${isLeader ? theme.primary + '44' : theme.border}`,
            borderRadius: 18,
            padding: isLeader ? '22px 28px' : '18px 26px',
          },
          [
            el(
              'div',
              {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              },
              [
                el(
                  'div',
                  {
                    display: 'flex',
                    gap: 18,
                    alignItems: 'center',
                  },
                  [
                    el(
                      'div',
                      {
                        fontFamily: 'Fraunces',
                        fontSize: isLeader ? 36 : 28,
                        fontWeight: 600,
                        color: isLeader ? theme.primary : theme.mutedForeground,
                        width: 48,
                        letterSpacing: -1,
                      },
                      rank,
                    ),
                    el(
                      'div',
                      {
                        fontFamily: 'IBM Plex Sans',
                        fontSize: isLeader ? 28 : 24,
                        fontWeight: 600,
                        color: theme.foreground,
                      },
                      item.label,
                    ),
                  ],
                ),
                el(
                  'div',
                  {
                    fontFamily: 'Fraunces',
                    fontSize: isLeader ? 30 : 24,
                    fontWeight: 600,
                    color: theme.foreground,
                    letterSpacing: -0.5,
                  },
                  item.value,
                ),
              ],
            ),
            isLeader
              ? el(
                  'div',
                  {
                    display: 'flex',
                    width: '100%',
                    height: 12,
                    borderRadius: 999,
                    backgroundColor: theme.track,
                    overflow: 'hidden',
                  },
                  [
                    el('div', {
                      width: `${widthPct}%`,
                      height: '100%',
                      borderRadius: 999,
                      backgroundImage: `linear-gradient(90deg, ${theme.brandFrom}, ${theme.brandTo})`,
                    }),
                  ],
                )
              : TrackBar({ widthPct, color: chartColor, theme, height: 8 }),
          ],
        );
      }),
    ],
  );
}

function InsightCard(spec: Extract<InfographicSpec, { template: 'insight_card' }>, theme: ThemePalette): Node {
  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: 28,
      flex: 1,
    },
    [
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          backgroundColor: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: 24,
          padding: '40px 40px 36px',
          backgroundImage: `linear-gradient(145deg, ${theme.brandFrom}18 0%, ${theme.card} 48%, ${theme.brandTo}0d 100%)`,
        },
        [
          spec.payload.highlightLabel
            ? el(
                'div',
                {
                  fontFamily: 'IBM Plex Sans',
                  fontSize: 18,
                  fontWeight: 600,
                  color: theme.mutedForeground,
                  textTransform: 'uppercase',
                  letterSpacing: 2,
                },
                spec.payload.highlightLabel,
              )
            : null,
          el(
            'div',
            {
              fontFamily: 'Fraunces',
              fontSize: 84,
              fontWeight: 600,
              color: theme.foreground,
              letterSpacing: -2.5,
              lineHeight: 0.95,
            },
            spec.payload.highlight,
          ),
          el('div', {
            width: 72,
            height: 5,
            borderRadius: 999,
            marginTop: 4,
            backgroundImage: `linear-gradient(90deg, ${theme.brandFrom}, ${theme.brandTo})`,
          }),
        ],
      ),
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        },
        spec.payload.bullets.map((bullet, index) =>
          el(
            'div',
            {
              display: 'flex',
              gap: 18,
              alignItems: 'flex-start',
              backgroundColor: theme.card,
              border: `1px solid ${theme.border}`,
              borderRadius: 16,
              padding: '20px 24px',
            },
            [
              el(
                'div',
                {
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  backgroundColor: theme.primarySoft,
                  flexShrink: 0,
                },
                [
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 16,
                      fontWeight: 600,
                      color: theme.primary,
                    },
                    String(index + 1),
                  ),
                ],
              ),
              el(
                'div',
                {
                  fontFamily: 'IBM Plex Sans',
                  fontSize: 24,
                  color: theme.foreground,
                  lineHeight: 1.4,
                  flex: 1,
                  paddingTop: 4,
                },
                bullet,
              ),
            ],
          ),
        ),
      ),
    ],
  );
}

function PieChart(spec: Extract<InfographicSpec, { template: 'pie_chart' }>, theme: ThemePalette): Node {
  const shares = normalizeShares(spec.payload.items);
  const size = 420;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 168;
  const innerR = 96;
  const gap = 0.04;

  let angle = -Math.PI / 2;
  const slices = shares.map((share, index) => {
    const sweep = Math.max(0.02, share * Math.PI * 2 - gap);
    const start = angle + gap / 2;
    const end = start + sweep;
    angle += share * Math.PI * 2;
    return {
      path: donutSlicePath(cx, cy, outerR, innerR, start, end),
      color: theme.charts[index % theme.charts.length]!,
      item: spec.payload.items[index]!,
      share,
    };
  });

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'row',
      gap: 36,
      flex: 1,
      alignItems: 'center',
    },
    [
      el(
        'div',
        {
          display: 'flex',
          position: 'relative',
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        },
        [
          svgEl(
            'svg',
            { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
            slices.map((slice) =>
              svgEl('path', {
                d: slice.path,
                fill: slice.color,
              }),
            ),
          ),
          el(
            'div',
            {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'absolute',
              width: innerR * 2 - 16,
              height: innerR * 2 - 16,
              borderRadius: 999,
            },
            [
              spec.payload.centerLabel
                ? el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 16,
                      fontWeight: 600,
                      color: theme.mutedForeground,
                      textTransform: 'uppercase',
                      letterSpacing: 1.5,
                      marginBottom: 6,
                    },
                    spec.payload.centerLabel,
                  )
                : null,
              spec.payload.centerValue
                ? el(
                    'div',
                    {
                      fontFamily: 'Fraunces',
                      fontSize: 32,
                      fontWeight: 600,
                      color: theme.foreground,
                      letterSpacing: -0.5,
                      textAlign: 'center',
                    },
                    spec.payload.centerValue,
                  )
                : null,
            ],
          ),
        ],
      ),
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          flex: 1,
        },
        slices.map((slice) =>
          el(
            'div',
            {
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              backgroundColor: theme.card,
              border: `1px solid ${theme.border}`,
              borderRadius: 14,
              padding: '14px 18px',
            },
            [
              el('div', {
                width: 14,
                height: 14,
                borderRadius: 4,
                backgroundColor: slice.color,
                flexShrink: 0,
              }),
              el(
                'div',
                { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
                [
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 20,
                      fontWeight: 600,
                      color: theme.foreground,
                    },
                    slice.item.label,
                  ),
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 16,
                      color: theme.mutedForeground,
                    },
                    `${Math.round(slice.share * 100)}% · ${slice.item.value}`,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    ],
  );
}

function LineChart(spec: Extract<InfographicSpec, { template: 'line_chart' }>, theme: ThemePalette): Node {
  const chartW = 920;
  const chartH = 420;
  const layout = layoutLineChart(spec.payload.points, chartW, chartH);
  const last = layout.points[layout.points.length - 1];

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
      flex: 1,
    },
    [
      el(
        'div',
        {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        [
          spec.payload.metricLabel
            ? el(
                'div',
                {
                  fontFamily: 'IBM Plex Sans',
                  fontSize: 20,
                  fontWeight: 600,
                  color: theme.primary,
                },
                spec.payload.metricLabel,
              )
            : el('div', {}, ''),
          DeltaPill({ delta: spec.payload.delta, theme }),
        ],
      ),
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: 20,
          padding: '28px 24px 20px',
          flex: 1,
        },
        [
          el(
            'div',
            {
              display: 'flex',
              position: 'relative',
              width: chartW,
              height: chartH,
            },
            [
              svgEl(
                'svg',
                { width: chartW, height: chartH, viewBox: `0 0 ${chartW} ${chartH}` },
                [
                  // grid lines
                  ...[0, 0.5, 1].map((t) => {
                    const y = layout.padTop + t * (chartH - layout.padTop - layout.padBottom);
                    return svgEl('line', {
                      x1: layout.padX,
                      y1: y,
                      x2: chartW - layout.padX,
                      y2: y,
                      stroke: theme.hairline,
                      strokeWidth: 1,
                    });
                  }),
                  svgEl('path', {
                    d: layout.areaPath,
                    fill: `${theme.primary}22`,
                  }),
                  svgEl('path', {
                    d: layout.linePath,
                    fill: 'none',
                    stroke: theme.primary,
                    strokeWidth: 4,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  }),
                  ...layout.points.map((p) =>
                    svgEl('circle', {
                      cx: p.x,
                      cy: p.y,
                      r: 7,
                      fill: theme.card,
                      stroke: theme.primary,
                      strokeWidth: 3,
                    }),
                  ),
                ],
              ),
              // y labels
              el(
                'div',
                {
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  position: 'absolute',
                  left: 0,
                  top: layout.padTop - 8,
                  height: chartH - layout.padTop - layout.padBottom + 16,
                  width: layout.padX - 4,
                },
                [
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 14,
                      color: theme.mutedForeground,
                      textAlign: 'right',
                    },
                    formatAxisNumber(layout.max),
                  ),
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 14,
                      color: theme.mutedForeground,
                      textAlign: 'right',
                    },
                    formatAxisNumber(layout.min),
                  ),
                ],
              ),
              // x labels
              el(
                'div',
                {
                  display: 'flex',
                  justifyContent: 'space-between',
                  position: 'absolute',
                  left: layout.padX,
                  right: layout.padX,
                  bottom: 4,
                  width: chartW - layout.padX * 2,
                },
                layout.points.map((p) =>
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 15,
                      fontWeight: 600,
                      color: theme.mutedForeground,
                      textAlign: 'center',
                      width: Math.floor((chartW - layout.padX * 2) / layout.points.length),
                    },
                    p.label,
                  ),
                ),
              ),
            ],
          ),
          last
            ? el(
                'div',
                {
                  display: 'flex',
                  justifyContent: 'flex-end',
                  marginTop: 8,
                },
                [
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 18,
                      color: theme.mutedForeground,
                    },
                    `Último ponto: ${last.value}`,
                  ),
                ],
              )
            : null,
        ],
      ),
    ],
  );
}

function PeriodComparison(
  spec: Extract<InfographicSpec, { template: 'period_comparison' }>,
  theme: ThemePalette,
): Node {
  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      flex: 1,
    },
    [
      el(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px 4px 8px',
        },
        [
          el('div', { width: 220 }, ''),
          el(
            'div',
            {
              display: 'flex',
              flex: 1,
              justifyContent: 'flex-end',
              gap: 24,
            },
            [
              el(
                'div',
                {
                  fontFamily: 'IBM Plex Sans',
                  fontSize: 16,
                  fontWeight: 600,
                  color: theme.primary,
                  textTransform: 'uppercase',
                  letterSpacing: 1.2,
                  width: 160,
                  textAlign: 'right',
                },
                spec.payload.leftLabel,
              ),
              el(
                'div',
                {
                  fontFamily: 'IBM Plex Sans',
                  fontSize: 16,
                  fontWeight: 600,
                  color: theme.mutedForeground,
                  textTransform: 'uppercase',
                  letterSpacing: 1.2,
                  width: 160,
                  textAlign: 'right',
                },
                spec.payload.rightLabel,
              ),
              el('div', { width: 110 }, ''),
            ],
          ),
        ],
      ),
      ...spec.payload.metrics.map((metric, index) => {
        const leftN = metric.leftNumeric;
        const rightN = metric.rightNumeric;
        const max = Math.max(Math.abs(leftN ?? 0), Math.abs(rightN ?? 0), 1);
        const leftPct = leftN != null ? Math.max(8, Math.round((Math.abs(leftN) / max) * 100)) : 50;
        const rightPct = rightN != null ? Math.max(8, Math.round((Math.abs(rightN) / max) * 100)) : 50;

        return el(
          'div',
          {
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            backgroundColor: theme.card,
            border: `1px solid ${theme.border}`,
            borderRadius: 16,
            padding: '20px 24px',
          },
          [
            el(
              'div',
              {
                display: 'flex',
                alignItems: 'center',
              },
              [
                el(
                  'div',
                  {
                    fontFamily: 'IBM Plex Sans',
                    fontSize: 22,
                    fontWeight: 600,
                    color: theme.foreground,
                    width: 220,
                  },
                  metric.label,
                ),
                el(
                  'div',
                  {
                    display: 'flex',
                    flex: 1,
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: 24,
                  },
                  [
                    el(
                      'div',
                      {
                        fontFamily: 'Fraunces',
                        fontSize: 28,
                        fontWeight: 600,
                        color: theme.foreground,
                        width: 160,
                        textAlign: 'right',
                        letterSpacing: -0.5,
                      },
                      metric.left,
                    ),
                    el(
                      'div',
                      {
                        fontFamily: 'Fraunces',
                        fontSize: 28,
                        fontWeight: 600,
                        color: theme.mutedForeground,
                        width: 160,
                        textAlign: 'right',
                        letterSpacing: -0.5,
                      },
                      metric.right,
                    ),
                    el(
                      'div',
                      { width: 110, display: 'flex', justifyContent: 'flex-end' },
                      [DeltaPill({ delta: metric.delta, theme, size: 'sm' })],
                    ),
                  ],
                ),
              ],
            ),
            el(
              'div',
              { display: 'flex', gap: 12, paddingLeft: 220 },
              [
                el(
                  'div',
                  { display: 'flex', flex: 1, flexDirection: 'column', gap: 6 },
                  [
                    TrackBar({
                      widthPct: leftPct,
                      color: theme.charts[0]!,
                      theme,
                      height: 8,
                    }),
                  ],
                ),
                el(
                  'div',
                  { display: 'flex', flex: 1, flexDirection: 'column', gap: 6 },
                  [
                    TrackBar({
                      widthPct: rightPct,
                      color: theme.charts[(index + 1) % theme.charts.length]!,
                      theme,
                      height: 8,
                    }),
                  ],
                ),
              ],
            ),
          ],
        );
      }),
    ],
  );
}

function BarChart(spec: Extract<InfographicSpec, { template: 'bar_chart' }>, theme: ThemePalette): Node {
  const max = Math.max(...spec.payload.items.map((item) => item.numeric), 0.01);
  const chartH = 460;
  const barMaxH = 340;

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
      flex: 1,
    },
    [
      spec.payload.metricLabel
        ? el(
            'div',
            {
              fontFamily: 'IBM Plex Sans',
              fontSize: 20,
              fontWeight: 600,
              color: theme.primary,
            },
            spec.payload.metricLabel,
          )
        : null,
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: 20,
          padding: '32px 28px 24px',
          flex: 1,
        },
        [
          el(
            'div',
            {
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 16,
              height: chartH,
              paddingBottom: 8,
            },
            spec.payload.items.map((item, index) => {
              const height = Math.max(24, Math.round((item.numeric / max) * barMaxH));
              const color = theme.charts[index % theme.charts.length]!;
              return el(
                'div',
                {
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  flex: 1,
                  gap: 12,
                  height: '100%',
                },
                [
                  el(
                    'div',
                    {
                      fontFamily: 'Fraunces',
                      fontSize: 20,
                      fontWeight: 600,
                      color: theme.foreground,
                      letterSpacing: -0.3,
                      textAlign: 'center',
                    },
                    item.value,
                  ),
                  el('div', {
                    width: '72%',
                    height,
                    borderRadius: '14px 14px 8px 8px',
                    ...(index === 0
                      ? {
                          backgroundImage: `linear-gradient(180deg, ${theme.brandFrom}, ${theme.brandTo})`,
                        }
                      : { backgroundColor: color }),
                  }),
                  el(
                    'div',
                    {
                      fontFamily: 'IBM Plex Sans',
                      fontSize: 16,
                      fontWeight: 600,
                      color: theme.mutedForeground,
                      textAlign: 'center',
                      lineHeight: 1.25,
                    },
                    item.label,
                  ),
                ],
              );
            }),
          ),
        ],
      ),
    ],
  );
}

function bodyFor(spec: InfographicSpec, theme: ThemePalette): Node {
  switch (spec.template) {
    case 'kpi_snapshot':
      return KpiGrid(spec, theme);
    case 'comparison':
      return Comparison(spec, theme);
    case 'ranking':
      return Ranking(spec, theme);
    case 'insight_card':
      return InsightCard(spec, theme);
    case 'pie_chart':
      return PieChart(spec, theme);
    case 'line_chart':
      return LineChart(spec, theme);
    case 'period_comparison':
      return PeriodComparison(spec, theme);
    case 'bar_chart':
      return BarChart(spec, theme);
  }
}

export async function buildInfographicTree(spec: InfographicSpec): Promise<Node> {
  const themeKey = spec.theme ?? 'light';
  const theme = THEMES[themeKey];
  const logoSrc = await loadBrandLogoDataUrl(themeKey);

  const footnote =
    'payload' in spec && spec.payload && 'footnote' in spec.payload
      ? spec.payload.footnote
      : undefined;

  return Shell({
    theme,
    children: [
      Header({
        title: spec.title,
        subtitle: spec.subtitle,
        theme,
        logoSrc,
        kicker: templateKicker(spec.template),
      }),
      bodyFor(spec, theme),
      Footer({ footnote, theme }),
    ],
  });
}
