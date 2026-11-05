// In-game festival captures through the real horizon-session fixture.
// usage: node capture.mjs <outDir> <lighting> <quality> <viewsJson> [travel] [weather]
// views: [{ name, camera:[x,y,z], target:[x,y,z], rel?: true (offsets from player), draws?: n }]
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
const require = createRequire('/home/user/Experiment-3/node_modules/');
const { chromium } = require('playwright');
const [out, lighting = 'day', quality = 'high', viewsArg, travel = 'coast-trap', weather = 'clear'] =
  process.argv.slice(2);
const views = JSON.parse(viewsArg.startsWith('[') ? viewsArg : readFileSync(viewsArg, 'utf8'));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const browser = await chromium.launch({
  executablePath:
    '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.setDefaultTimeout(30 * 60 * 1000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const query = new URLSearchParams({
    quality, vehicle: 'eh3', lighting, weather, discovered: 'all', travel, capture: '1', frames: '1',
  });
  await page.goto(`http://127.0.0.1:5184/e2e/fixtures/horizon-session.html?${query}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.horizonReview?.state().draws >= 1);
  const player = await page.evaluate(() => window.horizonReview.state().player);
  log('booted', JSON.stringify(player), errors.length ? errors.slice(0, 3) : '');
  for (const v of views) {
    const add = (a) => (v.rel ? [player.x + a[0], player.y + a[1], player.z + a[2]] : a);
    const camera = add(v.camera), target = add(v.target);
    await page.evaluate(([c, t]) => window.horizonReview.inspect(c, t), [camera, target]);
    if (v.eval) await page.evaluate(v.eval);
    const draws = v.draws ?? 3;
    for (let i = 0; i < draws; i++) {
      await page.evaluate(() => window.horizonReview.draw());
      if (v.settle) await page.waitForTimeout(v.settle);
      log(v.name, 'draw', i + 1);
    }
    const png = await page.evaluate(() => window.horizonReview.image());
    writeFileSync(`${out}/${v.name}.png`, Buffer.from(png.split(',')[1], 'base64'));
    log('saved', v.name, JSON.stringify({ camera, target }));
  }
  if (errors.length) log('errors', JSON.stringify(errors.slice(0, 10)));
} finally {
  await browser.close();
}
