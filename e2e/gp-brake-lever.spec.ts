import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureBikeSequence } from './fixtures/motogp-reference-review.ts';

test('GP front lever renders recorded squeeze, hold, release and rewind without new resources', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motogp-reference-review.ts'),
        name: 'MotoGPReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing GP lever fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP lever fixture chunk');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>GP production front-brake articulation</title>');
  await page.addScriptTag({ content: chunk.code });
  for (const id of ['gpr1', 'gpr2']) {
    const frames = await page.evaluate(
      (id) =>
        (
          window as unknown as {
            MotoGPReview: { captureBikeSequence: typeof captureBikeSequence };
          }
        ).MotoGPReview.captureBikeSequence('brake-lever', 'high', id, [
          { wet: false, time: 2, frontBrake: 0 },
          { wet: false, time: 3, frontBrake: 1 },
          { wet: false, time: 3, frontBrake: 1 },
          { wet: true, time: 8, frontBrake: 0.5 },
          { wet: false, time: 2, frontBrake: 0 },
        ]),
      id,
    );
    for (const [i, sample] of frames.entries()) {
      expect(sample.glError).toBe(0);
      expect(sample.instance).toBe(frames[0].instance);
      expect(sample.sourceFrameUnchanged).toBe(true);
      expect(sample.resources).toEqual(frames[0].resources);
      expect(sample.triangles).toBeLessThan(110000);
      expect(sample.calls).toBeLessThan(220);
      expect(sample.frontBrakeLever!.angle).toBeCloseTo(-0.25 * sample.frontBrake);
      expect(sample.frontBrakeLever!.world).toEqual(frames[0].frontBrakeLever!.world);
      if (i < 2)
        await info.attach(`${id}-lever-${i === 0 ? 'released' : 'squeezed'}.png`, {
          body: Buffer.from(sample.image.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
    }
    expect(frames[0].hash).not.toBe(frames[1].hash);
    expect(frames[1].hash).toBe(frames[2].hash);
    expect(frames[0].hash).toBe(frames[4].hash);
    await info.attach(`${id}-lever-metrics.json`, {
      body: JSON.stringify(
        frames.map(({ image: _image, ...sample }) => sample),
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
  expect(errors).toEqual([]);
});
