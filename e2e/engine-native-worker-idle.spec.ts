import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { CAR_STRIDE, HEADER } from '../src/simulation/protocol.ts';
import type * as Fixture from './fixtures/engine-native-worker-idle.ts';
import type {
  IdleObservation,
  IntervalSnapshot,
} from './fixtures/engine-native-worker-idle-observer.ts';

type NativeWindow = Window & { EngineNativeWorkerIdle: typeof Fixture };
let fixture: string;
let worker: string;

test.beforeAll(async () => {
  const bundle = async (path: string, globalName?: string) => {
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
  };
  const [host, observer, production] = await Promise.all([
    bundle('e2e/fixtures/engine-native-worker-idle.ts', 'EngineNativeWorkerIdle'),
    bundle('e2e/fixtures/engine-native-worker-idle-observer.ts'),
    bundle('src/workers/physics.worker.ts'),
  ]);
  fixture = host;
  // Separate IIFEs enforce prelude order. A static import in the observer
  // would execute the production module before installing timer observation.
  worker = observer + '\n;\n' + production;
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_worker_idle__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native physics worker timer ownership</title>',
    }),
  );
  await page.goto('/__engine_native_worker_idle__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

function expectSnapshot(snapshot: IntervalSnapshot) {
  expect(Number.isFinite(snapshot.time)).toBe(true);
  expect(snapshot.scheduled).toBe(snapshot.owners.length);
  expect(snapshot.cancelled).toBe(
    snapshot.owners.filter((owner) => owner.cancelledAt !== null).length,
  );
  expect(snapshot.callbacks).toBe(
    snapshot.owners.reduce((total, owner) => total + owner.callbacks, 0),
  );
  expect(snapshot.callbacksAfterCancel).toBe(0);
  expect(snapshot.maxActive).toBe(1);
  expect(snapshot.activeOwners).toEqual(
    snapshot.owners.filter((owner) => owner.cancelledAt === null).map((owner) => owner.owner),
  );
  expect(snapshot.owners.map((owner) => owner.owner)).toEqual(
    Array.from({ length: snapshot.scheduled }, (_, index) => index + 1),
  );
  for (const owner of snapshot.owners) {
    expect(owner.delay).toBe(4);
    expect(Number.isSafeInteger(owner.handle)).toBe(true);
    expect(owner.handle).toBeGreaterThan(0);
    expect(Number.isFinite(owner.scheduledAt)).toBe(true);
    expect(owner.callbacksAfterCancel).toBe(0);
    if (owner.cancelledAt !== null) {
      expect(owner.cancelledAt).toBeGreaterThanOrEqual(owner.scheduledAt);
      expect(typeof owner.cancelledInCallback).toBe('boolean');
    }
  }
}

function expectParked(observation: IdleObservation) {
  expect(observation.requestedMs).toBe(80);
  // The exact worker-monotonic interval remains in the attached evidence.
  // Allow timer granularity without accepting an immediate/fabricated window.
  expect(observation.after.time - observation.before.time).toBeGreaterThanOrEqual(60);
  expect(observation.before.activeOwners).toEqual([]);
  expect(observation.after.activeOwners).toEqual([]);
  expect(observation.after.scheduled).toBe(observation.before.scheduled);
  expect(observation.after.cancelled).toBe(observation.before.cancelled);
  expect(observation.after.callbacks).toBe(observation.before.callbacks);
  expect(observation.after.owners).toEqual(observation.before.owners);
}

test('native worker parks every idle owner and wakes only runnable physics or resimulation', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors = await load(page);
  const report = await page.evaluate(
    (source) =>
      (window as unknown as NativeWindow).EngineNativeWorkerIdle.idleLifecycle(source),
    worker,
  );
  await info.attach('native-worker-idle-ownership.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });

  const observations = [
    report.bootstrap,
    report.uninitialized,
    report.initialized,
    report.running,
    ...report.repeated,
    report.paused,
    report.rewound,
    report.resumed,
    report.terminal,
    report.failed,
    report.recovered,
    report.final,
  ];
  for (const observation of observations) {
    expectSnapshot(observation.before);
    expectSnapshot(observation.after);
  }
  expect(report.bootstrap.after).toMatchObject({
    scheduled: 1,
    cancelled: 1,
    callbacks: 1,
    activeOwners: [],
  });
  expect(report.bootstrap.after.owners[0]).toMatchObject({
    activeAfterLastCallback: false,
    cancelledInCallback: true,
  });
  for (const parked of [
    report.uninitialized,
    report.initialized,
    report.paused,
    report.rewound,
    report.failed,
    report.recovered,
    report.final,
  ])
    expectParked(parked);

  expect(report.initial).toMatchObject({
    bytes: (HEADER + CAR_STRIDE) * 4,
    cars: 1,
    tick: 0,
  });
  expect(report.initialized.after.scheduled).toBe(1);
  expect(report.running.after).toMatchObject({
    scheduled: 2,
    cancelled: 1,
    activeOwners: [2],
  });
  expect(report.running.after.owners[1].callbacks).toBeGreaterThan(0);
  expect(report.running.after.owners[1].activeAfterLastCallback).toBe(true);
  expect(report.repeated).toHaveLength(3);
  for (const repeated of report.repeated)
    expect(repeated.after).toMatchObject({
      scheduled: 2,
      cancelled: 1,
      activeOwners: [2],
    });
  expect(report.pause).toMatchObject({ type: 'pauseState', value: true });
  expect(report.pause.tick).toBeGreaterThanOrEqual(120);
  expect(report.pauseFrame.tick).toBe(report.pause.tick);
  expect(report.paused.after).toMatchObject({ scheduled: 2, cancelled: 2, activeOwners: [] });
  expect(report.paused.after.owners[1].cancelledInCallback).toBe(false);

  expect(report.completion).toMatchObject({ type: 'flashback', tick: 60 });
  expect(report.rewindOrder).toEqual(['flashback', 'surface', 'frame']);
  expect(report.rewindFrame).toMatchObject({
    tick: 60,
    time: Math.fround(report.completion.time),
    cars: 1,
  });
  expect(report.rewindPause).toMatchObject({ value: true, tick: 60 });
  expect(report.rewound.after).toMatchObject({ scheduled: 3, cancelled: 3, activeOwners: [] });
  expect(report.rewound.after.owners[2].callbacks).toBeGreaterThan(0);
  // This must retire inside the real finishing interval callback. A later
  // recycle/observer/pause message must not conceal a missed callback cleanup.
  expect(report.rewound.after.owners[2]).toMatchObject({
    activeAfterLastCallback: false,
    cancelledInCallback: true,
  });
  expect(report.rewound.after.owners[1]).toEqual(report.paused.after.owners[1]);

  expect(report.resumed.after).toMatchObject({
    scheduled: 4,
    cancelled: 3,
    activeOwners: [4],
  });
  expect(report.resumed.after.owners[3].callbacks).toBeGreaterThan(0);
  expect(report.terminalError).toBe('Invalid worker pause sequence');
  expect(report.terminalErrors).toEqual(['Invalid worker pause sequence']);
  expect(report.terminal.after).toMatchObject({ scheduled: 4, cancelled: 4, activeOwners: [] });
  expect(report.failed.after.callbacks).toBe(report.terminal.after.callbacks);
  expect(report.ignored.messagesAfter).toBe(report.ignored.messagesBefore);
  expect(report.ignored.framesAfter).toBe(report.ignored.framesBefore);

  expect(report.recoveredFrame).toMatchObject({ tick: 0, cars: 1 });
  expect(report.recovered.after).toMatchObject({ scheduled: 4, cancelled: 4, activeOwners: [] });
  expect(report.recoveryProgress.tick).toBeGreaterThanOrEqual(24);
  expect(report.recoveryPause).toMatchObject({ value: true });
  expect(report.recoveryPause.tick).toBeGreaterThanOrEqual(report.recoveryProgress.tick);
  expect(report.recoveryPauseFrame.tick).toBe(report.recoveryPause.tick);
  expect(report.final.after).toMatchObject({ scheduled: 5, cancelled: 5, activeOwners: [] });
  expect(report.final.after.owners[4].callbacks).toBeGreaterThan(0);

  for (const returned of Object.values(report.returned)) {
    expect(returned.buffers).toBeGreaterThan(0);
    expect(returned.detached).toBe(returned.buffers);
    expect(returned.bytes).toBeGreaterThan(0);
  }
  expect(report.surfaceCount).toBeGreaterThan(0);
  expect(report.surfaceAcks).toBe(report.surfaceCount);
  expect(report.surfacesValid).toBe(true);
  expect(report.warnings).toEqual([]);
  expect(report.errors).toEqual([]);
  expect(errors).toEqual([]);
  expect(report.closed).toBe(true);
  expect(report.pending).toBe(0);
});
