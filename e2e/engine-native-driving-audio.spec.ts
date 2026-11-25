import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-driving-audio.ts';

type NativeWindow = Window & { EngineNativeDrivingAudio: typeof Fixture };
type NativeReport = Awaited<ReturnType<typeof Fixture.disabledConfiguration>>;
let fixture: string;

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-driving-audio.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeDrivingAudio',
    platform: 'browser',
    target: 'es2022',
  });
  fixture = result.outputFiles[0].text;
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_driving_audio__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native driving audio</title><button>Enable test audio</button>',
    }),
  );
  await page.goto('/__engine_native_driving_audio__');
  await page.addScriptTag({ content: fixture });
  await page.getByRole('button', { name: 'Enable test audio' }).click();
  return errors;
}

function expectLifecycle(
  report: Pick<
    NativeReport,
    'lifecycle' | 'unhandled' | 'activation' | 'sampleRate' | 'frameCompatibility'
  >,
) {
  expect(report.activation).toBe(true);
  expect(report.sampleRate).toBe(48000);
  expect(report.frameCompatibility).toBeNull();
  expect(report.unhandled).toEqual([]);
  expect(report.lifecycle).toEqual({
    started: 'running',
    state: 'closed',
    ownerClosed: true,
    ownerState: 'uninitialized',
    cueStops: 1,
    retainedTrack: false,
    retainedDirector: false,
    retainedSynth: false,
    frameMutations: 0,
  });
}

function expectSignal(signal: NativeReport['signal'], audible: boolean) {
  for (const channel of [signal.cue, signal.mix]) {
    expect(channel.samples).toBeGreaterThanOrEqual(4800);
    expect(channel.finite).toBe(true);
    if (audible) {
      expect(channel.peak).toBeGreaterThan(0.005);
      expect(channel.peak).toBeLessThan(0.85);
      expect(channel.rms).toBeGreaterThan(0);
    } else {
      expect(channel.peak).toBe(0);
      expect(channel.rms).toBe(0);
    }
  }
}

function expectUpshift(automation: NativeReport['cases'][number]['automation']) {
  expect(automation).toHaveLength(6);
  const time = automation[0].args[1];
  expect(Number.isFinite(time)).toBe(true);
  expect(time).toBeGreaterThanOrEqual(0);
  expect(automation).toEqual([
    { parameter: 'frequency', method: 'setValueAtTime', args: [1100, time] },
    { parameter: 'pan', method: 'setValueAtTime', args: [0, time] },
    { parameter: 'gain', method: 'cancelScheduledValues', args: [time] },
    { parameter: 'gain', method: 'setValueAtTime', args: [0, time] },
    { parameter: 'gain', method: 'linearRampToValueAtTime', args: [0.35, time + 0.012] },
    { parameter: 'gain', method: 'linearRampToValueAtTime', args: [0, time + 0.09] },
  ]);
}

test('native disabled driving configurations never sample the track or schedule cue audio', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeDrivingAudio.disabledConfiguration(),
  );
  await info.attach('native-driving-audio-disabled.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(report.beforeStart).toMatchObject({
    state: 'uninitialized',
    trackSamples: 0,
    hasDirector: false,
    drivingCues: { last: null, emitted: 0 },
  });
  expect(report.cases.map((item) => item.name)).toEqual([
    'disabled',
    'zero volume',
    'all cue types disabled',
  ]);
  for (const item of report.cases) {
    expect(item.trackSamples).toBe(0);
    expect(item.hasDirector).toBe(false);
    expect(item.drivingCues).toMatchObject({ last: null, emitted: 0 });
    expect(item.automation).toEqual([]);
  }
  expectSignal(report.signal, false);
  expectLifecycle(report);
  expect(errors).toEqual([]);
});

test('native driving route builds at the first live-human update and survives same-track configuration', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeDrivingAudio.lazyRouteReuse(),
  );
  await info.attach('native-driving-audio-lazy-route.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  for (const item of [report.beforeStart, ...report.gated]) {
    expect(item.trackSamples).toBe(0);
    expect(item.hasDirector).toBe(false);
    expect(item.drivingCues).toEqual({ enabled: true, last: null, emitted: 0 });
  }
  expect(report.gated.map((item) => item.name)).toEqual(['paused', 'nonhuman', 'muted']);
  expectSignal(report.gatedSignal, false);
  expect(report.routeSamples).toBeGreaterThan(0);
  expect(report.routePoints).toBe(report.routeSamples);
  expect(report.first.trackSamples).toBe(report.routeSamples + 2);
  expect(report.reused.trackSamples).toBe(report.routeSamples + 4);
  expect(report.disabled.trackSamples).toBe(report.routeSamples + 4);
  expect(report.reenabled.trackSamples).toBe(report.routeSamples + 6);
  expect(report.first.drivingCues).toEqual({ enabled: true, last: 'upshift', emitted: 1 });
  expect(report.reused.drivingCues.emitted).toBe(1);
  expect(report.disabled.drivingCues).toEqual({ enabled: false, last: null, emitted: 1 });
  expect(report.reenabled.drivingCues).toEqual({ enabled: true, last: null, emitted: 1 });
  expect(report.retainedDirector).toBe(true);
  expect(report.retainedRoute).toBe(true);
  expectUpshift(report.automation);
  expectSignal(report.signal, true);
  expectLifecycle(report);
  expect(errors).toEqual([]);
});

test('native gear audio sounds near the TC1 limiter and suppresses GPR1 final-gear upshifts', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeDrivingAudio.vehicleGearCues(),
  );
  await info.attach('native-driving-audio-vehicle-gears.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(report.cases.map(({ vehicle, rpm, gear }) => ({ vehicle, rpm, gear }))).toEqual([
    { vehicle: 'gpr1', rpm: 18190, gear: 6 },
    { vehicle: 'gpr1', rpm: 18190, gear: 5 },
    { vehicle: 'tc1', rpm: 8090, gear: 3 },
  ]);
  const [finalGear, fifthGear, touring] = report.cases;
  expect(finalGear.drivingCues).toEqual({ enabled: true, last: null, emitted: 0 });
  expect(finalGear.emitted).toBe(0);
  expect(finalGear.automation).toEqual([]);
  expectSignal(finalGear.signal, false);
  for (const item of [fifthGear, touring]) {
    expect(item.drivingCues.last).toBe('upshift');
    expect(item.emitted).toBe(1);
    expectUpshift(item.automation);
    expectSignal(item.signal, true);
  }
  expect(report.cases.map((item) => item.trackSamples)).toEqual([
    report.routeSamples + 2,
    report.routeSamples + 4,
    report.routeSamples + 6,
  ]);
  expectLifecycle(report);
  expect(errors).toEqual([]);
});
