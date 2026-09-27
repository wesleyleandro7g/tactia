import { describe, expect, it } from 'vitest';
import type { LLMAdapter, LLMCompletion } from '@tactia/ai';
import {
  classifyWhatsappMessage,
  confirmationMessage,
  detectCancellation,
} from '../whatsapp-agent';

function fakeLlm(text: string, onCall?: () => void): LLMAdapter {
  return {
    provider: 'mock',
    model: 'mock',
    async complete(): Promise<LLMCompletion> {
      onCall?.();
      return { text, toolCalls: [], finishReason: 'stop' };
    },
  };
}

function throwingLlm(): LLMAdapter {
  return {
    provider: 'mock',
    model: 'mock',
    async complete(): Promise<LLMCompletion> {
      throw new Error('llm down');
    },
  };
}

describe('detectCancellation', () => {
  it('matches common cancellation phrasings', () => {
    for (const text of ['cancela', 'cancelar', 'para', 'pare', 'esquece', 'aborta', 'deixa pra lá', '/cancelar']) {
      expect(detectCancellation(text)).toBe(true);
    }
  });

  it('does not match normal requests', () => {
    for (const text of ['quanto vendemos ontem?', 'cadastra a tarefa X', 'cria um relatório']) {
      expect(detectCancellation(text)).toBe(false);
    }
  });
});

describe('classifyWhatsappMessage', () => {
  it('routes a read question', async () => {
    const intent = await classifyWhatsappMessage(
      fakeLlm('{"kind":"read","plan":null}'),
      'quanto vendemos este mês?',
    );
    expect(intent.kind).toBe('read');
    expect(intent.plan).toBeNull();
  });

  it('routes an operation with a plan', async () => {
    const intent = await classifyWhatsappMessage(
      fakeLlm('{"kind":"operation","plan":"Vou criar a tarefa de ligar para o cliente ABC"}'),
      'cadastra a tarefa de ligar para o cliente ABC',
    );
    expect(intent.kind).toBe('operation');
    expect(intent.plan).toContain('tarefa');
  });

  it('parses JSON embedded in extra prose', async () => {
    const intent = await classifyWhatsappMessage(
      fakeLlm('Claro: {"kind":"operation","plan":"Vou enviar o e-mail"} pronto'),
      'manda um email pro fornecedor',
    );
    expect(intent.kind).toBe('operation');
  });

  it('falls back to a heuristic when the LLM throws', async () => {
    const op = await classifyWhatsappMessage(throwingLlm(), 'cadastra a tarefa X');
    expect(op.kind).toBe('operation');
    const read = await classifyWhatsappMessage(throwingLlm(), 'qual foi a receita?');
    expect(read.kind).toBe('read');
  });

  it('falls back to a heuristic on unparseable output', async () => {
    const intent = await classifyWhatsappMessage(fakeLlm('não sei responder em json'), 'envie o relatório');
    expect(intent.kind).toBe('operation');
  });
});

describe('confirmationMessage', () => {
  it('uses the plan when present', () => {
    expect(confirmationMessage('Vou criar a tarefa X')).toBe(
      'Entendido! Vou criar a tarefa X e te retorno quando finalizar.',
    );
  });

  it('has a default when no plan', () => {
    expect(confirmationMessage(null)).toContain('Vou cuidar disso');
  });
});
