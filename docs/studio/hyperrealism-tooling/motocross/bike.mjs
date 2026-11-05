// usage: node bike.mjs <tag> '<json [[view, sample], ...]>'
import { build } from 'vite';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const tag = process.argv[2] || 'bike';
const cases = JSON.parse(process.argv[3] || '[["rear-tyre",{"mud":0.8,"wet":0.9}]]');
const built = await build({ configFile: false, logLevel: 'error', define: { __APEX_SOURCE_FINGERPRINT__: '"x"', __APEX_SOURCE_COMMIT__: 'null', __SUPPLIED_PLAYER__: 'false', __REVIEW_TOOLS__: 'false', __DEMO_BUILD__: 'false' }, build: { write: false, lib: { entry: resolve('e2e/fixtures/motocross-bike-review.ts'), name: 'MotocrossReview', formats: ['iife'] } } });
const o = Array.isArray(built) ? built[0] : built;
const code = o.output.find((c) => c.type === 'chunk').code;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 1500)); });
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
await page.setContent('<!doctype html><body style="margin:0"></body>');
await page.addScriptTag({ content: code });
let i = 0;
for (const [view, sample] of cases) {
  const r = await page.evaluate(([v, s]) => window.MotocrossReview.captureMotocrossBike('mx450', 'high', v, [s]), [view, sample]);
  const name = `/tmp/claude-0/-home-user-Experiment-3/77bc90d5-fa90-573c-91d6-9e500a2bf2c9/scratchpad/mx/${tag}-${i++}-${view}.png`;
  writeFileSync(name, Buffer.from(r[0].image.split(',')[1], 'base64'));
  console.log('wrote', name, 'glError', r[0].glError);
}
console.log('console:', logs.slice(0, 6).join('\n---\n') || 'clean');
await browser.close();
