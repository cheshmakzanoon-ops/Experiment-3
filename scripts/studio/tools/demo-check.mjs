// Steam demo edition check in the real game, one boot: the Paddock Board with its FULL GAME plate,
// the locked venue and machine lists, the refusal of a locked session, the Wildcard board with
// locked plates, and the career licences page. JPEG evidence plus a JSON report on stdout.
// Usage: node scripts/studio/tools/demo-check.mjs URL OUTDIR [prefix]
//   (serve the demo with: npx vite preview --outDir dist-demo --port 4242)
// Software GL is slow (a 60 to 100 s boot); this does not start a session (the open world cannot be
// screenshotted on SwiftShader, and the session start itself is pinned by tests/demo-edition.test.ts).
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
const [url, out, prefix = 'demo'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--headless=new',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => !document.querySelector('#menu')?.hidden, null, { timeout: 600000 });
await page.waitForTimeout(2500);
const shot = async (name) => {
  const path = `${out}/${prefix}-${name}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 80 });
  console.log(`${path} ${(statSync(path).size / 1024).toFixed(0)} KB`);
};
const report = { bootSeconds: (Date.now() - t0) / 1000 };
report.title = await page.title();
report.firstRunShown = await page.evaluate(() => !!document.querySelector('#modal[open] .fr'));
const lists = () =>
  page.evaluate(() => {
    const read = (id) =>
      [...document.querySelectorAll(`#${id} option`)].map((o) => ({
        value: o.value,
        disabled: o.disabled,
        locked: o.textContent.includes('FULL GAME'),
      }));
    const circuit = read('circuit');
    const vehicle = read('vehicle');
    return {
      circuitsOpen: circuit.filter((o) => !o.disabled).map((o) => o.value),
      circuitsLocked: circuit.filter((o) => o.disabled && o.locked).length,
      vehiclesOpen: vehicle.filter((o) => !o.disabled).map((o) => o.value),
      vehiclesLocked: vehicle.filter((o) => o.disabled && o.locked).length,
      selected: { circuit: document.querySelector('#circuit').value, vehicle: document.querySelector('#vehicle').value },
    };
  });
report.plate = await page.evaluate(() => document.querySelector('#demoPlate')?.innerText ?? null);
report.plateButton = await page.locator('#demoPlate [data-action^="demo:wishlist"]').count();
report.platesCaption = await page.evaluate(() =>
  [...document.querySelectorAll('.lb-plate')].map((p) => p.getAttribute('aria-label')),
);
report.circuit = await lists();
await shot('menu');
// Each plate: what it offers.
report.plates = {};
for (const plate of ['gp', 'dirt', 'festival', 'circuit']) {
  await page.locator(`#boardPlates [data-discipline="${plate}"]`).click();
  await page.waitForTimeout(700);
  report.plates[plate] = await lists();
  if (plate !== 'circuit') await shot(`plate-${plate}`);
}
// A locked session cannot start: choose a locked circuit like a stale CONTINUE would, then enter.
await page.evaluate(() => {
  const circuit = document.querySelector('#circuit');
  circuit.value = 'riviera';
  circuit.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(400);
report.rulesLocked = await page.locator('#sessionRules').innerText();
await page.locator('#sessionForm .enter.primary').click();
await page.waitForTimeout(800);
report.afterRefusedEnter = await page.evaluate(() => ({
  mode: document.querySelector('#app')?.dataset.mode,
  rules: document.querySelector('#sessionRules')?.textContent,
}));
await shot('refused');
await page.evaluate(() => {
  const circuit = document.querySelector('#circuit');
  circuit.value = 'aurel';
  circuit.dispatchEvent(new Event('change', { bubbles: true }));
});
// WILDCARD SERIES board.
await page.locator('#menu [data-action="career:wildcard"]').first().click();
await page.locator('#modal .wc-board').waitFor({ state: 'visible' });
await page.waitForTimeout(600);
report.wildcard = await page.evaluate(() => ({
  eyebrow: document.querySelector('.wc-head .eyebrow')?.textContent,
  rows: document.querySelectorAll('.wc-row').length,
  locked: document.querySelectorAll('.wc-row[data-locked="true"]').length,
  startButtons: document.querySelectorAll('.wc-go').length,
  tally: document.querySelector('.wc-tally-total')?.innerText,
}));
await shot('wildcard');
await page.locator('.wc-row[data-locked="true"]').first().click();
await page.waitForTimeout(400);
report.lockedDetail = await page.evaluate(() => {
  const page = document.querySelector('.wc-detail:not([hidden])');
  return { locked: !!page?.querySelector('.dm-locked'), startButton: !!page?.querySelector('.wc-go') };
});
await shot('wildcard-locked');
await page.locator('#modal [data-action="modalClose"]').first().click();
await page.waitForTimeout(500);
// CAREER: licences.
await page.locator('#menu [data-action="career"]').click();
await page.locator('#modal .cb').waitFor({ state: 'visible' });
await page.waitForTimeout(400);
await page.locator('#modal [data-action="career:page:licences"]').first().click();
await page.locator('#modal .career-licences').waitFor({ state: 'visible' });
await page.waitForTimeout(400);
report.licences = await page.evaluate(() =>
  [...document.querySelectorAll('.career-licence')].map((n) => ({
    id: n.dataset.licence,
    status: n.dataset.status,
    locked: n.dataset.locked === 'true',
    start: !!n.querySelector('[data-action^="career:licence:"]'),
  })),
);
await shot('licences');
console.log(JSON.stringify({ ...report, errors }, null, 1));
await browser.close();
