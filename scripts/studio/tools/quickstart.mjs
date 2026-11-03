// G3 probe: from the visible menu to the first driving frame, counting inputs.
// Usage: node scripts/studio/tools/quickstart.mjs URL [discipline]
// discipline: circuit (default) | gp | dirt. Inputs counted: every click or key press the
// script sends. SwiftShader on a shared host is far slower than hardware: the time is an
// upper bound for the software path, not a G3 pass on a player's machine.
import { chromium } from 'playwright';
const [url, discipline = 'circuit'] = process.argv.slice(2);
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
await page.goto(url);
await page.waitForFunction(() => !document.querySelector('#menu')?.hidden, null, {
  timeout: 300000,
});
await page.waitForTimeout(3000);
const t0 = Date.now();
const log = [];
let inputs = 0;
const input = async (label, action) => {
  inputs++;
  log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s input ${inputs}: ${label}`);
  await action();
};
if (discipline !== 'circuit')
  await input(`pick ${discipline}`, () =>
    page.locator(`.lb-plate[data-discipline="${discipline}"]`).click(),
  );
await input('ENTER CIRCUIT', () =>
  page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click(),
);
// A race without Quick Start opens the briefing; its first action goes to the lights.
const briefing = page.getByRole('button', { name: /GO STRAIGHT TO LIGHTS|GO TO THE GATE/ });
const first = await Promise.race([
  briefing.waitFor({ state: 'visible' }).then(() => 'briefing'),
  page
    .waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'driving')
    .then(() => 'driving'),
]);
log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s first of briefing/driving: ${first}`);
if (first === 'briefing') {
  await input('GO STRAIGHT TO LIGHTS', () => briefing.click());
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'driving');
}
log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s driving; inputs=${inputs}`);
console.log(log.join('\n'));
console.log(JSON.stringify({ inputs, seconds: (Date.now() - t0) / 1000, errors }));
await browser.close();
