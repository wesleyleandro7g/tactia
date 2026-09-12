/**
 * Token counts are approximated as `Math.ceil(text.length / 4)` (chars/4).
 * tiktoken is not a dependency of this package — the overlap is therefore
 * character-based, not model-tokenizer-based.
 */
export const CHUNK_TARGET_TOKENS = 640;
export const CHUNK_OVERLAP_TOKENS = 80;

export type TextChunk = {
  ordinal: number;
  heading: string | null;
  text: string;
  tokenCount: number;
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const HEADING_LINE = /^(#{1,6})\s+(.+)$/;

function overlapSuffix(text: string, overlapTokens: number): string {
  const chars = overlapTokens * 4;
  if (chars <= 0 || text.length <= chars) return text;
  return text.slice(-chars);
}

type Section = { heading: string | null; text: string };

function splitSections(source: string): Section[] {
  const normalized = source.replace(/\r\n/g, '\n');
  const hasHeading = /^(#{1,6})\s+.+$/m.test(normalized);
  if (!hasHeading) {
    return normalized
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((text) => ({ heading: null, text }));
  }

  const lines = normalized.split('\n');
  const sections: Section[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text.length > 0 || heading) {
      if (text.length > 0) sections.push({ heading, text });
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = HEADING_LINE.exec(line);
    if (match) {
      flush();
      heading = match[2]?.trim() ?? null;
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

function splitOversized(section: Section, targetTokens: number): Section[] {
  if (estimateTokens(section.text) <= targetTokens) return [section];
  const paragraphs = section.text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (paragraphs.length <= 1) {
    const maxChars = targetTokens * 4;
    const pieces: Section[] = [];
    for (let offset = 0; offset < section.text.length; offset += maxChars) {
      const slice = section.text.slice(offset, offset + maxChars).trim();
      if (slice) pieces.push({ heading: section.heading, text: slice });
    }
    return pieces;
  }
  return paragraphs.map((text) => ({ heading: section.heading, text }));
}

/**
 * Split markdown/plain text into overlapping chunks.
 * Headings (`#`–`######`) become section boundaries when present; otherwise paragraphs.
 */
export function chunkText(
  source: string,
  options?: { targetTokens?: number; overlapTokens?: number },
): TextChunk[] {
  const targetTokens = options?.targetTokens ?? CHUNK_TARGET_TOKENS;
  const overlapTokens = options?.overlapTokens ?? CHUNK_OVERLAP_TOKENS;
  const trimmed = source.trim();
  if (!trimmed) return [];

  const pieces = splitSections(trimmed).flatMap((section) => splitOversized(section, targetTokens));
  const chunks: TextChunk[] = [];
  let current = '';
  let currentHeading: string | null = null;

  const flush = () => {
    const text = current.trim();
    if (!text) {
      current = '';
      return;
    }
    chunks.push({
      ordinal: chunks.length,
      heading: currentHeading,
      text,
      tokenCount: estimateTokens(text),
    });
  };

  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece.text}` : piece.text;
    if (current.trim() && estimateTokens(candidate) > targetTokens) {
      flush();
      const overlap = overlapSuffix(current, overlapTokens).trim();
      current = overlap ? `${overlap}\n\n${piece.text}` : piece.text;
      currentHeading = piece.heading ?? currentHeading;
      continue;
    }
    if (!current.trim()) currentHeading = piece.heading;
    current = candidate;
    if (piece.heading) currentHeading = piece.heading;
  }
  flush();
  return chunks.filter((chunk) => chunk.text.trim().length > 0);
}
