// Design-critic pass, real-game captures (ONE browser boot; software GL boots in 1-2 min).
//
//   node scripts/studio/tools/ux4-real.mjs --url http://127.0.0.1:4297 --out <dir> --prefix before \
//        [--scenes menus,settings,wildcard] [--viewports 1280x720,1280x800,1920x1080,1024x600]
//
// scenes (run in the order given; one browser, nothing else is started):
//   menus      every discipline plate at every viewport (the 3D showroom behind the board). Also records
//              `apexDiagnostics().menuShowroom` when the build reports it (where the car sits between the
//              board and the paddock rail) and one clean frame (menu chrome hidden) per plate at 1280x720.
//   modals     the paddock's modal screens over the real showroom at 1280x720 (settings, controls,
//              credits, Wildcard board)
// Output: <out>/<prefix>-<scene>-<w>x<h>.jpg (JPEG q70) and <out>/<prefix>-report.json.
import { chromium } from 'playwright';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const url = arg('url', 'http://127.0.0.1:4297');
const out = arg('out');
const prefix = arg('prefix', 'shot');
const scenes = arg('scenes', 'menus').split(',');
const viewports = arg('viewports', '1280x720,1280x800,1920x1080,1024x600')
  .split(',')
  .map((v) => v.split('x').map(Number));
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', (e) => errors.push(`page: ${e.message}`.slice(0, 300)));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`.slice(0, 300)));
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
await page.goto(url);
await page.waitForFunction(
  () => document.querySelector('#menu') && !document.querySelector('#menu').hidden,
  null,
  { timeout: 900000 },
);
console.log(`${stamp()} menu visible`);
await page.waitForTimeout(6000);

const report = { prefix, shots: [], showroom: {}, errors };
const shot = async (name, [w, h], { clean = false } = {}) => {
  const path = `${out}/${prefix}-${name}-${w}x${h}.jpg`;
  if (clean) await page.addStyleTag({ content: '#app { visibility: hidden !important; }' });
  await page.screenshot({ path, type: 'jpeg', quality: 70, timeout: 300000 });
  if (clean) await page.evaluate(() => document.head.lastElementChild.remove());
  report.shots.push(path);
  console.log(`${stamp()} ${path} ${(statSync(path).size / 1024).toFixed(0)} KB`);
};
const resize = async ([w, h]) => {
  await page.setViewportSize({ width: w, height: h });
  // A real resize redraws the covered/uncovered menu once; give the software renderer time.
  await page.waitForTimeout(4500);
};
const plate = async (discipline) => {
  await page.locator(`.lb-plate[data-discipline="${discipline}"]`).click();
  await page.waitForTimeout(5000);
};
const showroomNow = () =>
  page.evaluate(() => {
    const d = window.apexDiagnostics?.();
    return d?.menuShowroom ?? null;
  });

for (const scene of scenes) {
  if (scene === 'menus') {
    for (const discipline of ['circuit', 'gp', 'dirt', 'festival']) {
      await resize([1280, 720]);
      await plate(discipline);
      for (const vp of viewports) {
        await resize(vp);
        await shot(`menu-${discipline}`, vp);
        report.showroom[`${discipline}@${vp.join('x')}`] = await showroomNow();
      }
      await resize([1280, 720]);
      await shot(`menu-${discipline}-clean`, [1280, 720], { clean: true });
    }
    await resize([1280, 720]);
    await plate('circuit');
  } else if (scene.startsWith('race:')) {
    // A real session from the board: loading, briefing, the HUD at speed and the pause menu, then back
    // to the paddock. `race:circuit`, `race:gp`, `race:dirt`; `race:festival` stops at the loading
    // board and the first driving frame (SwiftShader cannot screenshot the open world).
    const discipline = scene.slice(5);
    await resize([1280, 720]);
    await plate(discipline);
    await page.locator('#menu button.primary.enter:visible').first().click();
    try {
      await page.waitForFunction(() => !document.querySelector('#loading')?.hidden, null, {
        timeout: 120000,
      });
      await page.waitForTimeout(2500);
      await shot(`race-${discipline}-loading`, [1280, 720]);
      const briefing = page.getByRole('button', { name: /GO STRAIGHT TO LIGHTS|GO TO THE GATE/ });
      const driving = () =>
        page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'driving', null, {
          timeout: 900000,
        });
      const first = await Promise.race([
        briefing.waitFor({ state: 'visible', timeout: 900000 }).then(() => 'briefing'),
        driving().then(() => 'driving'),
      ]);
      if (first === 'briefing') {
        await page.waitForTimeout(1500);
        await shot(`race-${discipline}-briefing`, [1280, 720]);
        // The grid presentation is what a player meets after "WATCH PREPARATION".
        await page.getByRole('button', { name: /WATCH (GRID|GATE) PREPARATION/ }).click();
        await page.waitForTimeout(6000);
        await shot(`race-${discipline}-presentation`, [1280, 720]);
        await page.getByRole('button', { name: /SKIP TO START LIGHTS|BEGIN RACE/ }).click();
      }
      await driving();
      await page.waitForTimeout(9000);
      await shot(`race-${discipline}-hud`, [1280, 720]);
      if (discipline !== 'festival') {
        await page.locator('.hud-top [data-action="pause"]').click();
        await page.waitForTimeout(3000);
        await shot(`race-${discipline}-pause`, [1280, 720]);
        await page.getByRole('button', { name: 'RETURN TO PADDOCK' }).click();
        await page.waitForFunction(
          () => document.querySelector('#menu') && !document.querySelector('#menu').hidden,
          null,
          { timeout: 600000 },
        );
        await page.waitForTimeout(6000);
      }
    } catch (error) {
      errors.push(`race:${discipline}: ${String(error).slice(0, 200)}`);
      console.log(`${stamp()} race:${discipline} stopped: ${String(error).slice(0, 160)}`);
    }
  } else if (scene === 'modals') {
    await resize([1280, 720]);
    for (const [name, button] of [
      ['settings', 'GARAGE & SETTINGS'],
      ['controls', 'CONTROLS'],
      ['credits', 'CREDITS & LICENCES'],
    ]) {
      await page.getByRole('button', { name: button, exact: true }).click();
      await page.waitForTimeout(3000);
      await shot(`modal-${name}`, [1280, 720]);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(2000);
    }
    await page.locator('[data-action="career:wildcard"]').first().click();
    await page.waitForSelector('.wc-board');
    await page.waitForTimeout(2000);
    await shot('modal-wildcard', [1280, 720]);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);
  }
}
writeFileSync(`${out}/${prefix}-report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ errors }));
await browser.close();
