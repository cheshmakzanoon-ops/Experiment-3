// Wave-3 real-game shots in one boot: the paddock, the season board (CAREER), the settings graphics
// guide with its live frame rate and GPU suggestion, Team HQ. Console and page errors are collected.
// Usage: node scripts/studio/tools/ux3shots.mjs URL OUTDIR [prefix]
// Software GL (SwiftShader) is slow: the frame rate it reports is the software path's, and the GPU
// suggestion it prints is for the software renderer (LOW), not for a player's machine.
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
const [url, out, prefix = 'real'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
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
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => !document.querySelector('#menu')?.hidden, null, { timeout: 600000 });
await page.waitForTimeout(2500);
const shot = async (name) => {
  const path = `${out}/${prefix}-${name}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 70 });
  console.log(`${path} ${(statSync(path).size / 1024).toFixed(0)} KB`);
};
const report = { bootSeconds: (Date.now() - t0) / 1000 };
// The scripted browser skips the first-launch screen: the menu is not covered.
report.firstRunShown = await page.evaluate(() => !!document.querySelector('#modal[open] .fr'));
await shot('menu');
// CAREER: the season board.
await page.locator('#menu [data-action="career"]').click();
await page.locator('#modal .cb').waitFor({ state: 'visible' });
report.lanes = await page.locator('#modal [data-discipline]').count();
report.nextUp = await page.locator('#modal .cb-next h4').innerText();
report.primary = await page.locator('#modal .cb-next .primary').innerText();
await page.waitForTimeout(600);
await shot('career');
await page.evaluate(() => document.querySelector('.cb-ladder')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(300);
await shot('career-ladder');
await page.locator('#modal [data-action="modalClose"]').first().click();
await page.waitForTimeout(600);
// GARAGE & SETTINGS: the graphics guide.
await page.locator('#menu [data-action="settings"]').click();
await page.locator('#modal .gq').waitFor({ state: 'visible' });
await page.evaluate(() => document.querySelector('.gq')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(3500);
report.gpu = await page.locator('#modal .gq-gpu').innerText();
report.suggestion = await page.locator('#modal .gq-rec b').innerText();
report.fps = await page.locator('#modal .gq-fps-now').innerText();
report.fpsLow = await page.locator('#modal .gq-fps-low').innerText();
await shot('settings-guide');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
// TEAM HQ.
await page.locator('#menu [data-action="team"]').click();
await page.locator('#modal .team-hub').waitFor({ state: 'visible' });
await page.waitForTimeout(500);
await shot('team');
console.log(JSON.stringify({ ...report, errors }));
await browser.close();
