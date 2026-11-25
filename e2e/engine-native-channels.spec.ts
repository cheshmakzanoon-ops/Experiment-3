import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-channels.ts';
import type { NativeClockSnapshot } from './fixtures/engine-worker-clock.ts';

type NativeWindow = Window & { EngineNativeChannels: typeof Fixture };
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
  fixture = await bundle('e2e/fixtures/engine-native-channels.ts', 'EngineNativeChannels');
  circuit = await bundle('e2e/fixtures/engine-native-channels-circuit.worker.ts');
  festival = await bundle('e2e/fixtures/engine-native-channels-festival.worker.ts');
});
async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_channels__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine channel ownership</title>',
    }),
  );
  await page.goto('/__engine_native_channels__');
  await page.addScriptTag({ content: fixture });
  return errors;
}
function nativeTransfers(snapshot: NativeClockSnapshot) {
  expect(snapshot.intervals).toBe(1);
  const frames = snapshot.transfers.frame;
  expect(frames.buffers).toBeGreaterThan(0);
  expect(frames.detached).toBe(frames.buffers);
  expect(frames.bytes).toBeGreaterThan(0);
}

test('native engineering credit bounds copied samples while real circuit physics advances', async ({
  page,
}, info) => {
  const errors = await load(page);
  const r = await page.evaluate(
    (source) => (window as unknown as NativeWindow).EngineNativeChannels.engineeringCredits(source),
    circuit,
  );
  await info.attach('native-engineering-credits.json', {
    body: JSON.stringify(r, null, 2),
    contentType: 'application/json',
  });
  expect(r.boot).toEqual({ kind: 'circuit', intervals: 1 });
  expect(r.stalled).toMatchObject({ tick: 360, steps: 360, probes: 1, packets: 1 });
  expect(r.forged).toMatchObject({ tick: 480, steps: 480, probes: 2, packets: 2 });
  expect(r.resetHeld).toMatchObject({ tick: 12, probes: 3, packets: 3 });
  expect(r.ticks).toEqual([0, 360, 480, 12]);
  expect(r.final.probes).toBe(4);
  expect(r.epochs[3]).toBeGreaterThan(r.epochs[2]);
  expect(r.sequences.every((value, i) => i === 0 || value > r.sequences[i - 1])).toBe(true);
  expect(r.immutable).toBe(true);
  expect(r.allValid).toBe(true);
  expect(r.errors).toEqual([]);
  expect(r.nativeErrors).toEqual([]);
  expect(errors).toEqual([]);
  expect(r.closed).toBe(true);
  expect(r.pending).toBe(0);
  nativeTransfers(r.transfers);
});

test('native motocross diagnostics accepts the real declared dirt contacts', async ({
  page,
}, info) => {
  const errors = await load(page);
  const r = await page.evaluate(
    (source) =>
      (window as unknown as NativeWindow).EngineNativeChannels.motocrossDiagnostics(source),
    circuit,
  );
  await info.attach('native-motocross-diagnostics.json', {
    body: JSON.stringify(r, null, 2),
    contentType: 'application/json',
  });
  expect(r.samples).toEqual([
    { tick: 0, surfaces: [6, 6, 6, 6], valid: true },
    { tick: 12, surfaces: [6, 6, 6, 6], valid: true },
  ]);
  expect(r.state.tick).toBe(12);
  expect(r.errors).toEqual([]);
  expect(r.nativeErrors).toEqual([]);
  expect(errors).toEqual([]);
  expect(r.closed).toBe(true);
  expect(r.pending).toBe(0);
});

