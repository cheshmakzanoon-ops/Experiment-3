// Fast DOM-only screenshots of the front end (no WebGL boot): menu disciplines,
// pause, results, settings. Usage:
//   node scripts/studio/tools/uxdom.mjs OUTDIR PREFIX [scene,scene,...] [WxH]
// scenes: menu, gp, dirt, festival, pause, results, settings, controls, championship
// Output: OUTDIR/PREFIX-<scene>-<w>x<h>.jpg (quality 70).
import { chromium } from 'playwright';
import { build } from 'vite';
import { resolve } from 'node:path';
import { mkdirSync, statSync } from 'node:fs';
const [out, prefix, scenesArg = 'menu', size = '1280x720'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const [W, H] = size.split('x').map(Number);
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
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--headless=new'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setContent('<!doctype html><title>ux</title>');
for (const asset of result.output)
  if (asset.type === 'asset' && asset.fileName.endsWith('.css'))
    await page.addStyleTag({ content: String(asset.source) });
await page.addScriptTag({ content: script.code });
await page.evaluate(() => document.fonts.ready);
const shot = async (scene) => {
  await page.waitForTimeout(350);
  const path = `${out}/${prefix}-${scene}-${W}x${H}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 70 });
  console.log(`${path} ${(statSync(path).size / 1024).toFixed(0)} KB`);
};
// The scene code may await (a settled career payment), so it runs as an async function.
const run = (code, ...args) =>
  page.evaluate(
    async ([c, a]) => {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      return new AsyncFunction('f', 'a', c)(window.UxFixture, a);
    },
    [code, args],
  );
for (const scene of scenesArg.split(',')) {
  if (scene === 'menu') await run('f.menu()');
  else if (scene === 'gp') await run("f.menu(); f.plate('gp')");
  else if (scene === 'dirt') await run("f.menu(); f.plate('dirt')");
  else if (scene === 'festival') await run("f.menu(); f.plate('festival')");
  else if (scene === 'menu-scaled') await run('f.menu(1.35)');
  else if (scene === 'wildcardPick') {
    // The board opens on the first event; a click selects another (real pointer input).
    await run("f.wildcardBoard('descent-in-the-cloud')");
    await page.locator('.wc-row[data-id="karts-after-dark"]').click();
  } else await run(`await f.${scene}()`);
  await page.evaluate(() => document.fonts.ready);
  await shot(scene);
}
console.log(JSON.stringify({ errors }));
await browser.close();
