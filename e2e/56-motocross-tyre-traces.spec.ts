import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { captureMxTyrePassage } from './fixtures/motocross-tyre-traces.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

test('grounded MX and SX tyres leave reversible prints in photographed dirt on WebGL2', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const built = await build({
    configFile: false,
    logLevel: 'error',
    define: fixtureDefine(),
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motocross-tyre-traces.ts'),
        name: 'MxTyrePassage',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing tyre passage fixture output');
  const script = output.output.find((entry) => entry.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing tyre passage script');
  await page.route('**/mx-tyre-passage.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Tyre impressions on measured ground</title>',
    }),
  );
  await page.goto('/mx-tyre-passage.html');
  await page.addScriptTag({ content: script.code });
  for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
    const result = await page.evaluate(
      (circuit) =>
        (
          window as unknown as {
            MxTyrePassage: { captureMxTyrePassage: typeof captureMxTyrePassage };
          }
        ).MxTyrePassage.captureMxTyrePassage(circuit),
      circuit,
    );
    for (const state of ['before', 'after'] as const)
      await info.attach(circuit + '-tyre-trace-' + state + '.png', {
        body: Buffer.from(result[state].split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await info.attach(circuit + '-tyre-trace-metrics.json', {
      body: JSON.stringify({ ...result, before: undefined, after: undefined }),
      contentType: 'application/json',
    });
    expect(result.errors).toEqual([0, 0, 0, 0]);
    expect(result.segments).toBeGreaterThanOrEqual(300);
    expect(result.changed).toBeGreaterThan(100);
    expect(result.changed).toBeLessThan(result.width * result.height * 0.35);
    expect(result.calls[1] - result.calls[0]).toBe(1);
    expect(result.hashes[0]).toBe(result.hashes[2]);
    expect(result.hashes[1]).toBe(result.hashes[3]);
  }
  expect(errors).toEqual([]);
});
