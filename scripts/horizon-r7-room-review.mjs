/** Fixed production facade comparison; not a hardware performance benchmark. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { browserBackend, requireBrowserBackend } from './browser-backend.ts';

const base = process.env.HORIZON_REVIEW_URL ?? 'http://127.0.0.1:5188';
const output = resolve(process.env.HORIZON_REVIEW_OUTPUT ?? 'test-results/horizon-r7-rooms');
const files = [
  'src/rendering/open-world/buildings.ts',
  'src/rendering/open-world/facade-interiors.ts',
  'src/rendering/open-world/facade-layout.ts',
  'e2e/fixtures/horizon-r7-rooms.ts',
];
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ]),
    ),
  );
const beforeHashes = await hashes();
const report = {
  started: new Date().toISOString(),
  completed: false,
  source: beforeHashes,
  notHardwarePerformance: true,
  errors: [],
  failedAssets: [],
  views: [],
};
const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: backend.headless,
  args: ['--no-sandbox', ...backend.args],
  executablePath: process.env.HORIZON_REVIEW_EXECUTABLE || undefined,
});
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) report.failedAssets.push({ url: r.url(), status: r.status() });
  });
  await page.goto(`${base}/e2e/fixtures/horizon-r7-rooms.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.horizonRooms?.ready);
  for (const view of [
    { name: 'day-front', night: false, angle: 0 },
    { name: 'day-left', night: false, angle: -3 },
    { name: 'day-right', night: false, angle: 3 },
    { name: 'night-front', night: true, angle: 0 },
    { name: 'night-street', night: true, angle: 5, wide: true },
  ]) {
    const result = await page.evaluate(
      (v) => window.horizonRooms.review(v.night, v.angle, v.wide),
      view,
    );
    requireBrowserBackend(backend.name, result.adapter);
    assert.equal(result.error, 0, 'WebGL error');
    assert.equal(result.contextLost, false, 'Lost graphics context');
    assert.equal(result.repeatDifference.changedPixels, 0, 'Control render is not repeatable');
    assert(result.difference.changedPixels > 40, 'Room depth must have visible pixel coverage');
    assert.deepEqual(result.before, result.after, 'Depth must not add draw calls or GPU resources');
    for (const mode of ['before', 'after']) {
      const bytes = Buffer.from(result[`${mode}Image`].split(',')[1], 'base64');
      const file = `${view.name}-${mode}.png`;
      await writeFile(resolve(output, file), bytes);
      result[`${mode}Image`] = {
        file,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }
    report.views.push({ ...view, ...result });
    console.log(
      'PASS',
      view.name,
      JSON.stringify({ difference: result.difference, resources: result.after }),
    );
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedAssets, []);
  assert.deepEqual(await hashes(), beforeHashes, 'Reviewed source changed during capture');
  report.completed = true;
} catch (error) {
  report.failure = String(error.stack ?? error);
  throw error;
} finally {
  report.finished = new Date().toISOString();
  await writeFile(resolve(output, 'review.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
