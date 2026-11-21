import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { captureBikeSequence } from './fixtures/motogp-reference-review.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

async function loadBikeReview(page: Page) {
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
  await page.setContent('<title>Grand Prix surface review</title>');
  await page.addScriptTag({ content: chunk.code });
  return errors;
}

test('GP cockpit beads follow recorded rainfall and rewind on the same windscreen', async ({
  page,
}) => {
  const errors = await loadBikeReview(page);
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

test('GP paint reveals recorded fairing wear, holds the scratches and restores intact bodywork', async ({
  page,
}, info) => {
  const errors = await loadBikeReview(page);
  const frames = await page.evaluate(() => {
    const { BikeReview } = window as unknown as {
      BikeReview: { captureBikeSequence: typeof captureBikeSequence };
    };
    return BikeReview.captureBikeSequence(
      'bodywork',
      'mid',
      'gpr1',
      [1, 0.65, 0.3, 0.3, 1].map((frontFairingHealth) => ({
        wet: false,
        time: 2,
        pose: { frontFairingHealth },
      })),
    ).map(({ image, hash, fairingWear, instance, glError, resources }) => ({
      image,
      hash,
      fairingWear,
      instance,
      glError,
      resources,
    }));
  });
  const [clean, partial, scuffed, held, repaired] = frames;
  expect(partial.fairingWear).toBeCloseTo(0.5);
  expect(new Set([clean.hash, partial.hash, scuffed.hash]).size).toBe(3);
  expect(held.hash).toBe(scuffed.hash);
  expect(repaired.hash).toBe(clean.hash);
  for (const frame of frames) {
    expect(frame.instance).toBe(clean.instance);
    expect(frame.resources).toEqual(clean.resources);
    expect(frame.glError).toBe(0);
  }
  for (const [label, sample] of [
    ['intact', clean],
    ['scuffed', scuffed],
  ] as const)
    await info.attach('gp-fairing-' + label + '.png', {
      body: Buffer.from(sample.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  expect(errors).toEqual([]);
});
