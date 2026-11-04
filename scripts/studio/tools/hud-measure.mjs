// HUD legibility measurement: the on-screen size of every text element of each HUD family at the
// handheld and TV resolutions, against the floors in hud-legibility.page.js.
//
//   node scripts/studio/tools/hud-measure.mjs --out <dir> [--label before] \
//        [--scenes hud,hudGp,hudMx,festival] [--viewports 1280x800,1280x720,1920x1080,3840x2160] \
//        [--hud-scale 1.15|auto|<n>] [--shots] [--list]
//
// DOM-only (no WebGL): the production Interface, FestivalHud and the real style sheets through the
// ux-fixture scenes (the same ones e2e/64 audits), one fixture build, one browser. For every scene x viewport it
// writes <out>/<label>-hud-measure.json (every text row: name, text, effective px, tier, on screen or
// not, rect) and prints a summary: rows, smallest size, and the count under each tier's floor.
//   --shots   also saves <out>/<label>-<scene>-<w>x<h>.jpg (JPEG q70) of each frame
//   --list    prints the rows under their floor (default prints only counts and the 12 worst)
//   --hud-scale   the HUD SCALE setting to apply before measuring (a number such as 1.3, or `auto`)
// Scenes are ux-fixture.ts exports, `name[:arg[:arg]]`: hud = circuit/formula, hudGp = GP bike, hudMx =
// dirt/offroad, festival = open world, and hudState:<state>[:gp|mx] = the HUD with race control, the pit lane,
// the start lights, a vehicle warning, the VEHICLE panel or the GP corner guide on show.
import { chromium } from 'playwright';
import { build } from 'vite';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};
const out = arg('out');
const label = arg('label', 'run');
const DEFAULT_SCENES = [
  'hud', 'hudGp', 'hudMx', 'festival',
  'hudState:banner', 'hudState:pit', 'hudState:start', 'hudState:alert', 'hudState:vehicle',
  'hudState:vehicle:gp', 'hudState:gpcraft:gp', 'hudState:vehicle:mx',
].join(',');
const scenes = arg('scenes', DEFAULT_SCENES).split(',');
const viewports = arg('viewports', '1280x800,1280x720,1920x1080,3840x2160')
  .split(',')
  .map((v) => v.split('x').map(Number));
const hudScale = arg('hud-scale', null);
const shots = arg('shots', false) === true;
const list = arg('list', false) === true;
if (!out) throw new Error('--out <dir> is required');
mkdirSync(out, { recursive: true });

const family = (scene) => {
  const [name, , kind] = scene.split(':');
  if (name === 'festival') return 'festival';
  const k = name === 'hudGp' ? 'gp' : name === 'hudMx' ? 'mx' : (kind ?? 'circuit');
  return { circuit: 'circuit', gp: 'gp-bike', mx: 'dirt' }[k];
};
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
await page.setContent('<!doctype html><title>HUD measure</title>');
for (const asset of result.output)
  if (asset.type === 'asset' && asset.fileName.endsWith('.css'))
    await page.addStyleTag({ content: String(asset.source) });
await page.addScriptTag({ content: script.code });
await page.addScriptTag({
  content: readFileSync('scripts/studio/tools/hud-legibility.page.js', 'utf8'),
});
await page.evaluate(() => document.fonts.ready);

const records = [];
for (const [w, h] of viewports) {
  for (const scene of scenes) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(
      async ([s, scale]) => {
        if (scale !== null) document.documentElement.style.setProperty('--hud-scale', String(scale));
        const [name, ...args] = s.split(':');
        await window.UxFixture[name](...args);
      },
      [scene, hudScale && hudScale !== 'auto' ? Number(hudScale) : null],
    );
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) animation.finish();
    });
    const rows = await page.evaluate(() => {
      const root = document.getElementById('hud');
      return window.hudLegibility.measure(root && !root.hidden ? root : document.getElementById('app'));
    });
    const floors = await page.evaluate(() => window.hudLegibility.FLOOR);
    records.push({ viewport: `${w}x${h}`, scene, family: family(scene), rows });
    const shown = rows.filter((r) => r.shown);
    const under = (set) => set.filter((r) => r.tier !== 'decor' && r.px < floors[r.tier]);
    const bad = under(shown);
    const off = under(rows.filter((r) => !r.shown));
    const sizes = shown.filter((r) => r.tier !== 'decor').map((r) => r.px);
    console.log(
      `${w}x${h} ${scene.padEnd(19)} rows ${String(rows.length).padStart(3)} shown ${String(shown.length).padStart(3)} ` +
        `min ${sizes.length ? Math.min(...sizes).toFixed(1) : '-'} px  under floor: shown ${bad.length}, off-state ${off.length}  ` +
        `(primary ${bad.filter((r) => r.tier === 'primary').length}, secondary ${bad.filter((r) => r.tier === 'secondary').length}, tertiary ${bad.filter((r) => r.tier === 'tertiary').length})`,
    );
    for (const r of (list ? bad : bad.sort((a, b) => a.px - b.px).slice(0, 12)))
      console.log(`    ${r.tier.padEnd(9)} ${String(r.px).padStart(5)} px  ${r.name} "${r.text}"`);
    if (shots) {
      const path = `${out}/${label}-${scene.replaceAll(':', '-')}-${w}x${h}.jpg`;
      await page.screenshot({ path, type: 'jpeg', quality: 70 });
      console.log(`    shot ${path} ${(statSync(path).size / 1024).toFixed(0)} KB`);
    }
  }
}
writeFileSync(
  `${out}/${label}-hud-measure.json`,
  JSON.stringify({ label, hudScale, floors: await page.evaluate(() => window.hudLegibility.FLOOR), records, errors }, null, 1),
);
console.log(JSON.stringify({ errors }));
await browser.close();
