export const EMBEDDING_DIMENSIONS = 1536;

/** Top-K facts injected into the chat system prompt. */
export const FACT_CONTEXT_K = 8;
/** Cosine similarity floor: `1 - (embedding <=> query)`. */
export const FACT_CONTEXT_MIN_SCORE = 0.25;
export const EPISODE_SEARCH_LIMIT = 8;
export const PLAYBOOK_CONTEXT_K = 3;
export const EMBED_PENDING_BATCH = 32;

export function toVectorLiteral(values: number[]): string {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding must have ${EMBEDDING_DIMENSIONS} dimensions`);
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Embedding contains a non-finite value');
  }
  return `[${values.join(',')}]`;
}
