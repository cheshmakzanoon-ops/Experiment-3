import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { CAR_STRIDE, HEADER } from '../src/simulation/protocol.ts';
import type * as Fixture from './fixtures/engine-native-flashback-diagnostics.ts';

type NativeWindow = Window & { EngineNativeFlashbackDiagnostics: typeof Fixture };
let fixture: string;
let worker: string;

test.beforeAll(async () => {
  async function bundle(path: string, globalName?: string) {
    const result = await build({
      entryPoints: [resolve(path)],
      bundle: true,
      write: false,
      format: 'iife',
      globalName,
      platform: 'browser',
      target: 'es2022',
    });
    return result.outputFiles[0].text;
  }
  [fixture, worker] = await Promise.all([
    bundle(
      'e2e/fixtures/engine-native-flashback-diagnostics.ts',
      'EngineNativeFlashbackDiagnostics',
    ),
    bundle('src/workers/physics.worker.ts'),
  ]);
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_flashback_diagnostics__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native flashback diagnostic ownership</title>',
    }),
  );
  await page.goto('/__engine_native_flashback_diagnostics__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

test('native flashback preserves enabled diagnostics and their original ACK ownership', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors = await load(page);
  const report = await page.evaluate(
    (source) =>
      (window as unknown as NativeWindow).EngineNativeFlashbackDiagnostics
        .heldDiagnosticAcrossFlashback(source),
    worker,
  );
  await info.attach('native-flashback-diagnostics.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });

  expect(report.initial).toMatchObject({ bytes: (HEADER + CAR_STRIDE) * 4, cars: 1, tick: 0 });
  expect(report.oldPause).toMatchObject({ type: 'pauseState', value: true });
  expect(report.oldPause.tick).toBeGreaterThanOrEqual(180);
  expect(report.old.sample.tick).toBe(report.oldPause.tick);
  expect(report.toggles).toEqual([true]);

  // A completed native rewind is a surface/pose transaction. Its surface is
  // consumed and ACKed normally; only the engineering packet remains held.
  expect(report.atCompletion.order).toEqual(['flashback', 'surface', 'frame']);
  expect(report.atCompletion.completion).toMatchObject({ type: 'flashback', tick: 60 });
  expect(report.atCompletion.surface.time).toBe(report.atCompletion.completion.time);
  expect(report.atCompletion.frame).toMatchObject({
    tick: 60,
    time: Math.fround(report.atCompletion.completion.time),
    cars: 1,
  });
  expect(report.atCompletion.pause).toMatchObject({ type: 'pauseState', value: true, tick: 60 });
  expect(report.atCompletion.diagnostics).toBe(1);
  expect(report.surfaceAcks).toContainEqual({
    epoch: report.atCompletion.surface.epoch,
    sequence: report.atCompletion.surface.sequence,
  });

  // Native timer-driven frames advance without replenishing diagnostic credit.
  expect(report.held.pause.tick).toBeGreaterThanOrEqual(84);
  expect(report.held.advancingFrames.some((frame) => frame.tick > 60)).toBe(true);
  expect(report.held.diagnostics).toBe(1);
  expect(report.fresh.sample.tick).toBe(report.held.pause.tick);
  expect(report.freshPause).toMatchObject({ value: true, tick: report.fresh.sample.tick });
  expect(report.fresh.sample.tick + 12).toBeLessThan(report.old.sample.tick);
  expect(report.fresh.sample.time).toBeLessThan(report.old.sample.time);
  expect(report.fresh.epoch).toBe(report.old.epoch + 1);
  expect(report.fresh.sequence).toBe(report.old.sequence + 1);

  // Duplicate old-epoch and old-sequence tickets cannot release the new owner.
  expect(report.duplicate.pause.tick).toBeGreaterThanOrEqual(report.fresh.sample.tick + 24);
  expect(
    report.duplicate.advancingFrames.some((frame) => frame.tick >= report.fresh.sample.tick + 12),
  ).toBe(true);
  expect(report.duplicate.diagnostics).toBe(2);
  expect(report.next.sample.tick).toBe(report.duplicate.pause.tick);
  expect(report.nextPause).toMatchObject({ value: true, tick: report.next.sample.tick });
  expect(report.next.sample.time).toBeGreaterThan(report.fresh.sample.time);
  expect(report.next.epoch).toBe(report.fresh.epoch);
  expect(report.next.sequence).toBe(report.fresh.sequence + 1);
  expect(report.diagnosticCount).toBe(3);

  expect(report.allSamplesValid).toBe(true);
  expect(report.oldImmutable).toBe(true);
  expect(report.freshImmutable).toBe(true);
  expect(report.surfacesValid).toBe(true);
  expect(report.surfaceAcks).toHaveLength(report.surfaceCount);
  for (const returned of Object.values(report.returned)) {
    expect(returned.buffers).toBeGreaterThan(0);
    expect(returned.detached).toBe(returned.buffers);
    expect(returned.bytes).toBeGreaterThan(0);
  }
  expect(report.warnings).toEqual([]);
  expect(report.errors).toEqual([]);
  expect(errors).toEqual([]);
  expect(report.closed).toBe(true);
  expect(report.pending).toBe(0);
});
