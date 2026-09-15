import type { InfographicSpec } from './schema';
import { LOGO_DISPLAY, loadBrandLogoDataUrl } from './logo';
import { THEMES, deltaColor, formatDelta, type ThemePalette } from './tokens';

type Node = {
  type: string;
  props: {
    src?: string;
    style?: Record<string, string | number | undefined>;
    children?: string | Node | Array<string | Node | null | undefined | false>;
  };
};

function el(
  type: string,
  style: Record<string, string | number | undefined>,
  children?: Node['props']['children'],
  extra?: { src?: string },
): Node {
  const cleaned = Array.isArray(children)
    ? children.filter((child): child is string | Node => Boolean(child))
    : children;
  return {
    type,
    props: {
      style,
      ...(extra?.src ? { src: extra.src } : {}),
      ...(cleaned !== undefined ? { children: cleaned } : {}),
    },
  };
}

function BrandMark({ logoSrc }: { logoSrc: string }): Node {
  return el(
    'div',
    {
      display: 'flex',
      alignItems: 'center',
    },
    [
      el(
        'img',
        {
          width: LOGO_DISPLAY.width,
          height: LOGO_DISPLAY.height,
          objectFit: 'contain',
        },
        undefined,
        { src: logoSrc },
      ),
    ],
  );
}

function Header({
  title,
  subtitle,
  theme,
  logoSrc,
}: {
  title: string;
  subtitle?: string;
  theme: ThemePalette;
  logoSrc: string;
}): Node {
  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    },
    [
      BrandMark({ logoSrc }),
      el(
        'div',
        {
          fontFamily: 'Fraunces',
          fontSize: 52,
          fontWeight: 600,
          color: theme.foreground,
          lineHeight: 1.15,
          letterSpacing: -1,
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
              lineHeight: 1.4,
            },
            subtitle,
          )
        : null,
    ],
  );
}

function Footer({ footnote, theme }: { footnote?: string; theme: ThemePalette }): Node {
  return el(
    'div',
    {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginTop: 'auto',
    },
    [
      el(
        'div',
        {
          fontFamily: 'IBM Plex Sans',
          fontSize: 18,
          color: theme.mutedForeground,
          maxWidth: 720,
        },
        footnote ?? 'Dados da sua empresa · Tactia',
      ),
      el('div', {
        width: 64,
        height: 6,
        borderRadius: 999,
        backgroundImage: `linear-gradient(90deg, ${theme.brandFrom}, ${theme.brandTo})`,
      }),
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
      flexDirection: 'column',
      backgroundColor: theme.background,
      padding: 64,
      gap: 40,
    },
    children,
  );
}

function KpiGrid(spec: Extract<InfographicSpec, { template: 'kpi_snapshot' }>, theme: ThemePalette): Node {
  const cols = spec.payload.items.length <= 2 ? spec.payload.items.length : 2;
  return el(
    'div',
    {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 24,
    },
    spec.payload.items.map((item) => {
      const delta = formatDelta(item.delta);
      return el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: cols === 1 ? '100%' : 460,
          backgroundColor: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: 24,
          padding: 32,
        },
        [
          el(
            'div',
            {
              fontFamily: 'IBM Plex Sans',
              fontSize: 20,
              fontWeight: 600,
              color: theme.mutedForeground,
              textTransform: 'uppercase',
              letterSpacing: 1,
            },
            item.label,
          ),
          el(
            'div',
            {
              fontFamily: 'Fraunces',
              fontSize: 56,
              fontWeight: 600,
              color: theme.foreground,
              letterSpacing: -1,
            },
            item.value,
          ),
          delta
            ? el(
                'div',
                {
                  fontFamily: 'IBM Plex Sans',
                  fontSize: 22,
                  fontWeight: 600,
                  color: deltaColor(item.delta, theme),
                },
                delta,
              )
            : null,
          item.hint
            ? el(
                'div',
                {
                  fontFamily: 'IBM Plex Sans',
                  fontSize: 18,
                  color: theme.mutedForeground,
                },
                item.hint,
              )
            : null,
        ],
      );
    }),
  );
}

function Comparison(spec: Extract<InfographicSpec, { template: 'comparison' }>, theme: ThemePalette): Node {
  const leftN = spec.payload.left.numeric;
  const rightN = spec.payload.right.numeric;
  const max = Math.max(Math.abs(leftN ?? 0), Math.abs(rightN ?? 0), 1);
  const leftW = leftN != null ? Math.max(8, Math.round((Math.abs(leftN) / max) * 100)) : 55;
  const rightW = rightN != null ? Math.max(8, Math.round((Math.abs(rightN) / max) * 100)) : 45;
  const delta = formatDelta(spec.payload.delta);

  const side = (label: string, value: string, widthPct: number, color: string) =>
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        flex: 1,
        backgroundColor: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: 24,
        padding: 32,
      },
      [
        el(
          'div',
          {
            fontFamily: 'IBM Plex Sans',
            fontSize: 22,
            fontWeight: 600,
            color: theme.mutedForeground,
          },
          label,
        ),
        el(
          'div',
          {
            fontFamily: 'Fraunces',
            fontSize: 48,
            fontWeight: 600,
            color: theme.foreground,
          },
          value,
        ),
        el('div', {
          width: `${widthPct}%`,
          height: 14,
          borderRadius: 999,
          backgroundColor: color,
        }),
      ],
    );

  return el(
    'div',
    { display: 'flex', flexDirection: 'column', gap: 28 },
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
      el(
        'div',
        { display: 'flex', gap: 24 },
        [
          side(spec.payload.left.label, spec.payload.left.value, leftW, theme.charts[0]!),
          side(spec.payload.right.label, spec.payload.right.value, rightW, theme.charts[1]!),
        ],
      ),
      delta
        ? el(
            'div',
            {
              fontFamily: 'IBM Plex Sans',
              fontSize: 28,
              fontWeight: 600,
              color: deltaColor(spec.payload.delta, theme),
            },
            `Variação ${delta}`,
          )
        : null,
    ],
  );
}

