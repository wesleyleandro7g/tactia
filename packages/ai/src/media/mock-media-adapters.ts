import type { AudioTranscriber, VisionExtractor, VisionClassification } from '@tactia/domain';

/**
 * Deterministic vision for tests. Classification is inferred from UTF-8 bytes
 * (or a leading magic comment), never from a live model.
 */
export class MockVisionExtractor implements VisionExtractor {
  async extract(input: { bytes: Buffer; mime: string }) {
    const text = input.bytes.toString('utf8');
    const lower = text.toLowerCase();
    let classification: VisionClassification = 'other';
    const fields: Record<string, string> = {};

    if (/invoice|nota fiscal|nf-e|nfe/.test(lower)) {
      classification = 'invoice';
      const amount = text.match(/amount[=:]\s*([0-9.,]+)/i)?.[1];
      const date = text.match(/date[=:]\s*([0-9-]+)/i)?.[1];
      const customerName = text.match(/customer[=:]\s*(.+)/i)?.[1]?.trim();
      if (amount) fields.amount = amount;
      if (date) fields.date = date;
      if (customerName) fields.customerName = customerName;
    } else if (/receipt|recibo|cupom/.test(lower)) {
      classification = 'receipt';
      const amount = text.match(/amount[=:]\s*([0-9.,]+)/i)?.[1];
      if (amount) fields.amount = amount;
    } else if (/screenshot|whatsapp|conversa|print/.test(lower)) {
      classification = 'conversation_screenshot';
    } else if (/pol[ií]tica|policy|playbook|contrato/.test(lower)) {
      classification = 'policy';
    }

    return { text: text.trim() || `imagem ${input.mime}`, classification, fields };
  }
}

export class MockAudioTranscriber implements AudioTranscriber {
  async transcribe(input: { bytes: Buffer; mime: string }) {
    const asText = input.bytes.toString('utf8').trim();
    return {
      text: asText.length > 0 && !asText.includes('\0') ? asText : 'Transcrição de visita comercial.',
      language: 'pt',
    };
  }
}
