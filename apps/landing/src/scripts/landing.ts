type FunnelEvent = 'cta_click' | 'form_start' | 'lead_submitted' | 'calendar_open';
function track(event: FunnelEvent, location?: string) {
  // Integration hook only: no external analytics and no contact data in events.
  window.dispatchEvent(
    new CustomEvent('tactia:funnel', { detail: { event, ...(location ? { location } : {}) } }),
  );
}

const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
if (!motion.matches && 'IntersectionObserver' in window) {
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          reveal.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.1 },
  );
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((element) => {
    // Never hide content already in the viewport, including deep-linked content.
    if (element.getBoundingClientRect().top > window.innerHeight) {
      element.classList.add('reveal-ready');
      reveal.observe(element);
    }
  });
}

const section = document.querySelector<HTMLElement>('#consultoria')!;
const mobileCta = document.querySelector<HTMLElement>('#mobile-cta')!;
if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    mobileCta.classList.toggle('is-hidden', entries[0]?.isIntersecting ?? false);
  }).observe(section);
} else {
  mobileCta.hidden = true;
}

document.querySelectorAll<HTMLAnchorElement>('[data-cta]').forEach((link) => {
  link.addEventListener('click', () => track('cta_click', link.dataset.cta));
});

const form = document.querySelector<HTMLFormElement>('#consultation-form')!;
const fields = document.querySelector<HTMLFieldSetElement>('#form-fields')!;
const errorMessage = document.querySelector<HTMLElement>('#form-error')!;
const submitLabel = document.querySelector<HTMLElement>('#submit-label')!;
const success = document.querySelector<HTMLElement>('#form-success')!;
const calendar = document.querySelector<HTMLAnchorElement>('#calendar-link')!;
fields.disabled = false;
let started = false;
let submitting = false;
let submissionId: string | undefined;
form.addEventListener('focusin', () => {
  if (!started) {
    started = true;
    track('form_start');
  }
});
calendar.addEventListener('click', () => track('calendar_open'));

function clearErrors() {
  form.querySelectorAll('[aria-invalid]').forEach((field) => field.removeAttribute('aria-invalid'));
  form.querySelectorAll<HTMLElement>('.field-error').forEach((error) => {
    error.hidden = true;
    error.textContent = '';
  });
  errorMessage.hidden = true;
  errorMessage.textContent = '';
}
function fieldError(name: string, message: string) {
  const field = form.elements.namedItem(name);
  const error = document.getElementById(`${name}-error`);
  if (field instanceof HTMLElement && error) {
    field.setAttribute('aria-invalid', 'true');
    error.textContent = message;
    error.hidden = false;
  }
}
function focusFirstError() {
  form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}
form.addEventListener('input', (event) => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
  field.removeAttribute('aria-invalid');
  const error = document.getElementById(`${field.name}-error`);
  if (error) error.hidden = true;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitting) return;
  clearErrors();
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
  for (const name of ['name', 'company', 'email', 'whatsapp', 'context', 'website'])
    data[name] = (data[name] || '').trim();
  if (data.name!.length < 2) fieldError('name', 'Informe seu nome.');
  if (data.company!.length < 2) fieldError('company', 'Informe o nome da empresa.');
  const email = form.elements.namedItem('email') as HTMLInputElement;
  if (!data.email || !email.validity.valid) fieldError('email', 'Informe um e-mail válido.');
  const digits = data.whatsapp!.replace(/\D/g, '');
  if (!/^[+\d\s().-]+$/.test(data.whatsapp!) || digits.length < 10 || digits.length > 15)
    fieldError('whatsapp', 'Informe um telefone válido, com DDD.');
  if (form.querySelector('[aria-invalid="true"]')) {
    focusFirstError();
    return;
  }

  submitting = true;
  fields.disabled = true;
  form.setAttribute('aria-busy', 'true');
  submitLabel.textContent = 'Salvando seu contato…';
  try {
    submissionId ??= crypto.randomUUID();
    const params = new URLSearchParams(window.location.search);
    const attribution: Record<string, string> = {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const value = params.get(key)?.trim().slice(0, 200);
      if (value) attribution[key] = value;
    }
    const response = await fetch('/api/v1/consultation-leads', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        submissionId,
        ...(Object.keys(attribution).length ? { attribution } : {}),
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => null);
    if (response.status === 400 && body?.error?.details?.fieldErrors) {
      for (const [name, messages] of Object.entries(body.error.details.fieldErrors)) {
        if (Array.isArray(messages) && typeof messages[0] === 'string')
          fieldError(name, messages[0]);
      }
    }
    if (!response.ok || !body?.data?.received) {
      throw new Error(
        response.status === 429
          ? 'Muitas tentativas. Aguarde alguns minutos antes de enviar novamente.'
          : 'Não conseguimos salvar seu contato. Confira os dados e tente novamente.',
      );
    }
    document.querySelector<HTMLElement>('#form-content')!.hidden = true;
    success.hidden = false;
    document.querySelector<HTMLElement>('#success-title')!.focus();
    track('lead_submitted');
  } catch (error) {
    errorMessage.textContent =
      error instanceof Error && error.name === 'Error'
        ? error.message
        : 'Não conseguimos confirmar o envio. Verifique sua conexão e tente novamente; seus dados continuam no formulário.';
    errorMessage.hidden = false;
  } finally {
    submitting = false;
    fields.disabled = false;
    form.removeAttribute('aria-busy');
    submitLabel.textContent = 'Continuar para escolher horário';
    focusFirstError();
  }
});
