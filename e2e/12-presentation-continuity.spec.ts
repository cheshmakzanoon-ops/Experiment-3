import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/presentation-continuity.ts';

async function load(page: Page) {
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
        entry: resolve('e2e/fixtures/presentation-continuity.ts'),
        name: 'ContinuityFixture',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('No continuity fixture bundle');
  const chunk = output.output.find((part) => part.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('No continuity fixture script');
  await page.setContent(
    '<!doctype html><title>Production presentation continuity GPU oracles</title>',
  );
  await page.addScriptTag({ content: chunk.code });
  return errors;
}

test('world-sized spray is lit, fogged, occluded, near-plane safe and repeatable on the real GPU', async ({
  page,
}, info) => {
  const errors = await load(page);
  const result = await page.evaluate(() =>
    (
      window as unknown as { ContinuityFixture: typeof Fixture }
    ).ContinuityFixture.verifySprayContinuityGPU(),
  );
  for (const capture of result.images)
    await info.attach(`${capture.view}.png`, {
      body: Buffer.from(capture.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  const { images: _images, ...metrics } = result;
  await info.attach('spray-continuity-metrics.json', {
    body: JSON.stringify({ ...metrics, errors }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.distant.changed).toBeGreaterThan(500);
  expect(result.nearby.width).toBeGreaterThan(120);
  expect(result.nearby.width).toBeGreaterThan(result.distant.width * 1.8);
  expect(result.nearby.width).toBeLessThan(result.distant.width * 2.2);
  expect(result.dim.energy).toBeLessThan(result.distant.energy * 0.5);
  expect(result.fogged.energy).toBeLessThan(result.distant.energy * 0.05);
  for (const key of ['occluded', 'nearPlane', 'behind', 'nonSpray', 'cleared'] as const)
    expect(result[key].changed, key).toBe(0);
  expect(result.distant.draws).toBe(1);
  expect(result.distant.triangles).toBe(2);
  expect(result.pauseExact).toBe(true);
  expect(result.rewindExact).toBe(true);
  expect(result.memoryAfter).toEqual(result.memoryBefore);
});

test('spectator reactions and mesh-to-card handoffs retain held and rewound colour/shadow state', async ({
  page,
}, info) => {
  const errors = await load(page);
  const result = await page.evaluate(() =>
    (
      window as unknown as { ContinuityFixture: typeof Fixture }
    ).ContinuityFixture.verifySpectatorContinuityGPU(),
  );
  for (const shot of result.captures)
    await info.attach(`${shot.view}.png`, {
      body: Buffer.from(shot.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('spectator-continuity-metrics.json', {
    body: JSON.stringify(
      { ...result, errors, captures: result.captures.map(({ image: _image, ...stats }) => stats) },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  for (const key of [
    'pauseExact',
    'rewindExact',
    'reactionVisible',
    'flinchVisible',
    'handoffExact',
    'cardVisible',
    'sourceUnchanged',
  ] as const)
    expect(result[key], key).toBe(true);
  expect(result.memoryAfter).toEqual(result.memoryBefore);
  const card = result.captures.find((c) => c.view === 'spectators-forced-card')!;
  const handoff = result.captures.find((c) => c.view === 'spectators-mesh-card-handoff')!;
  expect(card.activeLevels).toBe(1);
  expect(handoff.activeLevels).toBe(2);
  expect(card.triangles).toBeLessThan(100);
  expect(card.image.length).toBeGreaterThan(5000);
  expect(await page.locator('canvas').count()).toBe(0);
});
