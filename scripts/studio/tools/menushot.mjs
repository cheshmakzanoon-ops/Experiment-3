// Menu + modal screenshots at 1280x720: node menushot.mjs URL OUTDIR
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [url, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('page: ' + e.message));
await page.goto(url);
await page.waitForFunction(
  () => document.querySelector('#menu') && !document.querySelector('#menu').hidden,
  null,
  { timeout: 180000 },
);
await page.waitForTimeout(25000);
await page.screenshot({ path: `${out}/00-menu.png`, timeout: 240000 });
for (const [name, label] of [
  ['01-settings', 'GARAGE & SETTINGS'],
  ['02-team', 'TEAM HQ'],
]) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
}
console.log(JSON.stringify({ errors }));
await browser.close();
