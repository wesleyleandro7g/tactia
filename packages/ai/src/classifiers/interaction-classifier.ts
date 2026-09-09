import {
  INTERACTION_INTENTS,
  type ClassifiedInteraction,
  type InteractionClassifier,
  type InteractionIntentLabel,
} from '@tactia/domain';
import type { LLMAdapter } from '../types';

const SYSTEM_PROMPT = `Você classifica mensagens de clientes (WhatsApp, e-mail, notas).
Responda APENAS um JSON array, um objeto por mensagem, na mesma ordem, no formato:
[{"intent":"complaint|praise|question|other","topics":["tema curto"]}]
Regras:
- intent: complaint (reclamação/insatisfação), praise (elogio), question (dúvida), other.
- topics: no máximo 5 tags curtas em português, sem frases.
- Sem markdown, sem texto fora do JSON.`;

function parseIntent(value: unknown): InteractionIntentLabel {
  const text = String(value ?? '').toLowerCase();
  return (INTERACTION_INTENTS as readonly string[]).includes(text)
    ? (text as InteractionIntentLabel)
    : 'other';
}

function parseTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0)
    .slice(0, 5);
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Classifier response is not a JSON array');
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

export class LlmInteractionClassifier implements InteractionClassifier {
  constructor(private readonly llm: LLMAdapter) {}

  async classify(texts: string[]): Promise<ClassifiedInteraction[]> {
    if (texts.length === 0) return [];

    const numbered = texts.map((text, index) => `${index + 1}. ${text.slice(0, 2000)}`).join('\n\n');
    const completion = await this.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: numbered }],
      temperature: 0,
      maxOutputTokens: 800,
    });

    const parsed = extractJsonArray(completion.text);
    if (!Array.isArray(parsed)) {
      throw new Error('Classifier JSON is not an array');
    }

    return texts.map((_, index) => {
      const item = parsed[index] as { intent?: unknown; topics?: unknown } | undefined;
      return {
        intent: parseIntent(item?.intent),
        topics: parseTopics(item?.topics),
      };
    });
  }
}

export class KeywordInteractionClassifier implements InteractionClassifier {
  async classify(texts: string[]): Promise<ClassifiedInteraction[]> {
    return texts.map((text) => {
      const lower = text.toLowerCase();
      if (/reclam|atras|quebr|cancel|insatis|p[eé]ssim|horr[ií]vel/.test(lower)) {
        return { intent: 'complaint', topics: ['reclamacao'] };
      }
      if (/obrigad|excelent|ótim|otim|parab[eé]ns|adorei/.test(lower)) {
        return { intent: 'praise', topics: ['elogio'] };
      }
      if (/\?|como |quando |onde |quanto /.test(lower)) {
        return { intent: 'question', topics: ['duvida'] };
      }
      return { intent: 'other', topics: [] };
    });
  }
}
