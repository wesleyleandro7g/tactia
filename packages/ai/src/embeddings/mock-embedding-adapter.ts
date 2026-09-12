import { EMBEDDING_DIMENSIONS } from '@tactia/domain';
import type { EmbeddingAdapter } from './types';

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministic 1536-d embeddings for tests and local LLM_PROVIDER=mock.
 * Keyword families share a unit axis so cosine similarity is ~1 (a single
 * boosted coordinate is invisible in 1536-d random noise).
 */
function vectorFromText(text: string): number[] {
  const values = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const lower = text.toLowerCase();
  if (/reclam|atras|quebr|cancel|insatis|p[eé]ssim/.test(lower)) {
    values[0] = 1;
    return values;
  }
  if (/obrigad|excelent|ótim|otim|parab[eé]ns/.test(lower)) {
    values[1] = 1;
    return values;
  }
  values[2 + (hashText(lower) % (EMBEDDING_DIMENSIONS - 2))] = 1;
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
