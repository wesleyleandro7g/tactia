import type { LLMEnv } from '../config';
import { MockEmbeddingAdapter } from './mock-embedding-adapter';
import { OpenAIEmbeddingAdapter } from './openai-embedding-adapter';
import type { EmbeddingAdapter } from './types';

export type EmbeddingEnv = LLMEnv & {
  EMBEDDING_MODEL?: string;
};

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export function createEmbeddingAdapterFromEnv(env: EmbeddingEnv): EmbeddingAdapter | null {
  const provider = env.LLM_PROVIDER ?? 'openai';
  const model = env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;

  if (provider === 'mock') {
    return new MockEmbeddingAdapter(model);
  }

  if (!env.LLM_API_KEY) return null;

  return new OpenAIEmbeddingAdapter({
    apiKey: env.LLM_API_KEY,
    model,
    ...(env.LLM_BASE_URL ? { baseURL: env.LLM_BASE_URL } : {}),
  });
}
