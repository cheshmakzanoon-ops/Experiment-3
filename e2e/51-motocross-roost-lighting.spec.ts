import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { captureMotocrossRoostLighting } from './fixtures/motocross-roost-lighting.ts';

test('opaque motocross soil fragments respond to scene lighting while dust and contact remain bounded', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motocross-roost-lighting.ts'),
        name: 'MotocrossRoostLighting',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing roost lighting fixture');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing roost lighting code');
  await page.setContent('<!doctype html><title>Motocross soil fragment lighting</title>');
  await page.addScriptTag({ content: script.code });
  for (const wet of [false, true]) {
    const result = await page.evaluate(
      (wet) =>
        (
          window as unknown as {
            MotocrossRoostLighting: {
              captureMotocrossRoostLighting: typeof captureMotocrossRoostLighting;
            };
          }
        ).MotocrossRoostLighting.captureMotocrossRoostLighting(wet),
      wet,
    );
    const [whole, left, right, repeat, hidden] = result.samples;
    await info.attach(`${wet ? 'wet' : 'dry'}-roost-lighting.json`, {
      body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
    for (const sample of [whole, left, right])
      await info.attach(`${wet ? 'wet' : 'dry'}-${sample.label}.png`, {
        body: Buffer.from(sample.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    expect(result.sourceUnchanged).toBe(true);
    expect(result.clods).toBeGreaterThan(20);
    expect(result.clods).toBeLessThanOrEqual(result.active);
    expect(result.active).toBeLessThanOrEqual(2400);
    expect(left.hash).not.toBe(right.hash);
    expect(left.hash).not.toBe(hidden.hash);
    expect(right.hash).toBe(repeat.hash);
    expect(left.calls - hidden.calls).toBe(1);
    expect(left.triangles).toBe(result.clods * 20);
    for (const sample of result.samples) {
      expect(sample.glError).toBe(0);
      expect(sample.resources).toEqual(whole.resources);
    }
  }
  expect(errors).toEqual([]);
});