test('native Festival status credit preserves ordered delivery and bounds prolonged host stalls', async ({
  page,
}, info) => {
  const errors = await load(page);
  const r = await page.evaluate(
    (source) => (window as unknown as NativeWindow).EngineNativeChannels.festivalCredits(source),
    festival,
  );
  await info.attach('native-festival-credits.json', {
    body: JSON.stringify(r, null, 2),
    contentType: 'application/json',
  });
  expect(r.boot).toEqual({ kind: 'festival', intervals: 1 });
  expect(r.full).toMatchObject({ tick: 756, steps: 756, statuses: 64, packets: 64 });
  expect(r.overloaded).toMatchObject({
    tick: 756,
    steps: 756,
    statuses: 64,
    packets: 64,
    commands: 0,
    throttle: 0,
    shift: 0,
  });
  expect(r.overloaded.frames).toBe(r.full.frames);
  expect(r.overloaded.playerToken).toBe(r.full.playerToken);
  expect(r.forged.tick).toBe(r.full.tick);
  expect(r.resumed).toMatchObject({ tick: 768, steps: 768, statuses: 65, packets: 65 });
  expect(r.duplicate).toMatchObject({ tick: 768, steps: 768, statuses: 65, packets: 65 });
  expect(r.reset).toMatchObject({ tick: 0, packets: 66, statuses: 66 });
  expect(r.reset.playerToken).toBeGreaterThan(r.full.playerToken);
  expect(r.commandBlocked.commands).toBe(0);
  expect(r.commandOrder).toEqual(['frame', 'status', 'command-result']);
  expect(r.traffic).toBe(true);
  expect(r.receipts).toEqual([
    {
      type: 'command-result',
      requestId: 71,
      error: 'Festival status delivery is busy. Please try again.',
    },
    {
      type: 'command-result',
      requestId: 72,
      error: 'Festival status delivery is busy. Please try again.',
    },
    { type: 'command-result', requestId: 73 },
  ]);
  expect(r.normalTicks).toBe(1200);
  expect(r.normalPackets).toBe(100);
  expect(r.normalStatusCalls).toBe(100);
  expect(r.sequences.every((value, i) => value === i + 1)).toBe(true);
  expect(r.immutable).toBe(true);
  expect(r.errors).toEqual([
    { type: 'error', message: 'Festival status delivery is busy. Please try again.', fatal: false },
  ]);
  expect(r.nativeErrors).toEqual([]);
  expect(errors).toEqual([]);
  expect(r.closed).toBe(true);
  expect(r.pending).toBe(0);
  nativeTransfers(r.transfers);
});

test('native circuit failure ignores queued revival and retires old diagnostic credit before fresh init', async ({
  page,
}, info) => {
  const errors = await load(page);
  const r = await page.evaluate(
    (source) => (window as unknown as NativeWindow).EngineNativeChannels.circuitTerminal(source),
    circuit,
  );
  await info.attach('native-circuit-terminal.json', {
    body: JSON.stringify(r, null, 2),
    contentType: 'application/json',
  });
  expect(r.failed).toMatchObject({ tick: 1, steps: 1, probes: 1 });
  expect(r.suppressed).toMatchObject({ tick: 1, steps: 1, probes: 1, packets: 1 });
  expect(r.reset).toMatchObject({ tick: 0, steps: 1, probes: 2, packets: 2 });
  expect(r.recovered).toMatchObject({ tick: 12, steps: 13, probes: 2 });
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0].message).toContain('Native circuit fault after completed step');
  expect(r.nativeErrors).toEqual([]);
  expect(errors).toEqual([]);
  expect(r.closed).toBe(true);
  expect(r.pending).toBe(0);
});

test('native Festival separates recoverable validation from terminal post-mutation failure', async ({
  page,
}, info) => {
  const errors = await load(page);
  const r = await page.evaluate(
    (source) => (window as unknown as NativeWindow).EngineNativeChannels.festivalTerminal(source),
    festival,
  );
  await info.attach('native-festival-terminal.json', {
    body: JSON.stringify(r, null, 2),
    contentType: 'application/json',
  });
  expect(r.validation).toEqual([
    { type: 'command-result', requestId: 40, error: 'Unknown festival event missing-native-event' },
  ]);
  expect(r.failed).toMatchObject({ tick: 0, steps: 0, commands: 2, statuses: 1 });
  expect(r.failed.playerToken).toBeGreaterThan(r.before.playerToken);
  expect(r.suppressed).toMatchObject({
    tick: 0,
    steps: 0,
    commands: 2,
    statuses: 1,
    playerToken: r.failed.playerToken,
  });
  expect(r.receipts).toEqual(r.validation);
  expect(r.reset).toMatchObject({ tick: 0, steps: 0, commands: 2, statuses: 2 });
  expect(r.reset.playerToken).toBeGreaterThan(r.failed.playerToken);
  expect(r.recovered).toMatchObject({ tick: 12, steps: 12, commands: 2, statuses: 3 });
  expect(r.errors).toEqual([
    { type: 'error', message: 'Native Festival fault after completed command', fatal: true },
  ]);
  expect(r.sequences).toEqual([1, 2, 3]);
  expect(r.nativeErrors).toEqual([]);
  expect(errors).toEqual([]);
  expect(r.closed).toBe(true);
  expect(r.pending).toBe(0);
});
