// Quick shader-compile check: load the app (menu scene, then ENTER CIRCUIT) and report console/page errors.
// Usage: node shadercheck.mjs http://127.0.0.1:PORT [seconds]
import { chromium } from 'playwright';
const url = process.argv[2];
const secs = Number(process.argv[3] || 150);
const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push('page: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 1500));
});
await page.goto(url);
const t0 = Date.now();
try {
  await page.waitForFunction(
    () =>
      document.querySelector('#menu') &&
      getComputedStyle(document.querySelector('#menu')).display !== 'none',
    null,
    { timeout: 120000 },
  );
  await page.waitForTimeout(8000);
  const enter = page.getByRole('button', { name: /ENTER CIRCUIT/i });
  if (await enter.count()) await enter.first().click();
  while (Date.now() - t0 < secs * 1000) {
    const state = await page
      .evaluate(() => globalThis.apexDiagnostics?.()?.state)
      .catch(() => null);
    if (state === 'driving' || state === 'briefing') break;
    await page.waitForTimeout(2000);
  }
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(15000);
} catch (e) {
  errors.push('check: ' + e.message);
}
console.log(
  JSON.stringify({
    seconds: Math.round((Date.now() - t0) / 1000),
    errors: errors.length,
    shaderErrors: errors.filter((e) => /ERROR|Shader|shader/.test(e)).length,
  }),
);
for (const e of errors)
  console.log(
    e
      .split('\n')
      .filter((l) => /ERROR|Material Name|page:|check:/.test(l))
      .slice(0, 8)
      .join('\n'),
  );
await browser.close();
process.exit(errors.length ? 1 : 0);
