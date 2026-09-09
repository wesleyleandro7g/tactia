export type EmbeddingAdapter = {
  readonly provider: string;
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
};
