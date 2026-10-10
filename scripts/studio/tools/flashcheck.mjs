// End-to-end flashback check: node flashcheck.mjs URL OUTDIR
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
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push('page: ' + e.message));
const diag = () => page.evaluate(() => window.apexDiagnostics());
const waitFor = async (pred, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = await diag().catch(() => null);
    if (d && pred(d)) return d;
    await page.waitForTimeout(1000);
  }
  throw new Error('timeout: ' + label);
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
try {
  await page.goto(url);
  await page.waitForFunction(
    () => document.querySelector('#menu') && !document.querySelector('#menu').hidden,
    null,
    { timeout: 180000 },
  );
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '3');
  await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
  let d = await waitFor((d) => d.state === 'driving', 300000, 'driving');
  log('driving');
  await page.keyboard.press('g');
  await waitFor((d) => (d.presentation?.time ?? 0) > 25, 400000, 'sim 25 s');
  d = await diag();
  const before = d.presentation.time;
  log('before flashback t=', before);
  await page.keyboard.press('x');
  d = await waitFor((d) => d.state === 'replay' && d.flashback.choosing, 60000, 'flashback mode');
  log('choosing', JSON.stringify(d.flashback));
  await page.screenshot({ path: `${out}/flashback-choose.png`, timeout: 240000 });
  // Pick a point about 10 s back.
  await page.evaluate(() => {
    const seek = document.querySelector('#replaySeek');
    seek.value = String(Number(seek.max) - 10);
    seek.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: 'RESUME FROM HERE' }).click();
  d = await waitFor((d) => d.flashback.used === 1 && d.state === 'driving', 300000, 'resumed');
  const after = d.presentation.time;
  log('after flashback t=', after);
  console.log(
    JSON.stringify({ ok: after < before - 5, before, after, flashback: d.flashback, errors }),
  );
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e), errors }));
  await page.screenshot({ path: `${out}/flashback-fail.png`, timeout: 240000 }).catch(() => {});
}
await browser.close();
