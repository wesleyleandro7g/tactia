import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type InfographicFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600;
  style: 'normal';
};

let cached: InfographicFont[] | null = null;

function resolveFontCandidates(fileName: string): string[] {
  const candidates: string[] = [];

  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve('@tactia/ai/infographics');
    candidates.push(join(dirname(entry), 'fonts', fileName));
  } catch {
    // ignore — fall through to path heuristics
  }

  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), 'fonts', fileName));
  } catch {
    // ignore
  }

  candidates.push(
    join(process.cwd(), 'packages/ai/src/infographics/fonts', fileName),
    join(process.cwd(), '../packages/ai/src/infographics/fonts', fileName),
    join(process.cwd(), '../../packages/ai/src/infographics/fonts', fileName),
    join(process.cwd(), 'node_modules/@tactia/ai/src/infographics/fonts', fileName),
  );

  return [...new Set(candidates)];
}

async function loadFont(fileName: string): Promise<ArrayBuffer> {
  const candidates = resolveFontCandidates(fileName);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const buffer = await readFile(candidate);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Infographic font not found (${fileName}). Tried:\n${errors.join('\n')}`);
}

/** Loads bundled IBM Plex Sans + Fraunces once per process. */
export async function loadInfographicFonts(): Promise<InfographicFont[]> {
  if (cached) return cached;

  const [regular, semibold, display] = await Promise.all([
    loadFont('IBMPlexSans-Regular.ttf'),
    loadFont('IBMPlexSans-SemiBold.ttf'),
    loadFont('Fraunces-SemiBold.ttf'),
  ]);

  cached = [
    { name: 'IBM Plex Sans', data: regular, weight: 400, style: 'normal' },
    { name: 'IBM Plex Sans', data: semibold, weight: 600, style: 'normal' },
    { name: 'Fraunces', data: display, weight: 600, style: 'normal' },
  ];
  return cached;
}
