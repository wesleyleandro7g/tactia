export const INTERACTION_INTENTS = [
  'complaint',
  'praise',
  'question',
  'purchase_intent',
  'cancellation_intent',
  'price_objection',
  'delivery_issue',
  'support',
  'other',
] as const;
export type InteractionIntentLabel = (typeof INTERACTION_INTENTS)[number];

export const INTERACTION_URGENCIES = ['low', 'medium', 'high'] as const;
export type InteractionUrgencyLabel = (typeof INTERACTION_URGENCIES)[number];

export type ClassifiedInteraction = {
  intent: InteractionIntentLabel;
  topics: string[];
  /** -1 (very negative) .. 1 (very positive). */
  sentiment?: number | null;
  urgency?: InteractionUrgencyLabel | null;
  /** Product name mentioned in the message, as written by the customer (resolved to an id by the service). */
  productMention?: string | null;
};

/** Product catalogue handed to the classifier so it can link mentions. */
export type ClassifierProduct = { id: string; name: string };

export type InteractionClassifier = {
  classify(texts: string[], options?: { products?: ClassifierProduct[] }): Promise<ClassifiedInteraction[]>;
};

export type InteractionEmbedder = {
  embed(texts: string[]): Promise<number[][]>;
};
