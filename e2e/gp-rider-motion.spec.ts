import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureBikeSequence } from './fixtures/motogp-reference-review.ts';

let script: string;
test.beforeAll(async () => {
  const built = await build({
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
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing GP motion review bundle');
  const chunk = result.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP motion review code');
  script = chunk.code;
});

for (const id of ['gpr1', 'gpr2']) {
  for (const view of ['rider-corner', 'right-peg']) {
    test(`${id} ${view} animates direction and pedal input with stable held and rewound poses`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setContent('<!doctype html><title>GP rider motion and rearsets</title>');
      await page.addScriptTag({ content: script });
      const samples = await page.evaluate(
        ({ id, view }) => {
          const resting = { wet: false, time: 2, pose: { rearBrake: 0 } },
            moving =
              view === 'right-peg'
                ? { wet: false, time: 3, pose: { rearBrake: 1 } }
                : {
                    wet: false,
                    time: 3,
                    frontBrake: 0.8,
                    pose: { chassisLean: -0.95, riderOffset: -0.2, tuck: 0.05, steer: 0.08 },
                  };
          return (
            window as unknown as {
              MotoGPReview: { captureBikeSequence: typeof captureBikeSequence };
            }
          ).MotoGPReview.captureBikeSequence(view, 'high', id, [resting, moving, moving, resting]);
        },
        { id, view },
      );
      expect(samples[0].hash).not.toBe(samples[1].hash);
      expect(samples[1].hash).toBe(samples[2].hash);
      expect(samples[0].hash).toBe(samples[3].hash);
      for (const sample of samples) {
        expect(sample.glError).toBe(0);
        expect(sample.sourceFrameUnchanged).toBe(true);
        expect(sample.instance).toBe(samples[0].instance);
        expect(sample.resources).toEqual(samples[0].resources);
        expect(sample.triangles).toBeLessThan(125000);
        expect(sample.calls).toBeLessThan(220);
      }
      if (view === 'right-peg') {
        expect(samples[0].rearBrakePedal?.angle).toBe(0);
        expect(samples[1].rearBrakePedal?.angle).toBeCloseTo(0.12, 8);
        expect(samples[3].rearBrakePedal?.angle).toBe(0);
      }
      for (let i = 0; i < 2; i++)
        await info.attach(`${id}-${view}-${i === 0 ? 'resting' : 'actuated'}.png`, {
          body: Buffer.from(samples[i].image.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
      await info.attach(`${id}-${view}-motion.json`, {
        body: JSON.stringify(samples, (key, value) => (key === 'image' ? undefined : value), 2),
        contentType: 'application/json',
      });
      expect(errors).toEqual([]);
    });
  }
}
