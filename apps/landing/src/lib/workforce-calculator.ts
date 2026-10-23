export const calculatorConfig = { weeksPerMonth: 4.33, hours: { min: 1, max: 80, initial: 20 }, cost: { min: 0, initial: 35 }, percent: { min: 30, max: 90, initial: 70 } };
export function normalize(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
export function calculateSavings(hours: number, cost: number, percent: number) {
  const weeklyHours = normalize(hours, 1, 80, 20);
  const hourlyCost = normalize(cost, 0, Number.MAX_SAFE_INTEGER / 10000, 35);
  const delegablePercent = normalize(percent, 30, 90, 70);
  const monthlyHours = weeklyHours * calculatorConfig.weeksPerMonth;
  const releasedHours = monthlyHours * delegablePercent / 100;
  return { weeklyHours, hourlyCost, delegablePercent, monthlyHours, releasedHours, monthlyValue: releasedHours * hourlyCost, annualHours: releasedHours * 12 };
}
export const formatNumber = (value: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
export const formatMoney = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
