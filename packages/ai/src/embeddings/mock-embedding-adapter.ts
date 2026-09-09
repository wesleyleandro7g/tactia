import type { EmbeddingAdapter } from './types';

const EMBEDDING_DIMENSIONS = 1536;

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function vectorFromText(text: string): number[] {
  const seed = hashText(text.toLowerCase());
  const values = new Array<number>(EMBEDDING_DIMENSIONS);
  let current = seed;
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    current = (Math.imul(current, 1664525) + 1013904223) >>> 0;
    values[index] = (current / 0xffffffff) * 2 - 1;
  }
  const lower = text.toLowerCase();
  if (/reclam|atras|quebr|cancel|insatis|p[eé]ssim/.test(lower)) values[0] = 0.95;
  if (/obrigad|excelent|ótim|otim|parab[eé]ns/.test(lower)) values[1] = 0.95;
  return values;
}

export class MockEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = 'mock';
  readonly model: string;

  constructor(model = 'mock-embedding') {
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(vectorFromText);
  }
}
