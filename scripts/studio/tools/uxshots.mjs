// UX screenshots of the paddock menu and its modals at the four review viewports.
// Usage: node uxshots.mjs URL OUTDIR PREFIX [--scenes menu,dirt,festival,gp,settings]
// One browser, one boot (software GL boots in ~45 s); the viewport is resized between shots.
// Output: OUTDIR/PREFIX-<scene>-<w>x<h>.jpg (JPEG, quality 62, each well under 300 KB).
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
const [url, out, prefix, ...rest] = process.argv.slice(2);
const scenes = (rest[rest.indexOf('--scenes') + 1] ?? 'menu').split(',');
mkdirSync(out, { recursive: true });
const VIEWPORTS = [
  [1280, 720],
  [1920, 1080],
  [1024, 600],
  [390, 844],
];
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
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push('page: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await page.goto(url);
await page.waitForFunction(
  () => document.querySelector('#menu') && !document.querySelector('#menu').hidden,
  null,
  { timeout: 240000 },
);
await page.waitForTimeout(8000);
const log = [];
const shot = async (scene, [w, h]) => {
  const path = `${out}/${prefix}-${scene}-${w}x${h}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 62, timeout: 240000 });
  log.push(`${path} ${(statSync(path).size / 1024).toFixed(0)} KB`);
};
const pick = async (id, value) => {
  await page.evaluate(
    ([i, v]) => {
      const el = document.getElementById(i);
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [id, value],
  );
};
for (const scene of scenes) {
  if (scene === 'dirt') await pick('circuit', 'valley-ridge-mx');
  if (scene === 'gp') {
    await pick('vehicle', 'gpr1');
  }
  if (scene === 'festival') await pick('mode', 'festival');
  if (scene === 'settings') {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
    await page.waitForTimeout(3000);
    await shot('settings', [1280, 720]);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);
    continue;
  }
  for (const vp of scene === 'menu' ? VIEWPORTS : [VIEWPORTS[0]]) {
    await page.setViewportSize({ width: vp[0], height: vp[1] });
    await page.waitForTimeout(5000);
    await shot(scene, vp);
  }
}
console.log(log.join('\n'));
console.log(JSON.stringify({ errors }));
await browser.close();
