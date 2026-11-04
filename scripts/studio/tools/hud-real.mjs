// One real-game HUD frame (software GL, one browser): the first-launch path to the first driving frame of a
// circuit session (docs/studio/reports/hud-legibility.md uses it for the before / after of the formula HUD).
//
//   node scripts/studio/tools/hud-real.mjs --url http://127.0.0.1:4311 --out <dir> --prefix after \
//        [--viewport 1280x800] [--hud-scale auto|1|1.15|1.3|1.5] [--wait 6000]
//
// The first-launch screen (`?firstrun=1`) starts a session with one input, so this is the shortest way to a
// driving HUD on a slow software renderer. The frame is JPEG q70; `--hud-scale` sets the setting through the same
// custom property the settings screen writes (`--hud-scale` on the root), after the game has booted. Prints the
// measured size of the HUD's text in the real page (the same measurement as hud-measure.mjs, from
// hud-legibility.page.js) and any page or console error. Software GL boots in 1-5 minutes on a loaded host.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const url = arg('url', 'http://127.0.0.1:4311');
const out = arg('out');
const prefix = arg('prefix', 'hud');
const [w, h] = arg('viewport', '1280x800').split('x').map(Number);
const hudScale = arg('hud-scale', 'auto');
const wait = Number(arg('wait', '6000'));
if (!out) throw new Error('--out <dir> is required');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--headless=new',
  ],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', (e) => errors.push(`page: ${e.message}`.slice(0, 300)));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`.slice(0, 300)));
const t0 = Date.now();
await page.goto(`${url}${url.includes('?') ? '&' : '?'}firstrun=1`);
await page.locator('#modal .fr').waitFor({ state: 'visible', timeout: 900000 });
console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s first-launch screen`);
if (hudScale !== 'auto')
  await page.evaluate((v) => document.documentElement.style.setProperty('--hud-scale', v), hudScale);
await page.getByRole('button', { name: /DRIVE THE FIRST LAP/ }).click();
await page.waitForFunction(
  () => ['driving', 'festival'].includes(document.querySelector('#app')?.dataset.mode ?? ''),
  null,
  { timeout: 900000 },
);
console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s driving`);
await page.waitForTimeout(wait);
const path = `${out}/${prefix}-real-${w}x${h}.jpg`;
await page.screenshot({ path, type: 'jpeg', quality: 70, timeout: 300000 });
console.log(`${path} ${(statSync(path).size / 1024).toFixed(0)} KB`);
await page.addScriptTag({ content: readFileSync('scripts/studio/tools/hud-legibility.page.js', 'utf8') });
const rows = await page.evaluate(() => window.hudLegibility.measure(document.getElementById('hud')));
const shown = rows.filter((r) => r.shown && r.tier !== 'decor');
const under = shown.filter((r) => r.px < { primary: 18, secondary: 11, tertiary: 10 }[r.tier]);
const sizes = shown.map((r) => r.px);
const report = {
  viewport: `${w}x${h}`,
  hudScale,
  rows: shown.length,
  smallest: Math.min(...sizes),
  underFloor: under.map((r) => `${r.name} "${r.text}" ${r.px}px`),
  errors,
};
writeFileSync(`${out}/${prefix}-real-measure.json`, JSON.stringify({ ...report, rows: shown }, null, 1));
console.log(JSON.stringify(report));
await browser.close();
