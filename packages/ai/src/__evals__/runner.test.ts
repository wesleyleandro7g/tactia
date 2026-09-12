import { describe, expect, it } from 'vitest';
import { cases } from './cases';
import { runEvalCase } from './harness';

describe.each(cases)('E14 $id', (evalCase) => {
  it(`E14: ${evalCase.id}`, async () => {
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
      expect(answer.guardrail).toBe(evalCase.expect.guardrail);
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
