import { calculateSavings, formatMoney, formatNumber } from '../lib/workforce-calculator';
const emit = (event: string, detail: Record<string, string> = {}) => window.dispatchEvent(new CustomEvent('tactia:funnel', { detail: { event, ...detail } }));
const hours = document.querySelector<HTMLInputElement>('#wf-hours')!;
const range = document.querySelector<HTMLInputElement>('#wf-hours-range')!;
const cost = document.querySelector<HTMLInputElement>('#wf-cost')!;
const percent = document.querySelector<HTMLInputElement>('#wf-percent')!;
let result = calculateSavings(20, 35, 70);
let attachEstimate = false;
function summary() {
  return `Estimativa ilustrativa: ${result.weeklyHours} horas/semana; ${formatMoney(result.hourlyCost)}/hora; ${result.delegablePercent}% delegável; aproximadamente ${formatNumber(result.releasedHours)} horas mensais potencialmente liberadas.`;
}
function updateContact() {
  if (!attachEstimate) return;
  document.querySelector<HTMLInputElement>('#workforce-form [name="diagnosis"]')!.value = summary();
  const preview = document.querySelector<HTMLElement>('[data-calculator-summary]')!;
  preview.hidden = false;
  preview.textContent = summary();
}
function update(source: HTMLInputElement) {
  if (source === range) hours.value = range.value;
  result = calculateSavings(hours.valueAsNumber, cost.valueAsNumber, percent.valueAsNumber);
  range.value = String(result.weeklyHours);
  document.querySelector('[data-percent-label]')!.textContent = `${result.delegablePercent}%`;
  document.querySelector<HTMLElement>('[data-bar-share]')!.style.width = `${result.delegablePercent}%`;
  document.querySelector('[data-bar-label]')!.textContent = `${result.delegablePercent}%`;
  const outputs = { hours: formatNumber(result.releasedHours), money: formatMoney(result.monthlyValue), annual: formatNumber(result.annualHours) };
  Object.entries(outputs).forEach(([key, value]) => { document.querySelector(`[data-result="${key}"]`)!.textContent = value; });
  updateContact();
}
[hours, range, cost, percent].forEach(input => {
  input.addEventListener('input', () => update(input));
  input.addEventListener('change', () => {
    update(input);
    hours.value = String(result.weeklyHours);
    cost.value = String(result.hourlyCost);
    percent.value = String(result.delegablePercent);
    emit('workforce_calculator_interaction', { control: input.id });
  });
});
document.querySelectorAll<HTMLElement>('[data-wf-cta]').forEach(link => link.addEventListener('click', () => {
  const placement = link.dataset.wfCta!;
  emit('workforce_cta_click', { placement });
  if (placement === 'calculator') {
    attachEstimate = true;
    updateContact();
    emit('workforce_calculator_cta', { placement });
  }
}));
document.querySelectorAll<HTMLDetailsElement>('[data-faq]').forEach(faq => faq.addEventListener('toggle', () => {
  if (faq.open) emit('workforce_faq_open', { question_id: faq.dataset.faq! });
}));
const flow = document.querySelector<HTMLElement>('[data-wf-flow]');
const flowToggle = document.querySelector<HTMLButtonElement>('.wf-flow__toggle');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let flowVisible = true;
let userPaused = false;
function updateFlowMotion() {
  if (!flow || !flowToggle) return;
  if (reducedMotion.matches) {
    flow.removeAttribute('data-motion');
    flowToggle.hidden = true;
    return;
  }
  flowToggle.hidden = false;
  flow.dataset.motion = !userPaused && flowVisible && !document.hidden ? 'playing' : 'paused';
  flowToggle.setAttribute('aria-pressed', String(userPaused));
  flowToggle.setAttribute('aria-label', userPaused ? 'Retomar animação do fluxo' : 'Pausar animação do fluxo');
  flowToggle.innerHTML = `<span aria-hidden="true">${userPaused ? '▶' : 'Ⅱ'}</span> ${userPaused ? 'Retomar animação' : 'Pausar animação'}`;
}
flowToggle?.addEventListener('click', () => { userPaused = !userPaused; updateFlowMotion(); });
document.addEventListener('visibilitychange', updateFlowMotion);
reducedMotion.addEventListener('change', updateFlowMotion);
if (flow && 'IntersectionObserver' in window) {
  const flowObserver = new IntersectionObserver(([entry]) => { flowVisible = entry.isIntersecting; updateFlowMotion(); }, { threshold: .05 });
  flowObserver.observe(flow);
}
updateFlowMotion();
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('wf-revealed'); observer.unobserve(entry.target); }
  }), { threshold: .1 });
  document.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));
}
emit('workforce_page_view');
