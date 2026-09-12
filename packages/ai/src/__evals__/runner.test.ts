import { describe, expect, it } from 'vitest';
import { cases } from './cases';
import { runEvalCase } from './harness';

describe.each(cases)('$id', (evalCase) => {
  it(evalCase.id.startsWith('E16:') ? evalCase.id : `E14: ${evalCase.id}`, async () => {
    const answer = await runEvalCase(evalCase);
    const names = answer.toolCalls.map((call) => call.name);

    if (evalCase.expect?.tools) {
      expect(names.length).toBeGreaterThan(0);
      for (const tool of evalCase.expect.tools) {
        expect(names).toContain(tool);
      }
    }
    if (evalCase.expect?.sourcesNonEmpty) {
      expect(answer.sources.length).toBeGreaterThan(0);
    }
    if (evalCase.expect?.guardrail) {
      const expected = evalCase.expect.guardrail;
      if (Array.isArray(expected)) {
        expect(expected).toContain(answer.guardrail);
      } else {
        expect(answer.guardrail).toBe(expected);
      }
    }
    for (const token of evalCase.expect?.forbidden ?? []) {
      expect(answer.content).not.toContain(token);
    }
    for (const token of evalCase.expect?.required ?? []) {
      expect(answer.content).toContain(token);
    }
    if (evalCase.expect?.noProposals) {
      expect(answer.proposals).toHaveLength(0);
      expect(answer.toolCalls[0]?.error).toBeTruthy();
    }
  });
});
