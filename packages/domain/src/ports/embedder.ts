export type TextEmbedder = {
  embed(texts: string[]): Promise<number[][]>;
};
