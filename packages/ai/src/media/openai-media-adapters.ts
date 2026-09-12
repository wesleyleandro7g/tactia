import type { AudioTranscriber, VisionExtractor, VisionClassification } from '@tactia/domain';
import { logger } from '@tactia/shared';
import { MockAudioTranscriber, MockVisionExtractor } from './mock-media-adapters';

export type OpenAIMediaEnv = {
  LLM_PROVIDER?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_VISION_MODEL?: string;
  STT_MODEL?: string;
};

const VISION_PROMPT =
  'Classify the image as invoice, receipt, conversation_screenshot, policy, or other. ' +
  'Extract visible text and, when it is an invoice/receipt, fields amount, date, customerName. ' +
  'Reply JSON: {"text":"...","classification":"...","fields":{}}';

export class OpenAIVisionExtractor implements VisionExtractor {
  constructor(
    private readonly env: { apiKey: string; baseURL?: string; model: string },
  ) {}

  async extract(input: { bytes: Buffer; mime: string }) {
    const base = (this.env.baseURL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const dataUrl = `data:${input.mime};base64,${input.bytes.toString('base64')}`;
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.env.model,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`vision failed: ${response.status} ${body.slice(0, 200)}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? '{}';
    return parseVisionJson(content);
  }
}

export class OpenAIAudioTranscriber implements AudioTranscriber {
  constructor(
    private readonly env: { apiKey: string; baseURL?: string; model: string },
  ) {}

  async transcribe(input: { bytes: Buffer; mime: string }) {
    const base = (this.env.baseURL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const form = new FormData();
    const ext = mimeToExt(input.mime);
    form.set('file', new Blob([new Uint8Array(input.bytes)], { type: input.mime }), `audio.${ext}`);
    form.set('model', this.env.model);
    const response = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.env.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`stt failed: ${response.status} ${body.slice(0, 200)}`);
    }
    const json = (await response.json()) as { text?: string; language?: string };
    return { text: json.text ?? '', language: json.language };
  }
}

export function createVisionExtractorFromEnv(env: OpenAIMediaEnv): VisionExtractor | null {
  if (env.LLM_PROVIDER === 'mock') return new MockVisionExtractor();
  if (!env.LLM_API_KEY) return null;
  return new OpenAIVisionExtractor({
    apiKey: env.LLM_API_KEY,
    model: env.LLM_VISION_MODEL?.trim() || 'gpt-4o-mini',
    ...(env.LLM_BASE_URL ? { baseURL: env.LLM_BASE_URL } : {}),
  });
}

export function createAudioTranscriberFromEnv(env: OpenAIMediaEnv): AudioTranscriber | null {
  if (env.LLM_PROVIDER === 'mock') return new MockAudioTranscriber();
  if (!env.LLM_API_KEY) return null;
  return new OpenAIAudioTranscriber({
    apiKey: env.LLM_API_KEY,
    model: env.STT_MODEL?.trim() || 'whisper-1',
    ...(env.LLM_BASE_URL ? { baseURL: env.LLM_BASE_URL } : {}),
  });
}

function parseVisionJson(content: string): {
  text: string;
  classification: VisionClassification;
  fields?: Record<string, string>;
} {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  const slice = start >= 0 && end > start ? content.slice(start, end + 1) : '{}';
  try {
    const parsed = JSON.parse(slice) as {
      text?: string;
      classification?: string;
      fields?: Record<string, string>;
    };
    const classification = normalizeClassification(parsed.classification);
    return {
      text: parsed.text ?? content,
      classification,
      fields: parsed.fields,
    };
  } catch (error) {
    logger.warn(
      { operation: 'vision_parse', err: error instanceof Error ? error.message : String(error) },
      'vision JSON parse failed',
    );
    return { text: content, classification: 'other' };
  }
}

function normalizeClassification(value: string | undefined): VisionClassification {
  if (
    value === 'invoice' ||
    value === 'receipt' ||
    value === 'conversation_screenshot' ||
    value === 'policy' ||
    value === 'other'
  ) {
    return value;
  }
  return 'other';
}

function mimeToExt(mime: string): string {
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/wav') return 'wav';
  if (mime === 'audio/webm') return 'webm';
  if (mime === 'audio/ogg') return 'ogg';
  return 'bin';
}
