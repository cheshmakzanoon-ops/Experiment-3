import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { CAR_STRIDE, HEADER } from '../src/simulation/protocol.ts';
import type * as Fixture from './fixtures/engine-native-workers.ts';
import type { NativeClockSnapshot } from './fixtures/engine-worker-clock.ts';

type NativeWindow = Window & { EngineNativeWorkers: typeof Fixture };
let fixture: string;
let circuit: string;
let festival: string;

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
  fixture = await bundle('e2e/fixtures/engine-native-workers.ts', 'EngineNativeWorkers');
  circuit = await bundle('e2e/fixtures/engine-native-circuit.worker.ts');
  festival = await bundle('e2e/fixtures/engine-native-festival.worker.ts');
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_workers__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine workers</title>',
    }),
  );
  await page.goto('/__engine_native_workers__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

function detached(snapshot: NativeClockSnapshot) {
  expect(snapshot.intervals).toBe(1);
  for (const result of Object.values(snapshot.transfers)) {
    expect(result.detached).toBe(result.buffers);
    if (result.buffers) expect(result.bytes).toBeGreaterThan(0);
  }
}

test('actual circuit worker bounds native stalled transfers and orders rewind after its surface ACK', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors = await load(page);
  const report = await page.evaluate(
    (source) => (window as unknown as NativeWindow).EngineNativeWorkers.circuitTransfers(source),
    circuit,
  );
  await info.attach('native-circuit-transfer-recovery.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(report.boot).toEqual({ kind: 'circuit', intervals: 1 });
  expect(report.first).toMatchObject({
    bytes: (HEADER + CAR_STRIDE) * 4,
    cars: 1,
    tick: 0,
  });
  // The real session can begin at a seeded nonzero presentation time.
  expect(Number.isFinite(report.first.time)).toBe(true);
  expect(report.recordingRows).toEqual({ telemetry: 60, replay: 15 });
  expect(report.stalled).toEqual({ frames: 5, telemetry: 60, replay: 60, surfaces: 120 });
  expect(report.stalledSnapshot.now).toBe(62000);
  expect(report.stalledSnapshot.pumps).toBe(620);
  expect(report.recovered).toEqual({ frames: 6, telemetry: 61, replay: 61, surfaces: 120 });
  expect(report.restalled).toEqual(report.recovered);
  expect(report.returned).toEqual({ buffers: 3, detached: 3 });
  expect(report.warnings).toHaveLength(2);
  expect(
    report.warnings.filter((message) => message.startsWith('Telemetry capture gap:')),
  ).toHaveLength(1);
  expect(
    report.warnings.filter((message) => message.startsWith('Replay capture gap:')),
  ).toHaveLength(1);
  expect(report.pausedOrder).toEqual(['frame', 'pauseState']);
  expect(report.paused.tick).toBe(7680);
  expect(report.pauseReceipt).toEqual({
    type: 'pauseState',
    sequence: 2,
    value: true,
    tick: report.paused.tick,
  });
  expect(report.coalesced.order).toEqual(['surface']);
  expect(report.coalesced.surface.captureGap).toBe(true);
  expect(Math.fround(report.coalesced.surface.time)).toBe(report.paused.time);
  expect(report.beforeRewind.surfaces).toBe(121);
  expect(report.blocked.surfaces).toBe(report.beforeRewind.surfaces);
  expect(report.blocked.frames).toBe(report.beforeRewind.frames);
  expect(report.blocked.completions).toBe(0);
  expect(report.rewound.order).toEqual(['flashback', 'surface', 'frame']);
  expect(report.rewound.result).toEqual({
    type: 'flashback',
    tick: 60,
    time: report.rewound.surface.time,
  });
  expect(report.rewound.frame).toMatchObject({
    tick: 60,
    time: Math.fround(report.rewound.surface.time),
    cars: 1,
  });
  expect(report.rewound.surface.epoch).toBeGreaterThan(report.oldSurface.epoch);
  expect(report.rewound.surface.finite).toBe(true);
  expect(report.rewound.surface.lengths.every((length) => length > 0)).toBe(true);
  expect(report.beforeDuplicate).toBe(122);
  expect(report.afterDuplicate).toBe(report.beforeDuplicate);
  expect(report.afterSecondAck).toBe(report.beforeDuplicate + 1);
  expect(report.latestSurface.epoch).toBe(report.rewound.surface.epoch);
  expect(report.latestSurface.sequence).toBeGreaterThan(report.rewound.surface.sequence);
  expect(report.latestSurface.time).toBeGreaterThan(report.rewound.surface.time);
  expect(report.errors).toEqual([]);
  expect(errors).toEqual([]);
  expect(report.closed).toBe(true);
  expect(report.pendingControls).toBe(0);
  detached(report.stalledSnapshot);
  detached(report.final);
});

test('actual Festival worker retains native frame capacity across event field growth and shrink', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors = await load(page);
  const report = await page.evaluate(
    (source) => (window as unknown as NativeWindow).EngineNativeWorkers.festivalTransfers(source),
    festival,
  );
  await info.attach('native-festival-transfer-recovery.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(report.boot).toEqual({ kind: 'festival', intervals: 1 });
  expect(report.initialOrder).toEqual(['ready', 'frame', 'status']);
  expect(report.soloFrames).toHaveLength(4);
  expect(
    report.soloFrames.every((frame) => frame.bytes === report.soloBytes && frame.cars === 1),
  ).toBe(true);
  expect(report.growthOrder).toEqual(['frame', 'status', 'command-result']);
  expect(report.raceFrames).toHaveLength(4);
  expect(
    report.raceFrames.every((frame) => frame.bytes === report.raceBytes && frame.cars === 4),
  ).toBe(true);
  expect(report.afterOldReturn).toBe(8);
  expect(report.afterCurrentReturn).toBe(9);
  expect(report.afterRestall).toBe(report.afterCurrentReturn);
  expect(report.shrinkOrder).toEqual(['frame', 'status', 'command-result']);
  expect(report.shrunkFrames).toHaveLength(4);
  expect(
    report.shrunkFrames.every((frame) => frame.bytes === report.soloBytes && frame.cars === 1),
  ).toBe(true);
  expect(report.afterOldRaceReturns).toBe(report.beforeShrink + 4);
  expect(report.afterShrunkReturn).toBe(report.afterOldRaceReturns + 1);
  expect(report.afterShrunkRestall).toBe(report.afterShrunkReturn);
  expect(report.pausedOrder).toEqual(['frame', 'status']);
  expect(report.pausedCount).toBe(report.afterShrunkRestall + 1);
  expect(report.afterPausedAdvance).toBe(report.pausedCount);
  expect(report.results).toBe(1);
  expect(report.receipts).toEqual([
    { type: 'command-result', requestId: 11 },
    { type: 'command-result', requestId: 12 },
    { type: 'command-result', requestId: 13 },
  ]);
  expect(report.returned.buffers).toBeGreaterThan(3);
  expect(report.returned.detached).toBe(report.returned.buffers);
  expect(report.errors).toEqual([]);
  expect(errors).toEqual([]);
  expect(report.closed).toBe(true);
  expect(report.pendingControls).toBe(0);
  detached(report.final);
});
