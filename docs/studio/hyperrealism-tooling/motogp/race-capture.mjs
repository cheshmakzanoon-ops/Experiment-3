// GP race session capture through the real app (dev server on 5182).
// Usage: node race-capture.mjs <outPrefix> [--preset high] [--wait 45] [--targets 1,0]
//        [--views chase,trackside] [--opponents 7]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const G = '/opt/node22/lib/node_modules/playwright/package.json';
const { chromium } = createRequire(G)('playwright');
const args = process.argv.slice(2);
const out = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const preset = opt('preset', 'high');
const waitS = Number(opt('wait', '45'));
const targets = opt('targets', '1').split(',');
const views = opt('views', 'chase,trackside').split(',');
const opponents = opt('opponents', '7');
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console ${m.text().slice(0, 300)}`);
});
const diag = () => page.evaluate(() => window.apexDiagnostics());
const poll = async (fn, ms, label) => {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {}
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await page.waitForTimeout(1000);
  }
};
async function shot(name) {
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    writeFileSync(`${out}-${name}.png`, Buffer.from(data, 'base64'));
    log('saved', `${out}-${name}.png`);
  } finally {
    await session.detach();
  }
}
try {
  await page.goto('http://127.0.0.1:5182/?dev');
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 240000 });
  log('menu');
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name="quality"]').selectOption(preset);
  if (args.includes('--lite')) {
    // Memory-light capture on a shared machine: no crowd, sparser vegetation.
    await page.locator('.presentation-details > summary').click();
    await page.locator('[name=graphics_crowd]').uncheck().catch((e) => log('crowd', e.message));
    await page
      .locator('[name=graphics_vegetationDensity]')
      .evaluate((el) => {
        el.value = '0.5';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })
      .catch((e) => log('vegetation', e.message));
  }
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await page.locator('#modal').waitFor({ state: 'hidden', timeout: 60000 });
  log('preset', preset);
  await page.getByRole('radio', { name: /^GP BIKE/ }).click({ noWaitAfter: true });
  await poll(async () => (await page.locator('#vehicle').inputValue()) === 'gpr1', 120000, 'gp vehicle');
  await page.selectOption('#mode', 'race');
  await page.selectOption('#opponents', opponents, { timeout: 15000 }).catch(() => log('no opponents select'));
  await page.selectOption('#weather', 'clear', { timeout: 15000 }).catch(() => log('weather left default'));
  log('vehicle', await page.locator('#vehicle').inputValue(), 'circuit', await page.locator('#circuit').inputValue());
  if (args.includes('--grid')) {
    // Deterministic paused grid: the identical scene for before/after pairs.
    await page.getByRole('button', { name: /PREPARE GRID/ }).click({ noWaitAfter: true });
    await poll(async () => (await diag()).state === 'paused', 600000, 'paused grid');
    log('paused on grid');
  } else {
    await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click({ noWaitAfter: true });
    await poll(async () => (await diag()).state === 'driving', 600000, 'driving');
    log('driving');
    // Hold throttle so the player's own bike is moving too (chase target 0).
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(waitS * 1000);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('Escape');
    await poll(async () => (await diag()).state === 'paused', 120000, 'paused');
    log('paused');
  }
  await page.evaluate(() => document.querySelector('#modal [data-action="photo"]').click());
  await poll(async () => (await diag()).state === 'photo', 120000, 'photo');
  log('photo');
  for (const target of targets) {
    await page.selectOption('#photoTarget', target);
    for (const view of views) {
      await page.selectOption('#photo-view', view);
      const before = (await diag()).presentation?.frames ?? 0;
      await poll(async () => ((await diag()).presentation?.frames ?? 0) > before + 3, 300000, 'frames');
      await page
        .evaluate(() => document.querySelector('[data-photo-action="clean"]')?.click())
        .catch(() => {});
      await page.waitForTimeout(1500);
      const now = (await diag()).presentation?.frames ?? 0;
      await poll(async () => ((await diag()).presentation?.frames ?? 0) > now + 2, 300000, 'frames2');
      await shot(`t${target}-${view}`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
      if ((await diag()).state !== 'photo') {
        log('left photo mode after clean frame; re-entering');
        await page.evaluate(() => document.querySelector('#modal [data-action="photo"]').click());
        await poll(async () => (await diag()).state === 'photo', 120000, 'photo');
        await page.selectOption('#photoTarget', target);
      }
    }
  }
} catch (e) {
  log('ERROR', e.message);
  await shot('error').catch(() => {});
} finally {
  log('errors', JSON.stringify(errors.slice(0, 10)));
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(0);
}
