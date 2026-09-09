import { AppError, ErrorCode } from '@tactia/shared';
import type { EmbeddingAdapter } from './types';

export type OpenAIEmbeddingAdapterConfig = {
  apiKey: string;
  model: string;
  baseURL?: string;
};

type EmbeddingsResponse = {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
};

/**
 * OpenAI-compatible `/embeddings` client. Separate from the chat LLMAdapter.
 */
export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = 'openai';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(config: OpenAIEmbeddingAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseURL = (config.baseURL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    const json = (await response.json().catch(() => null)) as EmbeddingsResponse | null;
    if (!response.ok || !json?.data) {
      throw new AppError(
        ErrorCode.AI_ERROR,
        json?.error?.message ?? `Embedding request failed (${response.status})`,
      );
    }

    return json.data.map((item) => {
      if (!Array.isArray(item.embedding)) {
        throw new AppError(ErrorCode.AI_ERROR, 'Embedding response missing vector');
      }
      return item.embedding;
    });
  }
}
