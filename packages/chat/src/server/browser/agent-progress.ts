import type { LLMMessage, LLMToolCall } from '@tactia/ai';

export type BrowserProgressStep = {
  type: string;
  target?: string;
  value?: string;
  credentialField?: string;
  url?: string;
  category: string;
  reason: string;
  seconds?: number;
};

export function credentialFillKey(step: BrowserProgressStep): string | null {
  if (step.type !== 'fill' || !step.credentialField || !step.target) return null;
  return `${step.target}:${step.credentialField}`;
}

export function browserStepKey(step: BrowserProgressStep): string | null {
  if (step.type === 'wait' || step.type === 'scroll') return null;
  return JSON.stringify({
    type: step.type,
    target: step.target,
    credentialField: step.credentialField,
    url: step.url,
    value: step.credentialField ? undefined : step.value,
  });
}

export type RepeatDecision = 'EXECUTE' | 'SKIP' | 'ABORT';

/**
 * Blocks consecutive executions of the same action fingerprint. The repeated
 * proposal is never sent to the runtime; after `maxRepeats` proposals in a row
 * the caller must stop the task as a loop.
 */
export class BrowserRepeatGuard {
  private lastKey: string | null = null;
  private repeats = 0;
  private blocked = 0;

  constructor(private readonly maxRepeats = 3) {}

  get repeatedCount() {
    return this.repeats;
  }

  /** Total repeated proposals blocked during the task (for observability). */
  get blockedTotal() {
    return this.blocked;
  }

  check(step: BrowserProgressStep): RepeatDecision {
    const key = browserStepKey(step);
    if (!key || key !== this.lastKey) return 'EXECUTE';
    this.repeats += 1;
    this.blocked += 1;
    return this.repeats >= this.maxRepeats ? 'ABORT' : 'SKIP';
  }

  /**
   * Records a step that actually reached the runtime and succeeded. `wait` and
   * `scroll` are transparent so "click X → wait → click X" is still caught.
   */
  recordSuccess(step: BrowserProgressStep) {
    const key = browserStepKey(step);
    if (!key) return;
    this.lastKey = key;
    this.repeats = 0;
  }
}

export function browserStepResultMessages(input: {
  call: LLMToolCall;
  step: BrowserProgressStep;
  label: string | null;
  status: 'SUCCEEDED' | 'SKIPPED_ALREADY_COMPLETED' | 'REJECTED_INVALID_ACTION';
  urlBefore: string;
  urlAfter: string;
  instruction?: string;
}): LLMMessage[] {
  const safeStep = input.step.credentialField
    ? { ...input.step, value: undefined }
    : input.step;
  const completedCredential = input.step.credentialField
    ? `O campo de credencial "${input.step.credentialField}" já foi preenchido neste elemento. Não repita esse preenchimento; prossiga para o próximo campo ou ação.`
    : undefined;

  return [
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ ...input.call, input: safeStep }],
    },
    {
      role: 'tool',
      toolCallId: input.call.id,
      toolName: input.call.name,
      output: {
        status: input.status,
        action: input.step.type,
        targetLabel: input.label,
        credentialField: input.step.credentialField,
        urlBefore: input.urlBefore,
        urlAfter: input.urlAfter,
        instruction: input.instruction ?? completedCredential,
      },
    },
  ];
}

const TARGETED_ACTIONS = new Set(['click', 'fill', 'select', 'check', 'hover', 'download']);

/**
 * Tool result for a call whose input did not match the schema. The model gets
 * the offending fields and retries instead of the whole task failing. Raw
 * input values are never echoed back.
 */
export function browserInvalidInputMessages(input: {
  call: LLMToolCall;
  issues: Array<{ path: PropertyKey[]; message: string }>;
  url: string;
}): LLMMessage[] {
  const fields = input.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.') || 'input'}: ${issue.message}`)
    .join('; ');
  return [
    { role: 'assistant', content: '', toolCalls: [{ ...input.call, input: {} }] },
    {
      role: 'tool',
      toolCallId: input.call.id,
      toolName: input.call.name,
      output: {
        status: 'REJECTED_INVALID_ACTION',
        urlBefore: input.url,
        urlAfter: input.url,
        instruction: `Os argumentos de ${input.call.name} são inválidos (${fields}). Corrija-os e tente novamente.`,
      },
    },
  ];
}

export function browserStepValidationError(step: BrowserProgressStep): string | null {
  if (TARGETED_ACTIONS.has(step.type) && !step.target) {
    return `A ação ${step.type} exige a referência target de um elemento do snapshot atual.`;
  }
  if (step.type === 'fill' && !step.credentialField && step.value === undefined) {
    return 'A ação fill exige value ou credentialField.';
  }
  if (step.type === 'fill' && step.credentialField && step.value !== undefined) {
    return 'A ação fill deve usar value ou credentialField, nunca ambos.';
  }
  if (step.type === 'select' && step.value === undefined) return 'A ação select exige value.';
  if (step.type === 'navigate' && !step.url) return 'A ação navigate exige url.';
  if (step.type === 'press' && !step.value) return 'A ação press exige value com a tecla.';
  if (step.type === 'wait' && (step.seconds === undefined || step.seconds < 0.25 || step.seconds > 10)) {
    return 'A ação wait exige seconds entre 0.25 e 10.';
  }
  return null;
}

export function browserStepValidationCode(step: BrowserProgressStep): string {
  if (TARGETED_ACTIONS.has(step.type) && !step.target) return 'MISSING_TARGET';
  if (step.type === 'fill' && !step.credentialField && step.value === undefined)
    return 'MISSING_VALUE';
  if (step.type === 'fill' && step.credentialField && step.value !== undefined)
    return 'AMBIGUOUS_FILL_SOURCE';
  if (step.type === 'select' && step.value === undefined) return 'MISSING_VALUE';
  if (step.type === 'navigate' && !step.url) return 'MISSING_URL';
  if (step.type === 'press' && !step.value) return 'MISSING_KEY';
  if (step.type === 'wait') return 'INVALID_WAIT';
  return 'INVALID_ACTION';
}
