// G3 probe for the first-launch screen: the real game, `?firstrun=1`, counting the inputs from the
// screen to the first driving frame (the screen is skipped for scripted browsers unless asked).
// Usage: node scripts/studio/tools/firstrun.mjs URL OUTDIR [discipline] [--pad]
//   discipline: circuit (default, preselected: Enter is the one input) | gp | dirt | festival
// Software GL on a shared host is far slower than hardware: every time is an upper bound for the
// software path, not a G3 pass on a player's machine. Screens: OUTDIR/firstrun-screen.jpg and
// OUTDIR/firstrun-driving.jpg (1280x720 JPEG).
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [url, out, discipline = 'circuit'] = args;
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
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const t0 = Date.now();
await page.goto(`${url}${url.includes('?') ? '&' : '?'}firstrun=1`);
await page.locator('#modal .fr').waitFor({ state: 'visible', timeout: 900000 });
const tScreen = Date.now();
await page.waitForTimeout(1500);
const shot = async (name) => {
  const path = `${out}/${name}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 70 });
  console.log(`${path} ${(statSync(path).size / 1024).toFixed(0)} KB`);
};
await shot('firstrun-screen');
const log = [`boot to screen: ${((tScreen - t0) / 1000).toFixed(1)} s`];
let inputs = 0;
const t1 = Date.now();
if (discipline !== 'circuit') {
  inputs++;
  await page.locator(`.fr-plate[data-discipline="${discipline}"]`).click();
  log.push(`input ${inputs}: pick ${discipline}`);
}
inputs++;
await page.getByRole('button', { name: /DRIVE THE FIRST LAP/ }).click();
log.push(`input ${inputs}: DRIVE THE FIRST LAP`);
await page.waitForFunction(
  () => ['driving', 'festival'].includes(document.querySelector('#app')?.dataset.mode ?? ''),
  null,
  { timeout: 900000 },
);
const seconds = (Date.now() - t1) / 1000;
log.push(`driving after ${seconds.toFixed(1)} s from the screen, ${inputs} input(s)`);
await page.waitForTimeout(4000);
const hud = await page.evaluate(() => ({
  mode: document.querySelector('#app')?.dataset.mode,
  programme: document.querySelector('#programmeHud')?.textContent?.trim() ?? '',
  toast: document.querySelector('#toast')?.textContent?.trim() ?? '',
  modalOpen: !!document.querySelector('#modal[open]'),
}));
await shot('firstrun-driving');
console.log(log.join('\n'));
console.log(JSON.stringify({ discipline, inputs, seconds, hud, errors }));
await browser.close();
