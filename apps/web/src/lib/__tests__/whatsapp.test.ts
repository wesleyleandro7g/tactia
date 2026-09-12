import { describe, expect, it } from 'vitest';
import {
  evolutionSecretMatches,
  inboundSkipReason,
  parseEvolutionWebhook,
  splitWhatsappChunks,
} from '../evolution';

describe('parseEvolutionWebhook', () => {
  it('extracts a conversation text message', () => {
    const parsed = parseEvolutionWebhook({
      event: 'messages.upsert',
      apikey: 'secret',
      sender: '5511999999999@s.whatsapp.net',
      data: {
        key: {
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
          id: 'ABC123',
        },
        message: { conversation: 'Quanto vendemos este mês?' },
      },
    });
    expect(parsed).toMatchObject({
      event: 'MESSAGES_UPSERT',
      fromMe: false,
      isGroup: false,
      phone: '5511999999999',
      messageId: 'ABC123',
      text: 'Quanto vendemos este mês?',
      apikey: 'secret',
    });
    expect(inboundSkipReason(parsed!)).toBeNull();
  });

  it('reads extended text and captions', () => {
    const extended = parseEvolutionWebhook({
      event: 'MESSAGES_UPSERT',
      data: {
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false, id: '1' },
        message: { extendedTextMessage: { text: '  olá  ' } },
      },
    });
    expect(extended?.text).toBe('olá');

    const caption = parseEvolutionWebhook({
      event: 'MESSAGES_UPSERT',
      data: {
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false, id: '2' },
        message: { imageMessage: { caption: 'print da meta' } },
      },
    });
    expect(caption?.text).toBe('print da meta');
  });

  it('skips fromMe, groups and empty text', () => {
    const echo = parseEvolutionWebhook({
      event: 'MESSAGES_UPSERT',
      data: {
        key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: true, id: 'x' },
        message: { conversation: 'hi' },
      },
    });
    expect(inboundSkipReason(echo!)).toBe('fromMe');

    const group = parseEvolutionWebhook({
      event: 'MESSAGES_UPSERT',
      data: {
        key: { remoteJid: '120363@g.us', fromMe: false, id: 'y' },
        message: { conversation: 'hi' },
      },
    });
    expect(inboundSkipReason(group!)).toBe('group');

    const empty = parseEvolutionWebhook({
      event: 'MESSAGES_UPSERT',
      data: {
        key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'z' },
        message: { imageMessage: {} },
      },
    });
    expect(inboundSkipReason(empty!)).toBe('text');
  });
});

describe('splitWhatsappChunks', () => {
  it('keeps short text as a single chunk', () => {
    expect(splitWhatsappChunks('olá')).toEqual(['olá']);
    expect(splitWhatsappChunks('   ')).toEqual([]);
  });

  it('splits on newlines near the limit', () => {
    const first = 'a'.repeat(100);
    const second = 'b'.repeat(100);
    const chunks = splitWhatsappChunks(`${first}\n${second}`, 150);
    expect(chunks).toEqual([first, second]);
  });
});

describe('evolutionSecretMatches', () => {
  it('compares in constant time and rejects length mismatch', () => {
    expect(evolutionSecretMatches('abc', 'abc')).toBe(true);
    expect(evolutionSecretMatches('ab', 'abc')).toBe(false);
    expect(evolutionSecretMatches(null, 'abc')).toBe(false);
  });
});
