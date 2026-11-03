// Vehicle showroom capture harness: one browser, one page, every machine in the real menu.
//
//   node scripts/studio/tools/vehicle-shots.mjs --url http://127.0.0.1:4212 \
//        --out docs/studio/reports/vehicle-screens [--prefix before] [--ids eh3,apx01]
//        [--all | --reps] [--skip-existing] [--chrome] [--max-kb 200] [--settle 3500]
//
// How it works. The menu showroom renders the selected machine on a slow orbit. The harness
// boots the real build once (software GL ~45 s), then for each machine sets the real
// `#vehicle` select (the same `change` event a player causes), waits until the renderer
// reports a COMPLETED menu frame for that machine (`apexDiagnostics().menuPreview`: machine id
// matches, `current` true), lets the pose/DOF settle, and saves a 1280x720 JPEG of the page.
// By default the menu chrome is hidden for the shot so the whole machine is visible (the
// showroom camera shifts the car right of the menu panel, which otherwise crops the nose);
// `--chrome` keeps the real UI. Sizes are held to --max-kb by lowering JPEG quality.
//
// Order: `--reps` (default when no --ids/--all) shoots one representative per class first;
// `--all` shoots representatives first and then every other machine. Interrupted runs resume
// with `--skip-existing`. A `<prefix>-manifest.json` records what was and was not captured.
// Host etiquette: one browser at a time (the host has 4 shared CPUs).
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};
const url = arg('url', 'http://127.0.0.1:4212');
const out = arg('out', 'docs/studio/reports/vehicle-screens');
const prefix = arg('prefix', '');
const maxKb = Number(arg('max-kb', 200));
const settle = Number(arg('settle', 3500));
const chrome = arg('chrome', false) === true;
const skipExisting = arg('skip-existing', false) === true;
const wantAll = arg('all', false) === true;
const wantIds = typeof arg('ids', false) === 'string' ? arg('ids').split(',') : null;
const budgetMin = Number(arg('budget-min', 0)); // stop starting new machines after this many minutes
const bootSeconds = Number(arg('boot-timeout', 900)); // software GL on a loaded host boots in 1-8 min
mkdirSync(out, { recursive: true });
const fileFor = (id) => join(out, `${prefix ? `${prefix}-` : ''}${id}.jpg`);
const manifestPath = join(out, `${prefix ? `${prefix}-` : ''}manifest.json`);
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { shots: {}, failed: {}, errors: [] };

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
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
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => manifest.errors.push(`page: ${e.message}`.slice(0, 300)));
page.on('console', (m) => {
  if (m.type() === 'error') manifest.errors.push(`console: ${m.text()}`.slice(0, 300));
});
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
await page.goto(url);
const bootTicker = setInterval(async () => {
  const text = await page
    .evaluate(() => document.querySelector('#loading, .loading, [data-loading]')?.textContent?.trim())
    .catch(() => null);
  console.log(`${stamp()} booting... ${text ?? ''}`);
}, 60000);
// Fail fast on the game's own error screen (e.g. a missing generated asset such as
// public/models/supplied-player-lods.bin.gz: run `npm run generate:player-lods` first).
await Promise.race([
  page.waitForFunction(
    () => document.querySelector('#menu') && !document.querySelector('#menu').hidden,
    null,
    { timeout: bootSeconds * 1000 },
  ),
  page
    .waitForFunction(() => /SOMETHING WENT WRONG/i.test(document.body.innerText), null, {
      timeout: bootSeconds * 1000,
      polling: 2000,
    })
    .then(async () => {
      const detail = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300));
      throw new Error(`game error screen: ${detail}; console: ${manifest.errors.slice(-2).join(' | ')}`);
    }),
]);
clearInterval(bootTicker);
console.log(`${stamp()} menu visible`);

