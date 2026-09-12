import {
  INTERACTION_INTENTS,
  INTERACTION_URGENCIES,
  type ClassifiedInteraction,
  type ClassifierProduct,
  type InteractionClassifier,
  type InteractionIntentLabel,
  type InteractionUrgencyLabel,
} from '@tactia/domain';
import type { LLMAdapter } from '../types';

const SYSTEM_PROMPT = `Você classifica mensagens de clientes (WhatsApp, e-mail, notas) para um sistema de inteligência comercial.
Responda APENAS um JSON array, um objeto por mensagem, na mesma ordem, no formato:
[{"intent":"...","topics":["tema curto"],"sentiment":0.0,"urgency":"low|medium|high","product":"nome do produto ou null"}]

Intents possíveis (escolha UMA, a mais específica):
- complaint: reclamação ou insatisfação genérica (qualidade, atendimento).
- delivery_issue: problema de entrega/prazo/extravio (prevalece sobre complaint).
- price_objection: acha caro, pede desconto, compara preço com concorrente.
- cancellation_intent: quer cancelar, devolver, encerrar contrato, não renovar.
- purchase_intent: quer comprar, pede orçamento, pergunta disponibilidade para comprar, quer renovar/ampliar.
- support: dúvida técnica ou pedido de ajuda para usar o produto/serviço.
- question: dúvida comercial genérica (horário, formas de pagamento, como funciona).
- praise: elogio, agradecimento.
- other: nenhuma das anteriores (spam, mensagem interna, saudação).

Regras:
- topics: no máximo 5 tags curtas em português (ex.: "atraso", "preço", "qualidade"), sem frases.
- sentiment: número entre -1 (muito negativo) e 1 (muito positivo); 0 é neutro.
- urgency: high se exige resposta hoje (cancelamento, cliente irritado, venda quente); medium se pede resposta em poucos dias; low caso contrário.
- product: se a mensagem menciona um produto da lista fornecida, devolva o nome EXATO da lista; caso contrário null.
- Sem markdown, sem texto fora do JSON.`;

function parseIntent(value: unknown): InteractionIntentLabel {
  const text = String(value ?? '').toLowerCase();
  return (INTERACTION_INTENTS as readonly string[]).includes(text)
    ? (text as InteractionIntentLabel)
    : 'other';
}

function parseUrgency(value: unknown): InteractionUrgencyLabel | null {
  const text = String(value ?? '').toLowerCase();
  return (INTERACTION_URGENCIES as readonly string[]).includes(text)
    ? (text as InteractionUrgencyLabel)
    : null;
}

function parseSentiment(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(-1, Math.min(1, Math.round(num * 100) / 100));
}

function parseProduct(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length === 0 || text.toLowerCase() === 'null' ? null : text.slice(0, 200);
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

type RawClassification = {
  intent?: unknown;
  topics?: unknown;
  sentiment?: unknown;
  urgency?: unknown;
  product?: unknown;
};

export class LlmInteractionClassifier implements InteractionClassifier {
  constructor(private readonly llm: LLMAdapter) {}

  async classify(
    texts: string[],
    options: { products?: ClassifierProduct[] } = {},
  ): Promise<ClassifiedInteraction[]> {
    if (texts.length === 0) return [];

    const numbered = texts.map((text, index) => `${index + 1}. ${text.slice(0, 2000)}`).join('\n\n');
    const products = (options.products ?? []).slice(0, 150);
    const catalogue =
      products.length > 0
        ? `Produtos conhecidos (use o nome exato): ${products.map((p) => p.name).join(' | ')}\n\n`
        : '';
    const completion = await this.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `${catalogue}Mensagens:\n${numbered}` }],
      temperature: 0,
      maxOutputTokens: 1600,
    });

    const parsed = extractJsonArray(completion.text);
    if (!Array.isArray(parsed)) {
      throw new Error('Classifier JSON is not an array');
    }

    return texts.map((_, index) => {
      const item = parsed[index] as RawClassification | undefined;
      return {
        intent: parseIntent(item?.intent),
        topics: parseTopics(item?.topics),
        sentiment: parseSentiment(item?.sentiment),
        urgency: parseUrgency(item?.urgency),
        productMention: parseProduct(item?.product),
      };
    });
  }
}

type KeywordRule = {
  intent: InteractionIntentLabel;
  pattern: RegExp;
  topic: string;
  sentiment: number;
  urgency: InteractionUrgencyLabel;
};

/** Order matters: the first matching rule wins (specific before generic). */
const KEYWORD_RULES: KeywordRule[] = [
  {
    intent: 'cancellation_intent',
    pattern: /cancel|devolu|devolver|estorn|encerrar|n[aã]o quero mais|n[aã]o vou renovar/,
    topic: 'cancelamento',
    sentiment: -0.7,
    urgency: 'high',
  },
  {
    intent: 'delivery_issue',
    pattern: /atras|n[aã]o chegou|extravi|entrega|prazo|rastreio|transportadora/,
    topic: 'entrega',
    sentiment: -0.5,
    urgency: 'medium',
  },
  {
    intent: 'price_objection',
    pattern: /caro|desconto|pre[cç]o|mais barato|concorrente|or[cç]amento alto/,
    topic: 'preco',
    sentiment: -0.3,
    urgency: 'medium',
  },
  {
    intent: 'complaint',
    pattern: /reclam|quebr|defeito|insatis|p[eé]ssim|horr[ií]vel|absurdo|decepcion/,
    topic: 'reclamacao',
    sentiment: -0.7,
    urgency: 'high',
  },
  {
    intent: 'purchase_intent',
    pattern: /quero comprar|fechar|tem em estoque|dispon[ií]vel|or[cç]amento|proposta|renovar|contratar|pedido/,
    topic: 'compra',
    sentiment: 0.4,
    urgency: 'high',
  },
  {
    intent: 'support',
    pattern: /n[aã]o funciona|erro|ajuda|configurar|instalar|suporte|acesso|senha/,
    topic: 'suporte',
    sentiment: -0.2,
    urgency: 'medium',
  },
  {
    intent: 'praise',
    pattern: /obrigad|excelent|ótim|otim|parab[eé]ns|adorei|maravilh|recomendo/,
    topic: 'elogio',
    sentiment: 0.8,
    urgency: 'low',
  },
  {
    intent: 'question',
    pattern: /\?|como |quando |onde |quanto |qual /,
    topic: 'duvida',
    sentiment: 0,
    urgency: 'low',
  },
];

export class KeywordInteractionClassifier implements InteractionClassifier {
  async classify(
    texts: string[],
    options: { products?: ClassifierProduct[] } = {},
  ): Promise<ClassifiedInteraction[]> {
    const products = options.products ?? [];
    return texts.map((text) => {
      const lower = text.toLowerCase();
      const product =
        [...products]
          .sort((a, b) => b.name.length - a.name.length)
          .find((p) => p.name.length >= 4 && lower.includes(p.name.toLowerCase()))?.name ?? null;
      const rule = KEYWORD_RULES.find((candidate) => candidate.pattern.test(lower));
      if (!rule) {
        return { intent: 'other', topics: [], sentiment: 0, urgency: 'low', productMention: product };
      }
      return {
        intent: rule.intent,
        topics: [rule.topic],
        sentiment: rule.sentiment,
        urgency: rule.urgency,
        productMention: product,
      };
    });
  }
}
