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
  if (!('output' in output)) throw new Error('Missing GP rear fixture bundle');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP rear fixture script');
  fixtureScript = chunk.code;
});

for (const id of ['gpr1', 'gpr2']) {
  test(`${id} production rear structure preserves dry, loaded, wet and rewound frames`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setContent('<!doctype html><title>GP production rear chassis inspection</title>');
    await page.addScriptTag({ content: fixtureScript });
    const sequence = await page.evaluate((id) => {
      const a = { wet: false, time: 2 },
        b = { wet: false, time: 4, pose: { fork: 0.012, shock: 0.115 } },
        c = { ...b, wet: true };
      return (
        window as unknown as { MotoGPReview: { captureBikeSequence: typeof captureBikeSequence } }
      ).MotoGPReview.captureBikeSequence('rear-chassis', 'high', id, [a, b, c, c, a, b]);
    }, id);
    expect(sequence[0].hash).not.toBe(sequence[1].hash);
    expect(sequence[1].hash).not.toBe(sequence[2].hash);
    expect(sequence[2].hash).toBe(sequence[3].hash);
    expect(sequence[0].hash).toBe(sequence[4].hash);
    expect(sequence[1].hash).toBe(sequence[5].hash);
    for (const [i, result] of sequence.entries()) {
      expect(result.glError).toBe(0);
      expect(result.sourceFrameUnchanged).toBe(true);
      expect(result.instance).toBe(sequence[0].instance);
      expect(result.triangles).toBe(sequence[0].triangles);
      expect(result.triangles).toBeLessThan(110000);
      expect(result.calls).toBeLessThan(220);
      if (i > 1) expect(result.resources).toEqual(sequence[1].resources);
      if (i < 3)
        await info.attach(`${id}-rear-${['static-dry', 'loaded-dry', 'loaded-wet'][i]}.png`, {
          body: Buffer.from(result.image.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
    }
    await info.attach(`${id}-rear-chassis-receipt.json`, {
      body: JSON.stringify(
        sequence.map(({ image: _image, ...value }) => value),
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
}
