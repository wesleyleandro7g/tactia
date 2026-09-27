import type { LLMAdapter } from '@tactia/ai';
import { logger } from '@tactia/shared';

/**
 * Read vs. operation routing for the WhatsApp agent.
 *
 * - `read`: a question / lookup the assistant can answer synchronously.
 * - `operation`: a request that changes state (create task, send email, run a
 *   web action...). These are confirmed immediately and run as an async job.
 */
export type WhatsappIntent = {
  kind: 'read' | 'operation';
  /** Short first-person plan shown to the user for operations ("Vou fazer X"). */
  plan: string | null;
};

/** Cancellation intent: matched cheaply before any LLM call. */
const CANCEL_PATTERN =
  /^\s*(?:\/cancelar|cancela(?:r)?|cancelamento|parar?|pare|para\s+tudo|esquec[ae](?:r)?|abort(?:a|ar)?|deixa(?:\s+pra\s+l[áa])?|n[ãa]o\s+precisa\s+mais)\b/i;

export function detectCancellation(text: string): boolean {
  return CANCEL_PATTERN.test(text.trim());
}

/**
 * Heuristic hints that a message asks for a state-changing operation. Used as a
 * fallback when the classifier LLM is unavailable or returns garbage.
 */
const OPERATION_HINTS =
  /\b(cadastr\w*|cri[ae]\w*|crie|envi[ae]\w*|envie|mand[ae]\w*|agend\w*|marqu\w*|atualiz\w*|alter\w*|delet\w*|apagu\w*|remov\w*|acess\w*|entr[ae]\w*|execut\w*|fa[çc]a|dispar\w*|gener\w*|registr\w*)\b/i;

function heuristicIntent(text: string): WhatsappIntent {
  if (OPERATION_HINTS.test(text)) {
    return { kind: 'operation', plan: null };
  }
  return { kind: 'read', plan: null };
}

const CLASSIFIER_SYSTEM = [
  'Você classifica mensagens recebidas por WhatsApp para um assistente de negócios.',
  'Decida se a mensagem é:',
  '- "read": uma pergunta, consulta ou pedido de informação que pode ser respondido lendo dados.',
  '- "operation": um pedido para EXECUTAR uma providência que altera o estado (criar tarefa, enviar e-mail, agendar, acessar um sistema/portal, atualizar/registrar algo).',
  'Se for "operation", escreva um "plan" curto em primeira pessoa descrevendo o que você vai fazer, ex.: "Vou criar a tarefa de ligar para o cliente ABC".',
  'Responda SOMENTE com JSON válido no formato: {"kind":"read"|"operation","plan":string|null}.',
].join('\n');

/**
 * Classifies an inbound WhatsApp message. Never throws: on any error it falls
 * back to a keyword heuristic so the webhook path stays resilient.
 */
export async function classifyWhatsappMessage(
  llm: LLMAdapter,
  text: string,
): Promise<WhatsappIntent> {
  try {
    const completion = await llm.complete({
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: 'user', content: text.slice(0, 2000) }],
      temperature: 0,
      maxOutputTokens: 200,
    });
    const parsed = parseIntent(completion.text);
    if (parsed) return parsed;
    logger.warn({ operation: 'wa_classify_fallback' }, 'classifier returned unparseable output');
    return heuristicIntent(text);
  } catch (error) {
    logger.warn({ operation: 'wa_classify_error', err: error }, 'classifier failed; using heuristic');
    return heuristicIntent(text);
  }
}

function parseIntent(raw: string): WhatsappIntent | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[0]) as { kind?: unknown; plan?: unknown };
    const kind = json.kind === 'operation' ? 'operation' : json.kind === 'read' ? 'read' : null;
    if (!kind) return null;
    const plan =
      typeof json.plan === 'string' && json.plan.trim().length > 0 ? json.plan.trim().slice(0, 400) : null;
    return { kind, plan };
  } catch {
    return null;
  }
}

/** Default confirmation shown to the user while an operation runs. */
export function confirmationMessage(plan: string | null): string {
  if (plan) return `Entendido! ${plan} e te retorno quando finalizar.`;
  return 'Entendido! Vou cuidar disso e te retorno quando finalizar.';
}
