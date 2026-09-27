import { describe, expect, it } from 'vitest';
import { summarizeBrowserEvaluation, type BrowserEvalCaseResult } from '../server/browser/evaluation';

function successful(name: string, toolCalls = 4): BrowserEvalCaseResult {
  return { name, toolCalls, validToolCalls: toolCalls, success: true, waitLoop: false };
}

describe('Browser Agent evaluation gates', () => {
  it('passes the balanced P0 acceptance thresholds', () => {
    const cases = Array.from({ length: 9 }, (_, index) => successful(`menu-${index}`));
    cases.push({
      name: 'frozen-spa',
      toolCalls: 4,
      validToolCalls: 3,
      success: false,
      waitLoop: false,
      terminalCode: 'NO_PROGRESS',
    });

    const report = summarizeBrowserEvaluation(cases);

    expect(report.validToolCallRate).toBe(0.975);
    expect(report.fixtureSuccessRate).toBe(0.9);
    expect(report.diagnosableFailureRate).toBe(1);
    expect(report.waitLoops).toBe(0);
    expect(report.passed).toBe(true);
  });

  it('fails when waits loop or failures are generic', () => {
    const report = summarizeBrowserEvaluation([
      successful('menu'),
      {
        name: 'broken',
        toolCalls: 3,
        validToolCalls: 2,
        success: false,
        waitLoop: true,
        terminalCode: 'AI_ERROR',
      },
    ]);

    expect(report.gates).toEqual({
      validToolCalls: false,
      fixtureSuccess: false,
      noWaitLoops: false,
      diagnosableFailures: false,
    });
    expect(report.passed).toBe(false);
  });
});
