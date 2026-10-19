import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type {
  captureMotocrossDustLighting,
  captureMotocrossRoostLighting,
} from './fixtures/motocross-roost-lighting.ts';

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

test('motocross dust scatters actual sun and lamp light without glowing in the dark or allocating on replay', async ({
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
  if (!('output' in output)) throw new Error('Missing dust lighting fixture');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing dust lighting code');
  await page.setContent('<!doctype html><title>Motocross dust light response</title>');
  await page.addScriptTag({ content: script.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        MotocrossRoostLighting: {
          captureMotocrossDustLighting: typeof captureMotocrossDustLighting;
        };
      }
    ).MotocrossRoostLighting.captureMotocrossDustLighting(),
  );
  await info.attach('dust-light-response.json', {
    body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
  for (const sample of result.samples)
    if (['front-lit', 'back-lit', 'sky-lit', 'lamp-near'].includes(sample.label))
      await info.attach(`dust-${sample.label}.png`, {
        body: Buffer.from(sample.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
  const samples = Object.fromEntries(result.samples.map((sample) => [sample.label, sample]));
  expect(result.dust).toBeGreaterThan(20);
  expect(result.dust).toBeLessThanOrEqual(result.capacity);
  expect(result.capacity).toBe(2400);
  expect(result.sourceUnchanged).toBe(true);
  expect(samples.dark.energy).toBe(0);
  expect(samples['front-lit'].energy).toBeGreaterThan(0.1);
  expect(samples['back-lit'].energy).toBeGreaterThan(samples['front-lit'].energy * 1.5);
  expect(samples['back-lit-held'].hash).toBe(samples['back-lit'].hash);
  expect(samples['lamp-near'].energy).toBeGreaterThan(samples['lamp-far'].energy * 2);
  expect(samples['lamp-near'].rgb[0]).toBeGreaterThan(samples['lamp-near'].rgb[2]);
  expect(samples['spot-blue'].rgb[2]).toBeGreaterThan(samples['spot-blue'].rgb[0]);
  expect(samples['spot-away'].energy).toBe(0);
  expect(samples.fog.hash).not.toBe(samples['sky-lit'].hash);
  expect(samples['sky-restored'].hash).toBe(samples['sky-lit'].hash);
  expect(samples['sky-resized-back'].hash).toBe(samples['sky-lit'].hash);
  // Same physical drawing-buffer dimensions at 2× DPR must retain footprint.
  expect(samples['sky-dpr2'].width).toBe(samples['sky-lit'].width);
  expect(samples['sky-dpr2'].coverage).toBeCloseTo(samples['sky-lit'].coverage, 3);
  for (const sample of result.samples) {
    expect(sample.calls).toBe(1);
    expect(sample.resources).toEqual(samples.dark.resources);
    expect(sample.glError).toBe(0);
  }
  const atmosphere = Object.fromEntries(
    result.atmosphere.samples.map((sample) => [sample.label, sample]),
  );
  const native = atmosphere['atmosphere-native-fog'],
    clear = atmosphere['atmosphere-clear'];
  expect(result.atmosphere.materialCount).toBe(1);
  expect(clear.hash).not.toBe(native.hash);
  expect(atmosphere['atmosphere-local-fog'].hash).not.toBe(clear.hash);
  expect(atmosphere['atmosphere-local-held'].hash).toBe(atmosphere['atmosphere-local-fog'].hash);
  expect(atmosphere['atmosphere-restored'].hash).toBe(clear.hash);
  expect(clear.resources.geometries).toBe(native.resources.geometries);
  expect(clear.resources.textures).toBe(native.resources.textures);
  expect(clear.resources.programs).toBeLessThanOrEqual(native.resources.programs + 1);
  for (const sample of result.atmosphere.samples) {
    expect(sample.calls).toBe(1);
    if (sample !== native) expect(sample.resources).toEqual(clear.resources);
    expect(sample.glError).toBe(0);
  }
  expect(errors).toEqual([]);
});
