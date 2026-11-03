// In-session vehicle shots: boot the real menu, pick a discipline and machine, start a
// session, drive with the keyboard and save JPEGs of the chase and cockpit cameras.
//
//   node scripts/studio/tools/vehicle-drive.mjs --url http://127.0.0.1:4212 \
//        --out docs/studio/reports/vehicle-screens --scenario festival:eh3 [--steer ArrowLeft]
//
// Scenarios (discipline:machine): festival:eh3 | gp:gpr1 | dirt:mx450 | circuit:apx01.
// Output: <out>/drive-<machine>-<camera>-<steer|straight>.jpg (1280x720, <= 200 KB).
// Software GL runs the session at a few frames per second, so shots are taken after fixed
// wall-clock holds of the keys, not frame counts. One browser at a time (shared 4-CPU host).
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : (process.argv[i + 1] ?? fallback);
};
const url = arg('url', 'http://127.0.0.1:4212');
const out = arg('out', 'docs/studio/reports/vehicle-screens');
const [discipline, machine] = arg('scenario', 'festival:eh3').split(':');
const steerKey = arg('steer', 'ArrowLeft');
const bootSeconds = Number(arg('boot-timeout', 900));
const sessionSeconds = Number(arg('session-timeout', 900));
const shotSeconds = Number(arg('shot-timeout', 120));
mkdirSync(out, { recursive: true });
const ENTER = {
  festival: 'ENTER FESTIVAL',
  gp: 'ENTER CIRCUIT',
  dirt: 'ENTER CIRCUIT',
  circuit: 'ENTER CIRCUIT',
};

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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', (e) => errors.push(`page: ${e.message}`.slice(0, 300)));
page.on(
  'console',
  (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`.slice(0, 300)),
);
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
await page.goto(url);
await page.waitForFunction(
  () => document.querySelector('#menu') && !document.querySelector('#menu').hidden,
  null,
  {
    timeout: bootSeconds * 1000,
  },
);
console.log(`${stamp()} menu visible`);
await page.waitForTimeout(3000);
if (discipline !== 'circuit')
  await page.locator(`.lb-plate[data-discipline="${discipline}"]`).click();
await page.waitForTimeout(1500);
await page.evaluate((value) => {
  const select = document.querySelector('#vehicle');
  select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}, machine);
await page.waitForFunction(
  (want) => window.apexDiagnostics?.().menuPreview?.machine === want,
  machine,
  { timeout: 240000, polling: 500 },
);
await page.getByRole('button', { name: ENTER[discipline], exact: true }).click();
// Poll the app state instead of racing two waits: a festival start can sit on loading,
// a briefing or a pause card, and the loop reports which one it is.
const briefing = page.getByRole('button', { name: /GO STRAIGHT TO LIGHTS|GO TO THE GATE/ });
const deadline = Date.now() + sessionSeconds * 1000;
let lastState = '';
for (;;) {
  const state = await page.evaluate(() => ({
    app: window.apexDiagnostics?.().state,
    mode: document.querySelector('#app')?.dataset.mode,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
  }));
  const line = `${state.app}/${state.mode} ${state.text}`;
  if (line !== lastState) console.log(`${stamp()} ${line}`);
  lastState = line;
  // The open-world festival keeps the app in its menu/loading state and shows its own
  // HUD (its camera/map hint line), so that text counts as driving too.
  if (state.mode === 'driving' || state.app === 'driving' || /CAMERA · T MAP/.test(state.text))
    break;
  if (await briefing.isVisible().catch(() => false)) await briefing.click();
  if (Date.now() > deadline) throw new Error(`session did not reach driving: ${line}`);
  await page.waitForTimeout(5000);
}
console.log(`${stamp()} driving`);
const shots = [];
const shot = async (camera, steer) => {
  const path = join(out, `drive-${machine}-${camera}-${steer}.jpg`);
  let quality = 78;
  for (; quality >= 40; quality -= 10) {
    await page.screenshot({ path, type: 'jpeg', quality, timeout: shotSeconds * 1000 });
    if (statSync(path).size <= 200 * 1024) break;
  }
  shots.push(`${path} ${(statSync(path).size / 1024).toFixed(0)} KB`);
  console.log(`${stamp()} ${shots.at(-1)}`);
};
// Let the session run up to speed, then take the chase view straight and steering.
await page.keyboard.down('KeyW');
await page.waitForTimeout(12000);
await shot('chase', 'straight');
await page.keyboard.down(steerKey);
await page.waitForTimeout(3500);
await shot('chase', 'steer');
await page.keyboard.up(steerKey);
// Cycle the camera (KeyC): the first cockpit-like view is the one a player sits in.
for (const name of ['cam2', 'cam3']) {
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(2500);
  await shot(name, 'straight');
  await page.keyboard.down(steerKey);
  await page.waitForTimeout(3000);
  await shot(name, 'steer');
  await page.keyboard.up(steerKey);
}
await page.keyboard.up('KeyW');
console.log(JSON.stringify({ shots: shots.length, errors: [...new Set(errors)].slice(0, 10) }));
await browser.close();
