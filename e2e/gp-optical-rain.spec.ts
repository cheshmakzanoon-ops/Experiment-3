import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { captureBikeSequence } from './fixtures/motogp-reference-review.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

test('GP cockpit beads follow recorded rainfall and rewind on the same windscreen', async ({
  page,
}) => {
  const bundle = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motogp-reference-review.ts'),
        name: 'BikeReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing motorcycle review bundle');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing motorcycle review code');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent('<title>Grand Prix wet cockpit</title>');
  await page.addScriptTag({ content: chunk.code });
  const frames = await page.evaluate(() => {
    const review = (
      window as unknown as { BikeReview: { captureBikeSequence: typeof captureBikeSequence } }
    ).BikeReview;
    const samples = [
      [8, 0],
      [8, 12],
      [9, 12],
      [9, 12],
      [8, 12],
      [8, 0],
    ] as const;
    return review
      .captureBikeSequence(
        'onboard',
        'high',
        'gpr2',
        samples.map(([time, rainMmH]) => ({ wet: true, time, rainMmH })),
      )
      .map(({ hash, instance, resources, sourceFrameUnchanged, glError }) => ({
        hash,
        instance,
        resources,
        sourceFrameUnchanged,
        glError,
      }));
  });
  expect(new Set(frames.map((f) => f.instance)).size).toBe(1);
  for (const frame of frames) {
    expect(frame.resources).toEqual(frames[0].resources);
    expect(frame.sourceFrameUnchanged).toBe(true);
    expect(frame.glError).toBe(0);
  }
  const [stopped, rain, moving, held, rewind, drained] = frames.map((f) => f.hash);
  expect(stopped).not.toBe(rain);
  expect(moving).not.toBe(rain);
  expect(held).toBe(moving);
  expect(rewind).toBe(rain);
  expect(drained).toBe(stopped);
  expect(errors).toEqual([]);
});
