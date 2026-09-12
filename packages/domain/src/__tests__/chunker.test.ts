import { describe, expect, it } from 'vitest';
import { CHUNK_OVERLAP_TOKENS, chunkText, estimateTokens } from '../services/chunker';

describe('chunker', () => {
  it('E16: chunker splits markdown headings and respects overlap', () => {
    const body = [
      '# Política de troca',
      'A'.repeat(2000),
      '',
      '## SLA',
      'B'.repeat(2000),
    ].join('\n');
    const chunks = chunkText(body, { targetTokens: 200, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => chunk.heading === 'Política de troca')).toBe(true);
    expect(chunks.some((chunk) => chunk.heading === 'SLA')).toBe(true);
    expect(chunks[0]?.ordinal).toBe(0);
    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1]!;
      const current = chunks[index]!;
      const overlap = previous.text.slice(-(CHUNK_OVERLAP_TOKENS * 4)).trim();
      // Overlap is the tail of the previous chunk (chars/4 approximation).
      if (overlap.length > 0 && previous.heading === current.heading) {
        expect(current.text.startsWith(overlap.slice(0, Math.min(40, overlap.length))) || current.text.includes(overlap.slice(-20))).toBe(true);
      }
    }
    const joinedHeadings = chunks.map((chunk) => chunk.heading);
    expect(joinedHeadings).toContain('Política de troca');
    expect(estimateTokens(chunks[0]!.text)).toBe(chunks[0]!.tokenCount);
  });

  it('E16: empty text yields zero chunks', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });
});
