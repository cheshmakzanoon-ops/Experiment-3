import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureBikeSequence } from './fixtures/motogp-reference-review.ts';

let fixtureScript: string;
test.beforeAll(async () => {
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
  if (!('output' in output)) throw new Error('Missing GP brake fixture bundle');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP brake fixture chunk');
  fixtureScript = chunk.code;
});

for (const id of ['gpr1', 'gpr2']) {
  test(id + ' front brake retains wheel rotation, fork travel and wet replay restoration', async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setContent('<!doctype html><title>GP production carbon brake assembly</title>');
    await page.addScriptTag({ content: fixtureScript });
    const sequence = await page.evaluate((id) => {
      const dry = { wet: false, time: 2 };
      const braking = {
        wet: true,
        time: 6,
        frontBrake: 1,
        pose: { frontRotation: 0.29, fork: 0.08, steer: 0.12 },
      };
      return (
        window as unknown as {
          MotoGPReview: { captureBikeSequence: typeof captureBikeSequence };
        }
      ).MotoGPReview.captureBikeSequence('front-brake', 'high', id, [
        dry, braking, braking, dry,
      ]);
    }, id);
    for (const [index, result] of sequence.entries()) {
      expect(result.glError).toBe(0);
      expect(result.sourceFrameUnchanged).toBe(true);
      expect(result.instance).toBe(sequence[0].instance);
      expect(result.triangles).toBe(sequence[0].triangles);
      expect(result.triangles).toBeLessThan(110000);
      expect(result.calls).toBeLessThan(220);
      if (index > 1) expect(result.resources).toEqual(sequence[1].resources);
      if (index < 2)
        await info.attach(id + '-front-brake-' + (index ? 'loaded-wet' : 'dry') + '.png', {
          body: Buffer.from(result.image.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
    }
    expect(sequence[1].frontWheelRotation).toBe(0.29);
    expect(sequence[0].hash).not.toBe(sequence[1].hash);
    expect(sequence[1].hash).toBe(sequence[2].hash);
    expect(sequence[0].hash).toBe(sequence[3].hash);
    await info.attach(id + '-front-brake-receipt.json', {
      body: JSON.stringify(sequence.map(({ image: _image, ...sample }) => sample), null, 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
}
