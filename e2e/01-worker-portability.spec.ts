import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { verifyWorkerPortability } from './fixtures/worker-portability.ts';

test('physics and CSV workers run when the JS bundle is served from a different origin', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const built = await build({
    configFile: false,
    logLevel: 'error',
    worker: { format: 'es' },
    build: {
      write: false,
      target: 'es2022',
      lib: {
        entry: resolve('e2e/fixtures/worker-portability.ts'),
        name: 'PortabilityOracle',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing worker oracle build');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing worker oracle entry');
  const appOrigin = 'https://app.fixture.test';
  const assetOrigin = 'https://assets.fixture.test';
  const errors: string[] = [],
    workers: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (url === appOrigin + '/')
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>Two-origin worker acceptance</title><link rel="icon" href="data:,"><script src="${assetOrigin}/bundle.js" crossorigin="anonymous"></script>`,
      });
    else if (url === assetOrigin + '/bundle.js')
      await route.fulfill({
        contentType: 'text/javascript',
        headers: { 'Access-Control-Allow-Origin': appOrigin },
        body: chunk.code,
      });
    else {
      errors.push('Unexpected HTTP dependency: ' + url);
      await route.abort();
    }
  });
  await page.goto(appOrigin + '/');
  const measured = await page.evaluate(() =>
    (
      window as unknown as {
        PortabilityOracle: { verifyWorkerPortability: typeof verifyWorkerPortability };
      }
    ).PortabilityOracle.verifyWorkerPortability(),
  );
  await expect.poll(() => page.workers().length).toBe(0);
  await info.attach('worker-portability.json', {
    body: JSON.stringify({ measured, workers, requests, errors }, null, 2),
    contentType: 'application/json',
  });
  expect(measured.documentOrigin).toBe(appOrigin);
  expect(measured.tick).toBeGreaterThanOrEqual(130);
  expect(measured.finite).toBe(true);
  expect(measured.surfaceCells).toBe(3584);
  expect(measured.telemetryRows).toBeGreaterThanOrEqual(60);
  expect(measured.engineeringSamples).toBeGreaterThanOrEqual(5);
  // Frame and probe responses have independent delivery queues. Verify the
  // probe's actual tick cadence, not a possibly earlier render-frame timestamp.
  expect(measured.engineeringSamples).toBeLessThanOrEqual(
    1 + Math.floor(measured.engineeringTick / 12),
  );
  for (let i = 1; i < measured.engineeringTicks.length; i++)
    expect(measured.engineeringTicks[i] - measured.engineeringTicks[i - 1]).toBeGreaterThanOrEqual(
      12,
    );
  expect(measured.engineeringTick).toBeGreaterThanOrEqual(60);
  expect(measured.engineeringActive).toBe(true);
  expect(measured.csvColumns).toBe(203);
  expect(measured.csvExact).toBe(true);
  expect(measured.pickupColumns).toHaveLength(4);
  expect(workers).toHaveLength(2);
  expect(workers.every((url) => url.startsWith('blob:' + appOrigin + '/'))).toBe(true);
  expect(requests).toEqual([appOrigin + '/', assetOrigin + '/bundle.js']);
  expect(errors).toEqual([]);
});
