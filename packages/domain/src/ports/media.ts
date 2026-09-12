export type VisionClassification =
  | 'invoice'
  | 'receipt'
  | 'conversation_screenshot'
  | 'policy'
  | 'other';

export type VisionExtractor = {
  extract(input: { bytes: Buffer; mime: string }): Promise<{
    text: string;
    classification: VisionClassification;
    fields?: Record<string, string>;
  }>;
};

export type AudioTranscriber = {
  transcribe(input: { bytes: Buffer; mime: string }): Promise<{ text: string; language?: string }>;
};

export const VISION_UNAVAILABLE = 'VISION_UNAVAILABLE';
export const STT_UNAVAILABLE = 'STT_UNAVAILABLE';
