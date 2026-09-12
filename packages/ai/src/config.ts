import { AppError, ErrorCode } from '@tactia/shared';
import { MockLLMAdapter } from './adapters/mock-llm-adapter';
import { VercelLLMAdapter } from './adapters/vercel-llm-adapter';
import type { LLMAdapter } from './types';

export type LLMEnv = {
  LLM_PROVIDER?: string;
  LLM_API_KEY?: string;
  /** Model used by the chat / narrative (strong model). */
  LLM_MODEL?: string;
  /** Cheaper model for bulk classification. Falls back to LLM_MODEL. */
  LLM_CLASSIFIER_MODEL?: string;
  LLM_BASE_URL?: string;
};

/**
 * Two tiers: the chat/briefing needs reasoning over several tool results and
 * writes the text the owner reads; classification runs over thousands of
 * short messages and only needs to pick a label.
 */
export type LLMRole = 'chat' | 'classifier';

export const DEFAULT_LLM_MODEL = 'gpt-4.1';
export const DEFAULT_CLASSIFIER_MODEL = 'gpt-4o-mini';

export function resolveModel(env: LLMEnv, role: LLMRole): string {
  if (role === 'classifier') {
    return env.LLM_CLASSIFIER_MODEL ?? env.LLM_MODEL ?? DEFAULT_CLASSIFIER_MODEL;
  }
  return env.LLM_MODEL ?? DEFAULT_LLM_MODEL;
}

/**
 * Builds the configured LLM adapter from environment variables.
 * Returns `null` when no API key is present, so the app can boot (and the chat
 * routes answer `AI_ERROR`) without an LLM configured.
 */
export function createLLMAdapterFromEnv(env: LLMEnv, role: LLMRole = 'chat'): LLMAdapter | null {
  const provider = env.LLM_PROVIDER ?? 'openai';
  const model = resolveModel(env, role);

  if (provider === 'mock') {
    return new MockLLMAdapter({
      script: [{ text: 'Resposta simulada (LLM_PROVIDER=mock).' }],
      model: env.LLM_MODEL ?? 'mock-model',
    });
  }

  if (!env.LLM_API_KEY) return null;

  return new VercelLLMAdapter({
    provider,
    apiKey: env.LLM_API_KEY,
    model,
    ...(env.LLM_BASE_URL ? { baseURL: env.LLM_BASE_URL } : {}),
  });
}

/** Same as above, but fails loudly — used by the chat routes. */
export function requireLLMAdapter(env: LLMEnv, role: LLMRole = 'chat'): LLMAdapter {
  const adapter = createLLMAdapterFromEnv(env, role);
  if (!adapter) {
    throw new AppError(
      ErrorCode.AI_ERROR,
      'Chat indisponível: configure LLM_API_KEY (e opcionalmente LLM_MODEL/LLM_BASE_URL).',
    );
  }
  return adapter;
}