function Ranking(spec: Extract<InfographicSpec, { template: 'ranking' }>, theme: ThemePalette): Node {
  const maxShare =
    Math.max(...spec.payload.items.map((item) => item.share ?? item.numeric ?? 0), 0.01) || 1;

  return el(
    'div',
    { display: 'flex', flexDirection: 'column', gap: 20 },
    [
      spec.payload.metricLabel
        ? el(
            'div',
            {
              fontFamily: 'IBM Plex Sans',
              fontSize: 22,
              fontWeight: 600,
              color: theme.primary,
            },
            spec.payload.metricLabel,
          )
        : null,
      ...spec.payload.items.map((item, index) => {
        const share = item.share ?? (item.numeric != null ? item.numeric / maxShare : (spec.payload.items.length - index) / spec.payload.items.length);
        const widthPct = Math.max(12, Math.round(share * 100));
        return el(
          'div',
          {
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            backgroundColor: theme.card,
            border: `1px solid ${theme.border}`,
            borderRadius: 20,
            padding: '20px 28px',
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
                    gap: 16,
                    alignItems: 'center',
                  },
                  [
                    el(
                      'div',
                      {
                        fontFamily: 'Fraunces',
                        fontSize: 28,
                        fontWeight: 600,
                        color: theme.primary,
                        width: 36,
                      },
                      String(index + 1).padStart(2, '0'),
                    ),
                    el(
                      'div',
                      {
                        fontFamily: 'IBM Plex Sans',
                        fontSize: 26,
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
                    fontFamily: 'IBM Plex Sans',
                    fontSize: 24,
                    fontWeight: 600,
                    color: theme.foreground,
                  },
                  item.value,
                ),
              ],
            ),
            el('div', {
              width: `${widthPct}%`,
              height: 10,
              borderRadius: 999,
              backgroundColor: theme.charts[index % theme.charts.length]!,
            }),
          ],
        );
      }),
    ],
  );
}

function InsightCard(spec: Extract<InfographicSpec, { template: 'insight_card' }>, theme: ThemePalette): Node {
  return el(
    'div',
    { display: 'flex', flexDirection: 'column', gap: 32 },
    [
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          backgroundColor: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: 28,
          padding: 40,
          backgroundImage: `linear-gradient(135deg, ${theme.brandFrom}22, ${theme.brandTo}11)`,
        },
        [
          spec.payload.highlightLabel
            ? el(
                'div',
                {
                  fontFamily: 'IBM Plex Sans',
                  fontSize: 20,
                  fontWeight: 600,
                  color: theme.mutedForeground,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                },
                spec.payload.highlightLabel,
              )
            : null,
          el(
            'div',
            {
              fontFamily: 'Fraunces',
              fontSize: 72,
              fontWeight: 600,
              color: theme.foreground,
              letterSpacing: -2,
            },
            spec.payload.highlight,
          ),
        ],
      ),
      ...spec.payload.bullets.map((bullet) =>
        el(
          'div',
          {
            display: 'flex',
            gap: 16,
            alignItems: 'flex-start',
          },
          [
            el('div', {
              width: 12,
              height: 12,
              marginTop: 10,
              borderRadius: 999,
              backgroundImage: `linear-gradient(135deg, ${theme.brandFrom}, ${theme.brandTo})`,
            }),
            el(
              'div',
              {
                fontFamily: 'IBM Plex Sans',
                fontSize: 26,
                color: theme.foreground,
                lineHeight: 1.4,
                flex: 1,
              },
              bullet,
            ),
          ],
        ),
      ),
    ],
  );
}

export async function buildInfographicTree(spec: InfographicSpec): Promise<Node> {
  const themeKey = spec.theme ?? 'light';
  const theme = THEMES[themeKey];
  const logoSrc = await loadBrandLogoDataUrl(themeKey);
  const body =
    spec.template === 'kpi_snapshot'
      ? KpiGrid(spec, theme)
      : spec.template === 'comparison'
        ? Comparison(spec, theme)
        : spec.template === 'ranking'
          ? Ranking(spec, theme)
          : InsightCard(spec, theme);

  const footnote =
    'payload' in spec && spec.payload && 'footnote' in spec.payload
      ? spec.payload.footnote
      : undefined;

  return Shell({
    theme,
    children: [
      Header({ title: spec.title, subtitle: spec.subtitle, theme, logoSrc }),
      body,
      Footer({ footnote, theme }),
    ],
  });
}
