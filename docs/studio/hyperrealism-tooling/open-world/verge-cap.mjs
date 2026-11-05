import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/home/user/Experiment-3/node_modules/');
const { chromium } = require('playwright');
const out = process.argv[2];
const shots = process.argv[3].split(',');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
page.setDefaultTimeout(170000);
await page.goto('http://127.0.0.1:5184/e2e/fixtures/horizon-verge.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.horizonVerge, {}, { timeout: 170000 });
await page.evaluate(async () => {
  const m = await import('/src/rendering/open-world/festival-road-surface.ts');
  m.festivalRoadDetail.value = 1;
});
for (const shot of shots) {
  const t0 = Date.now();
  const r = await page.evaluate(async (s) => await window.horizonVerge.capture(s), shot);
  const img = r?.image ?? r?.first?.image ?? r?.repeat?.image;
  if (img) writeFileSync(`${out}/${shot}.png`, Buffer.from(img.split(',')[1], 'base64'));
  if (false) writeFileSync(`${out}/${shot}.png`, Buffer.from(r.image.split(',')[1], 'base64'));
  console.log(shot, Date.now() - t0, 'ms', r ? Object.keys(r).join(',') : r);
}
await browser.close();
