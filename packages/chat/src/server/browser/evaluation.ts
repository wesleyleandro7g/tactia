export type BrowserEvalCaseResult = {
  name: string;
  toolCalls: number;
  validToolCalls: number;
  success: boolean;
  waitLoop: boolean;
  /** Safe terminal code; absent only for successful cases. */
  terminalCode?: string;
};

export type BrowserEvalThresholds = {
  minValidToolCallRate: number;
  minFixtureSuccessRate: number;
  maxWaitLoops: number;
  minDiagnosableFailureRate: number;
};

export const BALANCED_BROWSER_THRESHOLDS: BrowserEvalThresholds = {
  minValidToolCallRate: 0.95,
  minFixtureSuccessRate: 0.9,
  maxWaitLoops: 0,
  minDiagnosableFailureRate: 0.95,
};

export function summarizeBrowserEvaluation(
  cases: BrowserEvalCaseResult[],
  thresholds: BrowserEvalThresholds = BALANCED_BROWSER_THRESHOLDS,
) {
  const toolCalls = cases.reduce((sum, item) => sum + item.toolCalls, 0);
  const validToolCalls = cases.reduce((sum, item) => sum + item.validToolCalls, 0);
  const successes = cases.filter((item) => item.success).length;
  const failures = cases.filter((item) => !item.success);
  const diagnosableFailures = failures.filter(
    (item) => item.terminalCode && !['AI_ERROR', 'BROWSER_RUNTIME_ERROR', 'UNKNOWN'].includes(item.terminalCode),
  ).length;
  const waitLoops = cases.filter((item) => item.waitLoop).length;
  const validToolCallRate = toolCalls ? validToolCalls / toolCalls : 1;
  const fixtureSuccessRate = cases.length ? successes / cases.length : 0;
  const diagnosableFailureRate = failures.length ? diagnosableFailures / failures.length : 1;
  const gates = {
    validToolCalls: validToolCallRate >= thresholds.minValidToolCallRate,
    fixtureSuccess: fixtureSuccessRate >= thresholds.minFixtureSuccessRate,
    noWaitLoops: waitLoops <= thresholds.maxWaitLoops,
    diagnosableFailures: diagnosableFailureRate >= thresholds.minDiagnosableFailureRate,
  };
  return {
    cases: cases.length,
    toolCalls,
    validToolCalls,
    successes,
    failures: failures.length,
    waitLoops,
    validToolCallRate,
    fixtureSuccessRate,
    diagnosableFailureRate,
    gates,
    passed: Object.values(gates).every(Boolean),
  };
}