// Machines come from the real select, grouped as the menu groups them.
const machines = await page.evaluate(() =>
  [...document.querySelectorAll('#vehicle optgroup')].flatMap((g) =>
    [...g.querySelectorAll('option')].map((o) => ({
      id: o.value,
      label: o.textContent,
      group: g.label,
    })),
  ),
);
const real = machines.filter((m) => m.id !== 'mixed' && m.id !== 'multiclass' && m.id !== 'bikes');
// Representatives: first machine of every group, plus the ones players meet first.
const PRIORITY = ['apx01', 'eh3', 'gpr1', 'mx450'];
const reps = [];
for (const m of real) if (!reps.some((r) => r.group === m.group)) reps.push(m);
const ordered = [
  ...PRIORITY.map((id) => real.find((m) => m.id === id)).filter(Boolean),
  ...reps,
  ...real,
].filter((m, i, all) => all.findIndex((n) => n.id === m.id) === i);
let queue = wantIds
  ? wantIds.map((id) => real.find((m) => m.id === id)).filter(Boolean)
  : wantAll
    ? ordered
    : ordered.slice(0, new Set([...PRIORITY, ...reps.map((r) => r.id)]).size);
if (skipExisting) queue = queue.filter((m) => !existsSync(fileFor(m.id)));
console.log(`${stamp()} ${real.length} machines in menu, ${queue.length} to capture`);

const HIDE = 'vehicle-shots-hide';
const hideChrome = () =>
  page.addStyleTag({
    content: `body > #app { visibility: hidden !important; } body > :not(canvas):not(#app) { visibility: hidden !important; }`,
  }).then((h) => h.evaluate((el) => (el.id = 'vehicle-shots-hide')));
const showChrome = () => page.evaluate((id) => document.getElementById(id)?.remove(), HIDE);
const previewMachine = () =>
  page.evaluate(() => {
    const d = window.apexDiagnostics?.();
    return d?.menuPreview ? { machine: d.menuPreview.machine, current: d.menuPreview.current } : null;
  });

async function selectMachine(id) {
  await page.evaluate((value) => {
    const select = document.querySelector('#vehicle');
    select.value = value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  await page.waitForFunction(
    (want) => {
      const d = window.apexDiagnostics?.();
      return d?.menuPreview?.machine === want && d.menuPreview.current === true;
    },
    id,
    { timeout: 240000, polling: 500 },
  );
}

async function save(id) {
  const path = fileFor(id);
  let quality = 80;
  let size = 0;
  for (; quality >= 30; quality -= 10) {
    await page.screenshot({ path, type: 'jpeg', quality, timeout: 240000 });
    size = statSync(path).size;
    if (size <= maxKb * 1024) break;
  }
  return { size, quality };
}

for (const m of queue) {
  if (budgetMin && (Date.now() - t0) / 60000 > budgetMin) {
    console.log(`${stamp()} budget reached, stopping before ${m.id}`);
    break;
  }
  const started = Date.now();
  try {
    await selectMachine(m.id);
    await page.waitForTimeout(settle);
    // The orbit keeps moving; make sure the machine is still the displayed one.
    const shown = await previewMachine();
    if (shown?.machine !== m.id) throw new Error(`preview shows ${shown?.machine}`);
    if (!chrome) await hideChrome();
    await page.waitForTimeout(600);
    const { size, quality } = await save(m.id);
    if (!chrome) await showChrome();
    manifest.shots[m.id] = {
      label: m.label,
      group: m.group,
      file: fileFor(m.id),
      kb: Math.round(size / 1024),
      quality,
      seconds: Math.round((Date.now() - started) / 1000),
      chrome,
    };
    delete manifest.failed[m.id];
    console.log(
      `${stamp()} ${m.id.padEnd(8)} ${String(Math.round(size / 1024)).padStart(4)} KB q${quality} ${manifest.shots[m.id].seconds}s  ${m.label}`,
    );
  } catch (error) {
    manifest.failed[m.id] = String(error.message ?? error).slice(0, 300);
    console.log(`${stamp()} ${m.id} FAILED ${manifest.failed[m.id]}`);
    if (!chrome) await showChrome().catch(() => {});
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
manifest.notCaptured = real.map((m) => m.id).filter((id) => !manifest.shots[id]);
manifest.errors = [...new Set(manifest.errors)].slice(0, 20);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  JSON.stringify({
    captured: Object.keys(manifest.shots).length,
    failed: Object.keys(manifest.failed),
    notCaptured: manifest.notCaptured.length,
    errors: manifest.errors.length,
  }),
);
await browser.close();
