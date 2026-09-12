import { createRequire } from 'node:module';

export type DocumentTextExtractor = {
  extract(input: { bytes: Buffer; mime: string }): Promise<{ text: string; pages?: number }>;
};

export const PDF_NO_TEXT = 'PDF_NO_TEXT';

const requirePdf = createRequire(import.meta.url);

export class Utf8AndPdfExtractor implements DocumentTextExtractor {
  constructor(private readonly pdf?: (bytes: Buffer) => Promise<string>) {}

  async extract(input: { bytes: Buffer; mime: string }): Promise<{ text: string; pages?: number }> {
    if (input.mime === 'text/plain' || input.mime === 'text/markdown') {
      return { text: input.bytes.toString('utf8') };
    }
    if (input.mime === 'application/pdf') {
      if (this.pdf) {
        const text = (await this.pdf(input.bytes)).trim();
        return { text };
      }
      const parsed = await parsePdf(input.bytes);
      return parsed;
    }
    return { text: input.bytes.toString('utf8') };
  }
}

async function parsePdf(bytes: Buffer): Promise<{ text: string; pages?: number }> {
  try {
    // Inner module: pdf-parse's root index runs a debug fixture on import.
    const loaded: unknown = requirePdf('pdf-parse/lib/pdf-parse.js');
    const fn =
      typeof loaded === 'function'
        ? (loaded as (data: Buffer) => Promise<{ text: string; numpages?: number }>)
        : typeof loaded === 'object' &&
            loaded &&
            'default' in loaded &&
            typeof loaded.default === 'function'
          ? (loaded.default as (data: Buffer) => Promise<{ text: string; numpages?: number }>)
          : null;
    if (!fn) return { text: '' };
    const result = await fn(bytes);
    return { text: (result.text ?? '').trim(), pages: result.numpages };
  } catch {
    return { text: '' };
  }
}
