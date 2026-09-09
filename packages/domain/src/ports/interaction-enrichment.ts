export const INTERACTION_INTENTS = ['complaint', 'praise', 'question', 'other'] as const;
export type InteractionIntentLabel = (typeof INTERACTION_INTENTS)[number];

export type ClassifiedInteraction = {
  intent: InteractionIntentLabel;
  topics: string[];
};

export type InteractionClassifier = {
  classify(texts: string[]): Promise<ClassifiedInteraction[]>;
};

export type InteractionEmbedder = {
  embed(texts: string[]): Promise<number[][]>;
};
