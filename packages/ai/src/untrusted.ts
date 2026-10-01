const INJECTION_PATTERNS = [
  /ignore previous instructions/gi,
  /ignore as instruções/gi,
  /você agora é/gi,
  /you are now/gi,
  /revelar o prompt/gi,
  /system prompt/gi,
];

export const INSTRUCTION_REMOVED = '[instrução-removida]';

export type UntrustedOrigin =
  | 'user'
  | 'tool'
  | 'fact'
  | 'interaction'
  | 'briefing'
  | 'episode'
  | 'playbook'
  | 'document'
  | 'media'
  | 'channel'
  | 'user_profile'
  | 'company_profile'
  | 'conversation_memory';

/**
 * Strip jailbreak phrases. Does not delete the surrounding text.
 * Closing `</untrusted>` is removed so a payload cannot break the envelope.
 */
export function sanitizeInjection(text: string): string {
  let out = text;
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, INSTRUCTION_REMOVED);
  }
  return out.replace(/<\/untrusted>/gi, INSTRUCTION_REMOVED);
}

export function wrapUntrusted(text: string, origin: UntrustedOrigin, name?: string): string {
  const body = sanitizeInjection(text);
  if (origin === 'tool') {
    const toolName = name ?? 'unknown';
    return `<untrusted origin="tool" name="${toolName}">${body}</untrusted>`;
  }
  return `<untrusted origin="${origin}">${body}</untrusted>`;
}

export function wrapToolOutput(output: unknown, toolName: string): string {
  return wrapUntrusted(JSON.stringify(output ?? null), 'tool', toolName);
}
