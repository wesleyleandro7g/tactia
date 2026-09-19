import { createRequire } from 'node:module';
import { loadInfographicFonts } from './fonts';
import { buildInfographicTree } from './layout';
import { infographicSpecSchema, type InfographicSpec } from './schema';
import { HEIGHT, WIDTH } from './tokens';

export type RenderedInfographic = {
  png: Buffer;
  width: number;
  height: number;
  title: string;
  template: InfographicSpec['template'];
  mime: 'image/png';
};

type SatoriFn = typeof import('satori').default;
type ResvgCtor = typeof import('@resvg/resvg-js').Resvg;

/**
 * Load via Node `require` (static module ids) so Turbopack does not rewrite
 * harfbuzzjs `__dirname` to `/ROOT/...` and so we avoid dynamic `import()`.
 */
const require = createRequire(import.meta.url);

function loadSatori(): SatoriFn {
  const mod = require('satori') as unknown;
  const loaded =
    typeof mod === 'function' ? (mod as SatoriFn) : (mod as { default: SatoriFn }).default;
  if (typeof loaded !== 'function') {
    throw new Error('satori export is not a function');
  }
  return loaded;
}

function loadResvg(): ResvgCtor {
  return require('@resvg/resvg-js').Resvg as ResvgCtor;
}

/**
 * Renders a validated infographic spec to a PNG buffer using Satori + resvg.
 */
export async function renderInfographic(input: unknown): Promise<RenderedInfographic> {
  const spec = infographicSpecSchema.parse(input);
  const fonts = await loadInfographicFonts();
  const tree = await buildInfographicTree(spec);
  const satori = loadSatori();
  const Resvg = loadResvg();

  const svg = await satori(tree as Parameters<SatoriFn>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts: fonts.map((font) => ({
      name: font.name,
      data: font.data,
      weight: font.weight,
      style: font.style,
    })),
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
  });
  const png = Buffer.from(resvg.render().asPng());

  return {
    png,
    width: WIDTH,
    height: HEIGHT,
    title: spec.title,
    template: spec.template,
    mime: 'image/png',
  };
}
