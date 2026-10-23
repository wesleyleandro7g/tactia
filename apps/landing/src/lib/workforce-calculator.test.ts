import { test } from 'vitest';
import assert from 'node:assert/strict';
import { calculateSavings, formatMoney } from './workforce-calculator';
test('keeps full precision until presentation', () => {
  const result = calculateSavings(20, 35, 70);
  assert.ok(Math.abs(result.monthlyHours - 86.6) < 1e-10);
  assert.ok(Math.abs(result.releasedHours - 60.62) < 1e-10);
  assert.ok(Math.abs(result.monthlyValue - 2121.7) < 1e-10);
  assert.ok(Math.abs(result.annualHours - 727.44) < 1e-10);
  assert.match(formatMoney(result.monthlyValue), /2\.122/);
});
test('accepts zero cost and fractional hourly rates', () => {
  assert.equal(calculateSavings(10, 0, 50).monthlyValue, 0);
  assert.ok(Math.abs(calculateSavings(10, 12.5, 50).monthlyValue - 270.625) < 1e-10);
});
test('bounds negative and out-of-range inputs', () => {
  assert.equal(calculateSavings(-10, -20, 0).weeklyHours, 1);
  assert.equal(calculateSavings(-10, -20, 0).hourlyCost, 0);
  assert.equal(calculateSavings(90, 35, 100).weeklyHours, 80);
  assert.equal(calculateSavings(90, 35, 100).delegablePercent, 90);
});
test('invalid numbers fall back to safe defaults', () => {
  assert.deepEqual(calculateSavings(NaN, Infinity, NaN), calculateSavings(20, 35, 70));
  assert.ok(Number.isFinite(calculateSavings(80, Number.MAX_VALUE, 90).monthlyValue));
});
