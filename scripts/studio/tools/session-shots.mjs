// Lean in-session capture for software-GL hosts: Solo grid, low quality, a real session parked on
// the grid, then chase / cockpit / T-cam frames of the player's car.
//
//   node scripts/studio/tools/session-shots.mjs --url http://127.0.0.1:4215 --out <dir> [--prefix after]
//        [--quality low] [--width 1024 --height 576]
//
// Why not vehicle-drive.mjs: with a full grid on a loaded 4-CPU host SwiftShader cannot finish a page
// screenshot inside its timeout (vehicle-art report, section 9). A Solo grid at low quality, a small
// viewport and a long screenshot timeout did: about 6 minutes to the grid, about 20 s per frame
// (G15 evidence, docs/studio/reports/ip-audit.md). The sim is not driven: the car waits on the grid,
// which is what the cameras frame. Output: <out>/<prefix>-{chase,cam2,cam3}.jpg (<= 220 KB each).
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const url = arg('url', 'http://127.0.0.1:4215');
const out = arg('out', '.');
const prefix = arg('prefix', 'session');
const quality = arg('quality', 'low');
const width = Number(arg('width', 1024)),
  height = Number(arg('height', 576));
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
const page = await browser.newPage({ viewport: { width, height } });
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', (e) => errors.push(`page: ${e.message}`.slice(0, 200)));
page.on(
  'console',
  (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`.slice(0, 200)),
);
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
await page.goto(url);
await page.waitForFunction(
  () => document.querySelector('#menu') && !document.querySelector('#menu').hidden,
  null,
  { timeout: 900000 },
);
console.log(stamp(), 'menu');
await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
await page.locator('[name=quality]').selectOption(quality);
await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
await page.locator('#opponents').selectOption('0');
await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
const deadline = Date.now() + 1200000;
for (;;) {
  const state = await page.evaluate(() => window.apexDiagnostics?.().state);
  if (state === 'paused') break;
  if (Date.now() > deadline) throw new Error(`never reached the paused grid (last state ${state})`);
  await page.waitForTimeout(8000);
}
console.log(stamp(), 'paused on the grid');
await page.waitForTimeout(4000);
// Leave the pause card so the view is unobstructed; the car waits on the grid.
await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
await page.waitForTimeout(6000);
const camera = () => page.evaluate(() => window.apexDiagnostics?.().renderer?.camera);
const shot = async (name) => {
  const path = join(out, `${prefix}-${name}.jpg`);
  let q = 80;
  for (; q >= 40; q -= 10) {
    await page.screenshot({ path, type: 'jpeg', quality: q, timeout: 900000 });
    if (statSync(path).size <= 220 * 1024) break;
  }
  console.log(
    stamp(),
    `${name} (camera ${await camera()})`,
    `${(statSync(path).size / 1024).toFixed(0)} KB`,
  );
};
await shot('chase');
for (const name of ['cam2', 'cam3']) {
  await page.keyboard.press('c');
  await page.waitForTimeout(6000);
  await shot(name);
}
console.log(JSON.stringify({ errors: [...new Set(errors)].slice(0, 8) }));
await browser.close();
