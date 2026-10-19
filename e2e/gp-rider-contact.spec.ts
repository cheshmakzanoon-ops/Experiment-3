import { expect, test, type Page } from '@playwright/test';
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
  if (!('output' in output)) throw new Error('Missing GP contact fixture bundle');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP contact fixture chunk');
  fixtureScript = chunk.code;
});

async function installFixture(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>GP production rider control contacts</title>');
  await page.addScriptTag({ content: fixtureScript });
  return errors;
}

// Each case constructs its own production WebGL scene. Keep the complete
// held/wet/rewind sequence together within the existing per-case deadline.
for (const id of ['gpr1', 'gpr2']) {
  for (const view of ['right-grip', 'right-peg', 'rider-corner']) {
    test(`${id} ${view} retains held, wet and rewound production-model contact poses`, async ({
      page,
    }, info) => {
      const errors = await installFixture(page);
      const sequence = await page.evaluate(
        ({ id, view }) => {
          const a = { wet: false, time: 2 },
            b = {
              wet: true,
              time: 4,
              frontBrake: 1,
              pose:
                view === 'rider-corner'
                  ? { chassisLean: 1.05, riderOffset: 0.21, tuck: 0, steer: 0.315 }
                  : { tuck: 0, steer: 0.28 },
            };
          return (
            window as unknown as {
              MotoGPReview: { captureBikeSequence: typeof captureBikeSequence };
            }
          ).MotoGPReview.captureBikeSequence(view, 'high', id, [a, b, b, a, b]);
        },
        { id, view },
      );
      for (const [i, result] of sequence.entries()) {
        expect(result.glError).toBe(0);
        expect(result.sourceFrameUnchanged).toBe(true);
        expect(result.instance).toBe(sequence[0].instance);
        expect(result.triangles).toBe(id === 'gpr1' ? 100713 : 93012);
        expect(result.calls).toBeLessThan(220);
        if (i > 1) expect(result.resources).toEqual(sequence[1].resources);
        if (i < 2)
          await info.attach(`${id}-${view}-${i === 0 ? 'riding' : 'braking-wet'}.png`, {
            body: Buffer.from(result.image.split(',')[1], 'base64'),
            contentType: 'image/png',
          });
      }
      expect(sequence[0].hash).not.toBe(sequence[1].hash);
      expect(sequence[0].hash).toBe(sequence[3].hash);
      expect(sequence[1].hash).toBe(sequence[2].hash);
      expect(sequence[1].hash).toBe(sequence[4].hash);
      await info.attach(`${id}-${view}-contact-receipt.json`, {
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
}

test('gpr1 rider recovery restores the original wrist and ankle cuff pose after riding', async ({
  page,
}, info) => {
  const errors = await installFixture(page);
  const recovery = await page.evaluate(() => {
    const a = { wet: false, time: 3, recovery: 1 as const },
      b = { wet: false, time: 5, pose: { tuck: 0, steer: -0.28 }, frontBrake: 1 };
    return (
      window as unknown as { MotoGPReview: { captureBikeSequence: typeof captureBikeSequence } }
    ).MotoGPReview.captureBikeSequence('rider-recovery', 'high', 'gpr1', [a, b, a]);
  });
  expect(recovery[0].hash).toBe(recovery[2].hash);
  expect(recovery[0].hash).not.toBe(recovery[1].hash);
  for (const result of recovery) {
    expect(result.glError).toBe(0);
    expect(result.instance).toBe(recovery[0].instance);
    expect(result.triangles).toBe(100713);
  }
  await info.attach('gpr1-rider-recovery.png', {
    body: Buffer.from(recovery[0].image.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
  expect(errors).toEqual([]);
});
