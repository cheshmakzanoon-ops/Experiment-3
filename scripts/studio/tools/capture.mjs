// Visual verification capture for the Apex game (SwiftShader headless).
// Usage: node capture.mjs <outDir> [--url http://127.0.0.1:4173] [--quality high|medium|low]
//        [--weather clear|rain|changeable] [--opponents N] [--size 1280x720] [--drive 10]
// Output PNGs: 00-menu, 10-chase, 11-cockpit, 12-pod, 13-trackside, 20-driving-chase, 21-driving-cockpit
import { chromium } from 'playwright';
import fs from 'node:fs';
const argv = process.argv.slice(2);
const out = argv[0] || './shots';
const opt = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? argv[i + 1] : d;
};
const base = opt('url', 'http://127.0.0.1:4173');
const quality = opt('quality', 'high');
const weather = opt('weather', 'clear');
const opponents = opt('opponents', '7');
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const driveSec = Number(opt('drive', '10'));
fs.mkdirSync(out, { recursive: true });
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
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const shot = async (name) => {
  try {
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 });
    log('shot ' + name);
  } catch (e) {
    log('shot failed ' + name + ': ' + e.message.split('\n')[0]);
  }
};
const diag = () => page.evaluate(() => window.apexDiagnostics?.()).catch(() => null);
try {
  await page.goto(base);
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 240000 });
  log('loaded');
  try {
    await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
    await page.locator('[name=quality]').selectOption(quality);
    await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
    await page.waitForTimeout(1500);
    const close = page.locator('[data-action=modalClose]');
    if (await close.isVisible().catch(() => false)) await close.click();
    log('quality ' + quality);
  } catch (e) {
    log('settings failed: ' + e.message.split('\n')[0]);
  }
  await page.waitForTimeout(2000);
  await shot('00-menu');
  try {
    await page.locator('#mode').selectOption('practice');
  } catch {
    /* optional control */
  }
  try {
    await page.locator('#weather').selectOption(weather);
  } catch {
    /* optional control */
  }
  try {
    await page.locator('#opponents').selectOption(opponents);
  } catch (e) {
    log('opponents: ' + e.message.split('\n')[0]);
  }
  await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const d = await diag();
    if (d?.state === 'driving') break;
    if (
      await page
        .locator('#raceBriefing')
        .isVisible()
        .catch(() => false)
    )
      await page
        .getByRole('button', { name: 'GO STRAIGHT TO LIGHTS', exact: true })
        .click()
        .catch(() => {});
    await page.waitForTimeout(1000);
  }
  log('driving');
  await page.waitForTimeout(4000);
  const views = ['chase', 'cockpit', 'pod', 'trackside'];
  let d = await diag();
  for (let i = 0; i < 4; i++) {
    const mode = d?.renderer?.camera ?? d?.camera ?? views[i];
    await shot(`1${i}-${String(mode)}`);
    await page.keyboard.press('c');
    await page.waitForTimeout(3000);
    d = await diag();
  }
  // back to chase-ish and drive
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(driveSec * 1000);
  await shot('20-driving-a');
  await page.keyboard.press('c');
  await page.waitForTimeout(2500);
  await shot('21-driving-b');
  await page.keyboard.up('ArrowUp');
  d = await diag();
  fs.writeFileSync(
    `${out}/diag.json`,
    JSON.stringify(
      {
        state: d?.state,
        camera: d?.renderer?.camera,
        renderer: d?.renderer
          ? Object.fromEntries(Object.entries(d.renderer).filter(([, v]) => typeof v !== 'object'))
          : null,
      },
      null,
      2,
    ),
  );
} catch (e) {
  log('FATAL ' + e.message);
  errors.push('fatal: ' + e.message);
}
fs.writeFileSync(`${out}/errors.txt`, errors.join('\n'));
log(`errors: ${errors.length}`);
await browser.close();
