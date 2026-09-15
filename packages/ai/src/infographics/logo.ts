import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InfographicTheme } from './tokens';

/** Intrinsic SVG size from the brand wordmark. */
export const LOGO_INTRINSIC = { width: 1600, height: 496 } as const;

/** Display size used in the infographic header. */
export const LOGO_DISPLAY = {
  height: 40,
  width: Math.round((40 * LOGO_INTRINSIC.width) / LOGO_INTRINSIC.height),
} as const;

const cache: Partial<Record<InfographicTheme, string>> = {};

function resolveLogoCandidates(fileName: string): string[] {
  const candidates: string[] = [];

  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve('@tactia/ai/infographics');
    candidates.push(join(dirname(entry), 'assets', fileName));
  } catch {
    // fall through
  }

  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), 'assets', fileName));
  } catch {
    // fall through
  }

  candidates.push(
    join(process.cwd(), 'packages/ai/src/infographics/assets', fileName),
    join(process.cwd(), '../packages/ai/src/infographics/assets', fileName),
    join(process.cwd(), '../../packages/ai/src/infographics/assets', fileName),
    join(process.cwd(), 'apps/web/public', fileName),
    join(process.cwd(), '../web/public', fileName),
  );

  return [...new Set(candidates)];
}

async function readLogoSvg(fileName: string): Promise<Buffer> {
  const errors: string[] = [];
  for (const candidate of resolveLogoCandidates(fileName)) {
    try {
      return await readFile(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Tactia logo not found (${fileName}). Tried:\n${errors.join('\n')}`);
}

/** Returns a data URL for the brand wordmark matching the infographic theme. */
export async function loadBrandLogoDataUrl(theme: InfographicTheme): Promise<string> {
  const cached = cache[theme];
  if (cached) return cached;

  const fileName = theme === 'dark' ? 'tactia-logo-white.svg' : 'tactia-logo-black.svg';
  const svg = await readLogoSvg(fileName);
  const dataUrl = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  cache[theme] = dataUrl;
  return dataUrl;
}
