// Run against `astro dev`: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/workforce.browser.mjs
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { window.funnelEvents = []; window.addEventListener('tactia:funnel', event => window.funnelEvents.push(event.detail)); });
const origin = process.env.LANDING_TEST_ORIGIN || 'http://127.0.0.1:4321';
try {
  await page.goto(`${origin}/workforce?utm_source=test&gclid=google-test&fbclid=meta-test`);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
    if (width === 390) {
      assert.ok((await page.locator('[data-wf-cta="hero"]').boundingBox()).y < 700);
      await page.screenshot({ path: '/tmp/workforce-mobile.png', fullPage: true });
    }
    if (width === 1440) await page.screenshot({ path: '/tmp/workforce-desktop.png', fullPage: true });
  }
  assert.match(await page.locator('#planos').innerText(), /R\$ 500[\s\S]*Por rotina definida/);
  assert.match(await page.locator('#seguranca').innerText(), /Acessos e limites[\s\S]*Teste antes da rotina[\s\S]*Revisão quando importa/);
  assert.match(await page.locator('.wf-report').innerText(), /SIMULAÇÃO · NÚMEROS FICTÍCIOS/);
  assert.equal(await page.locator('[data-result="hours"]').textContent(), '61');
  await page.locator('#wf-hours').fill('40');
  await page.locator('#wf-hours').press('Tab');
  assert.equal(await page.locator('[data-result="hours"]').textContent(), '121');
  await page.locator('#wf-cost').fill('-5');
  await page.locator('#wf-cost').press('Tab');
  assert.equal(await page.locator('#wf-cost').inputValue(), '0');
  await page.locator('#wf-cost').fill('35');
  await page.locator('#wf-cost').press('Tab');
  await page.locator('#wf-percent').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-percent-label]').textContent(), '71%');
  await page.locator('[data-wf-cta="calculator"]').click();
  assert.match(await page.locator('[name="diagnosis"]').inputValue(), /40 horas\/semana.*71%/);
  await page.locator('[data-faq="1"] summary').click();
  await page.waitForFunction(() => window.funnelEvents.some(event => event.event === 'workforce_faq_open'));
  await page.locator('.wf-flow__toggle').click();
  assert.equal(await page.locator('[data-wf-flow]').getAttribute('data-motion'), 'paused');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.wf-flow__source').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  let payload;
  await page.route('**/api/v1/consultation-leads', async route => { payload = route.request().postDataJSON(); await route.fulfill({ json: { data: { received: true } } }); });
  await page.locator('#workforce-form-name').fill('Teste de interface');
  await page.locator('#workforce-form-company').fill('Empresa de teste');
  await page.locator('#workforce-form-email').fill('teste@example.com');
  await page.locator('#workforce-form-whatsapp').fill('11999999999');
  await page.locator('#workforce-form-consent').check();
  await page.locator('#workforce-form button[type="submit"]').click();
  await page.locator('.lead-form__success').waitFor({ state: 'visible' });
  assert.deepEqual(payload.attribution, { utm_source: 'test', gclid: 'google-test', fbclid: 'meta-test' });
  assert.match(payload.context, /40 horas\/semana.*71%/);
  assert.match(payload.context, /não representa economia financeira garantida/);
  const events = await page.evaluate(() => window.funnelEvents.map(event => event.event));
  for (const expected of ['workforce_cta_click', 'workforce_calculator_interaction', 'workforce_calculator_cta', 'workforce_faq_open', 'workforce_form_start', 'workforce_form_submit']) assert.ok(events.includes(expected), expected);
  assert.deepEqual(errors, []);
  console.log('PASS: responsive layouts, price, control, illustrative proof, calculator, CTA summary, FAQ, motion, attribution, mocked contact submission, analytics, no page errors.');
} finally { await browser.close(); }
