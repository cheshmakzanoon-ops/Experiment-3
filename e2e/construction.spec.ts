import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { compareConstruction } from './construction-scene.ts';

test('progressive circuit construction preserves all geometry while yielding to the page', async ({
  page,
}, info) => {
  const bundled = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('e2e/construction-scene.ts'), name: 'Construction', formats: ['iife'] },
    },
  });
  const output = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in output)) throw new Error('No construction fixture');
  const code = output.output.find((entry) => entry.type === 'chunk');
  if (!code || code.type !== 'chunk') throw new Error('No executable construction fixture');
  await page.addScriptTag({ content: code.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as { Construction: { compareConstruction: typeof compareConstruction } }
    ).Construction.compareConstruction(),
  );
  expect(result.before.meshes).toBe(0);
  expect(result.expected).toEqual(result.actual);
  expect(result.actual.vertices).toBeGreaterThan(100000);
  expect(result.turns).toBeGreaterThan(2);
  expect(result.fraction.at(-1)).toBe(1);
  expect(result.statistics.tasks).toBeGreaterThan(100);
  await info.attach('construction-metrics.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});
