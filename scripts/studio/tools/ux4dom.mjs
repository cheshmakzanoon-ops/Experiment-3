// Design-critic pass, DOM captures: every screen of the real Interface at several viewports, with a
// text-size, contrast and focus-ring audit of what is on screen. One browser, one fixture build.
//
//   node scripts/studio/tools/ux4dom.mjs --out <dir> --prefix before --scenes menu,gp,pause \
//        [--viewports 1280x720,1280x800,1920x1080,1024x600] [--audit] [--focus] [--pages]
//
// Scenes are `ux-fixture.ts` exports (`name` or `name:arg`, e.g. `career:events`); run the demo scenes
// last (they switch the demo policy on for the rest of the page). `--audit` writes <out>/<prefix>-audit.json
// (see ux4-audit.page.js: text under 11 px as the player sees it, text under WCAG AA against its own
// background), `--focus` writes <out>/<prefix>-focus.json (interactive elements with no focus ring under
// the keyboard or the pad), `--pages` adds shots of a modal scrolled down when it is taller than the
// viewport (name-p2, name-p3). `python3 -I scripts/studio/tools/ux4-audit-summary.py` reads both files.
// Output: <out>/<prefix>-<scene>-<w>x<h>.jpg (JPEG q70).
import { chromium } from 'playwright';
import { build } from 'vite';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};
const out = arg('out');
const prefix = arg('prefix', 'shot');
const scenes = arg('scenes', 'menu').split(',');
const viewports = arg('viewports', '1280x720')
  .split(',')
  .map((v) => v.split('x').map(Number));
const wantAudit = arg('audit', false) === true;
const wantPages = arg('pages', false) === true;
const wantFocus = arg('focus', false) === true;
if (!out) throw new Error('--out <dir> is required');
mkdirSync(out, { recursive: true });

const built = await build({
  configFile: false,
  logLevel: 'error',
  build: {
    write: false,
    lib: {
      entry: resolve('scripts/studio/tools/ux-fixture.ts'),
      name: 'UxFixture',
      formats: ['iife'],
    },
  },
});
const result = Array.isArray(built) ? built[0] : built;
const script = result.output.find((item) => item.type === 'chunk');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--headless=new'],
});
const page = await browser.newPage({
  viewport: { width: viewports[0][0], height: viewports[0][1] },
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
await page.setContent('<!doctype html><title>ux4</title>');
for (const asset of result.output)
  if (asset.type === 'asset' && asset.fileName.endsWith('.css'))
    await page.addStyleTag({ content: String(asset.source) });
await page.addScriptTag({ content: script.code });
await page.addScriptTag({ content: readFileSync('scripts/studio/tools/ux4-audit.page.js', 'utf8') });
await page.evaluate(() => document.fonts.ready);

const report = { prefix, shots: [], audit: {}, focus: {}, errors };
const run = (code, args) =>
  page.evaluate(
    async ([c, a]) => {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      return new AsyncFunction('f', 'a', c)(window.UxFixture, a);
    },
    [code, args],
  );
const shoot = async (name, [w, h]) => {
  const path = `${out}/${prefix}-${name}-${w}x${h}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 70 });
  report.shots.push(path);
  console.log(`${path} ${(statSync(path).size / 1024).toFixed(0)} KB`);
};
// Demo scenes switch the demo policy on for the rest of the page, so every viewport of the other scenes
// runs first and every viewport of the demo scenes after.
const passes = [
  ...viewports.map((vp) => [vp, scenes.filter((s) => !s.startsWith('demo'))]),
  ...viewports.map((vp) => [vp, scenes.filter((s) => s.startsWith('demo'))]),
];
for (const [vp, passScenes] of passes) {
  await page.setViewportSize({ width: vp[0], height: vp[1] });
  for (const scene of passScenes) {
    const [name, argument] = scene.split(':');
    const key = `${scene}@${vp.join('x')}`;
    try {
      if (name === 'menu') await run('f.menu()');
      else if (['gp', 'dirt', 'festivalPlate'].includes(name))
        await run(`f.menu(); f.plate('${name === 'festivalPlate' ? 'festival' : name}')`);
      else if (name === 'wildcardPick') {
        await run("f.wildcardBoard('descent-in-the-cloud')");
        await page.locator('.wc-row[data-id="karts-after-dark"]').click();
      } else await run(`await f.${name}(${argument ? JSON.stringify(argument) : ''})`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await shoot(scene.replace(':', '-'), vp);
      if (wantAudit) report.audit[key] = await page.evaluate(() => window.ux4Audit.audit());
      if (wantFocus) {
        await page.keyboard.press('Tab'); // keyboard modality, so :focus-visible matches
        report.focus[key] = {
          keys: await page.evaluate(() => window.ux4Audit.focus(false)),
          pad: await page.evaluate(() => window.ux4Audit.focus(true)),
        };
      }
      if (wantPages) {
        const extent = await page.evaluate(() => {
          const modal = document.getElementById('modal');
          return modal?.open ? { client: modal.clientHeight, scroll: modal.scrollHeight } : null;
        });
        if (extent && extent.scroll > extent.client + 24)
          for (
            let k = 1;
            k <= 3 && k * extent.client * 0.9 < extent.scroll - extent.client + 40;
            k++
          ) {
            await page.evaluate(
              (y) => (document.getElementById('modal').scrollTop = y),
              k * extent.client * 0.9,
            );
            await page.waitForTimeout(200);
            await shoot(`${scene.replace(':', '-')}-p${k + 1}`, vp);
          }
      }
    } catch (error) {
      console.log(`FAILED ${key}: ${String(error).slice(0, 200)}`);
      report.shots.push(`FAILED ${key}`);
    }
  }
}
if (wantAudit) writeFileSync(`${out}/${prefix}-audit.json`, JSON.stringify(report.audit, null, 1));
if (wantFocus) writeFileSync(`${out}/${prefix}-focus.json`, JSON.stringify(report.focus, null, 1));
console.log(JSON.stringify({ errors }));
await browser.close();
