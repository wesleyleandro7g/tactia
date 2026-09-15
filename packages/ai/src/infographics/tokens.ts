/** Brand tokens mirrored from apps/web Warm Command theme. */

export type InfographicTheme = 'light' | 'dark';

export type ThemePalette = {
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  card: string;
  border: string;
  primary: string;
  brandFrom: string;
  brandTo: string;
  success: string;
  danger: string;
  charts: string[];
  /** Soft fills for pills / tracks (hex with alpha). */
  primarySoft: string;
  successSoft: string;
  dangerSoft: string;
  track: string;
  atmosphere: string;
  hairline: string;
};

export const WIDTH = 1080;
export const HEIGHT = 1350;

export const THEMES: Record<InfographicTheme, ThemePalette> = {
  light: {
    background: '#f7f3ee',
    foreground: '#131212',
    muted: '#efe8e1',
    mutedForeground: '#5c554f',
    card: '#fffcfa',
    border: '#e4dbd3',
    primary: '#e24a00',
    brandFrom: '#fe2204',
    brandTo: '#fe7200',
    success: '#15803d',
    danger: '#b91c1c',
    charts: ['#fe7200', '#15803d', '#d97706', '#c45c26', '#b91c1c'],
    primarySoft: '#e24a0014',
    successSoft: '#15803d18',
    dangerSoft: '#b91c1c18',
    track: '#e4dbd3',
    atmosphere: 'linear-gradient(155deg, #f7f3ee 0%, #f7f3ee 42%, #fbe8dc 78%, #f7f3ee 100%)',
    hairline: '#d6ccc2',
  },
  dark: {
    background: '#131212',
    foreground: '#f4efea',
    muted: '#221f1e',
    mutedForeground: '#a89f98',
    card: '#1c1b1a',
    border: '#2e2c2b',
    primary: '#ff7a1a',
    brandFrom: '#fe2204',
    brandTo: '#fe7200',
    success: '#3ecf8e',
    danger: '#e5484d',
    charts: ['#fe7200', '#3ecf8e', '#f5a623', '#e8956a', '#e5484d'],
    primarySoft: '#ff7a1a24',
    successSoft: '#3ecf8e22',
    dangerSoft: '#e5484d22',
    track: '#2e2c2b',
    atmosphere: 'linear-gradient(155deg, #131212 0%, #131212 40%, #241810 78%, #131212 100%)',
    hairline: '#3a3735',
  },
};

export function deltaColor(delta: number | null | undefined, theme: ThemePalette): string {
  if (delta == null || delta === 0) return theme.mutedForeground;
  return delta > 0 ? theme.success : theme.danger;
}

export function deltaSoft(delta: number | null | undefined, theme: ThemePalette): string {
  if (delta == null || delta === 0) return theme.muted;
  return delta > 0 ? theme.successSoft : theme.dangerSoft;
}

export function formatDelta(delta: number | null | undefined): string | null {
  if (delta == null) return null;
  const pct = `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
  return pct;
}
