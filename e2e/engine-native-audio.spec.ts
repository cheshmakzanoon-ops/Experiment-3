import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-audio.ts';

type NativeWindow = Window & { EngineNativeAudio: typeof Fixture };
let fixture: string;

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-audio.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeAudio',
    platform: 'browser',
    target: 'es2022',
  });
  fixture = result.outputFiles[0].text;
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Only native audio and engine modules are exercised. No application assets,
  // microphone, physical output device, or existing browser profile is used.
  await page.route('**/__engine_native_audio__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine audio</title>',
    }),
  );
  await page.goto('/__engine_native_audio__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

test('native offline audio renders the complete low-rate schedule and releases ended voices', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeAudio.offlineCadence(),
  );
  expect(report.sampleRate).toBe(48000);
  expect(report.slow.bursts).toBe(140);
  expect(report.fast.bursts).toBeGreaterThanOrEqual(139);
  expect(report.fast.bursts).toBeLessThanOrEqual(140);
  for (const result of [report.slow, report.fast]) {
    expect(result.beforeRendering).toBe(0);
    expect(result.ownedBefore).toBe(result.bursts);
    expect(result.ended).toBe(result.bursts);
    expect(result.ownedAfter).toBe(0);
    expect(result.signal.finite).toBe(true);
    expect(result.signal.samples).toBe(499200);
    expect(result.signal.peak).toBeGreaterThan(0.001);
    expect(result.signal.peak).toBeLessThan(1);
  }
  expect(report.quiet.bursts).toBe(0);
  expect(report.quiet.ownedBefore).toBe(0);
  expect(report.quiet.ended).toBe(0);
  expect(report.quiet.signal.finite).toBe(true);
  expect(report.lateTransientRms).toHaveLength(4);
  for (const window of report.lateTransientRms) expect(window.rms).toBeGreaterThan(0.00001);
  expect(errors).toEqual([]);
  await info.attach('native-audio-complete-cadence.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

test('native audio reset cancels old future sound and filter automation before a new timeline', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeAudio.resetTimeline(),
  );
  for (const result of [report.cancelled, report.replaced]) {
    expect(result.oldBursts).toBe(10);
    expect(result.afterReset).toBe(0);
    expect(result.oldHandlersReleased).toBe(true);
    expect(result.ownedAfter).toBe(0);
    expect(result.signal.finite).toBe(true);
  }
  expect(report.cancelled.signal.peak).toBe(0);
  expect(report.cancelled.signal.rms).toBe(0);
  expect(report.cancelled.ownedBefore).toBe(0);
  expect(report.cancelled.ended).toBe(0);
  for (const result of [report.replaced, report.fresh]) {
    expect(result.ownedBefore).toBe(1);
    expect(result.ended).toBe(1);
    expect(result.ownedAfter).toBe(0);
    expect(result.signal.peak).toBeGreaterThan(0.001);
  }
  expect(report.differingSamples).toBe(0);
  expect(report.maxDifference).toBe(0);
  expect(errors).toEqual([]);
  await info.attach('native-audio-reset-replacement.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

test('native audio disposal silences scheduled voices and permanently closes the graph', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeAudio.disposedTimeline(),
  );
  expect(report.scheduled).toBe(10);
  expect(report.beforeDispose).toBe(10);
  expect(report.afterDispose).toBe(0);
  expect(report.finalBursts).toBe(report.scheduled);
  expect(report.ownedBefore).toBe(0);
  expect(report.ownedAfter).toBe(0);
  expect(report.ended).toBe(0);
  expect(report.signal.finite).toBe(true);
  expect(report.signal.peak).toBe(0);
  expect(report.signal.rms).toBe(0);
  expect(errors).toEqual([]);
  await info.attach('native-audio-disposal.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});
