import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  observePreparationReadiness,
  observeReadinessSnapshot,
} from '../src/engine/babylon/readiness-observation.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';

it('reports absent owners as unknown readiness, not completed or drawable false', () => {
  expect(observePreparationReadiness()).toEqual({
    exists: false,
    completed: null,
    canDraw: null,
    errors: [],
  });
});
it('returns detached plain values without owner callbacks or resources', () => {
  const owner = Object.freeze({ completed: true, canDraw: true, resource: { secret: true } });
  const receipt = observePreparationReadiness(owner);
  expect(receipt).toEqual({ exists: true, completed: true, canDraw: true, errors: [] });
  receipt.completed = false;
  receipt.errors.push('local mutation');
  expect(owner.completed).toBe(true);
  expect(observePreparationReadiness(owner).errors).toEqual([]);
});
it.each([undefined, null, new Error('expired original deadline')])(
  'preserves unknown on getter failure %s without mutating owner or renewing budgets',
  (failure) => {
    const deadline = 120000;
    let completedReads = 0,
      canDrawReads = 0;
    const owner = Object.freeze({
      deadline,
      get completed() {
        completedReads++;
        return false;
      },
      get canDraw(): boolean {
        canDrawReads++;
        throw failure;
      },
    });
    const receipt = observePreparationReadiness(owner);
    expect(receipt.exists).toBe(true);
    expect(receipt.completed).toBe(false);
    expect(receipt.canDraw).toBeNull();
    expect(receipt.errors).toHaveLength(1);
    expect(owner.deadline).toBe(deadline);
    expect(completedReads).toBe(1);
    expect(canDrawReads).toBe(1);
  },
);
it('handles unprintable diagnostic errors without throwing', () => {
  const owner = {
    completed: true,
    get canDraw(): boolean {
      throw {
        toString() {
          throw new Error('secondary');
        },
      };
    },
  };
  expect(observePreparationReadiness(owner)).toEqual({
    exists: true,
    completed: true,
    canDraw: null,
    errors: ['canDraw: unreadable diagnostic error'],
  });
});
it('schedule snapshots never consume pending demand or change preparation ownership', () => {
  const schedule = new PresentationSchedule(),
    finish = schedule.prepare();
  for (let i = 0; i < 4; i++)
    expect(schedule.diagnostics()).toEqual({ requested: true, preparationCount: 1, pending: true });
  expect(schedule.shouldRender(true)).toBe(true);
  expect(schedule.diagnostics()).toEqual({ requested: false, preparationCount: 1, pending: true });
  finish();
  const snapshot = schedule.diagnostics();
  snapshot.requested = true;
  snapshot.preparationCount = 20;
  expect(schedule.diagnostics()).toEqual({ requested: false, preparationCount: 0, pending: false });
  expect(schedule.shouldRender(true)).toBe(false);
  schedule.request();
  expect(schedule.diagnostics().requested).toBe(true);
  expect(schedule.shouldRender(true)).toBe(true);
});
it('wires observation into existing diagnostics without GPU polling or scheduling changes', () => {
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  const body = source.slice(
    source.indexOf('function readGraphicsDiagnostics()'),
    source.indexOf("Object.defineProperty(window, 'babylonGraphicsDiagnostics'"),
  );
  expect(body).toContain('gpu?.diagnostics()');
  expect(body).toContain('schedule: presentation.diagnostics()');
  for (const name of [
    'surfacePreparation',
    'environmentPreparation?.gantry',
    'environmentPreparation?.lamps',
    'environmentPreparation?.banner',
  ])
    expect(body).toContain(`observePreparationReadiness(${name})`);
  for (const mutation of [
    '.ready(',
    '.frame(',
    '.prepare(',
    '.request(',
    '.reset(',
    '.shouldRender(',
    '.dispose(',
  ])
    expect(body).not.toContain(mutation);
});

function graphicsQuery(
  gpuRead: () => unknown,
  scheduleRead: () => unknown,
  environment: unknown = undefined,
) {
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  const body = source.slice(
    source.indexOf('function readGraphicsDiagnostics()'),
    source.indexOf("Object.defineProperty(window, 'babylonGraphicsDiagnostics'"),
  );
  return runInNewContext(`(${body})`, {
    gpu: { diagnostics: gpuRead },
    paused: true,
    stopped: false,
    resizePending: false,
    restartOwnership: { pending: false },
    graphicsRecovery: { restartRequired: false },
    surfacePreparation: undefined,
    environmentPreparation: environment,
    stripePreparation: undefined,
    presentation: { diagnostics: scheduleRead },
    observePreparationReadiness,
    observeReadinessSnapshot,
  }) as () => { settled: boolean; readiness: unknown; readinessError: string | null };
}
it.each([undefined, null, new Error('new metadata failed')])(
  'new metadata failure %s cannot reject existing graphics query',
  (error) => {
    const original = Object.freeze({ settled: true });
    let metadataCalls = 0;
    const query = graphicsQuery(
      () => original,
      () => {
        metadataCalls++;
        throw error;
      },
    );
    const observed = query();
    expect(metadataCalls).toBe(1);
    expect(observed.settled).toBe(true);
    expect(observed.readiness).toBeNull();
    expect(observed.readinessError).toBe(String(error));
    expect(original).toEqual({ settled: true });
  },
);
it.each([undefined, null, false, 0, '', new Error('original graphics query failed')])(
  'does not mask original graphics failure %s',
  (error) => {
    let metadataCalls = 0;
    const query = graphicsQuery(
      () => {
        throw error;
      },
      () => {
        metadataCalls++;
        return {};
      },
    );
    let caught = false;
    try {
      query();
    } catch (failure) {
      caught = true;
      expect(failure).toBe(error);
    }
    expect(caught).toBe(true);
    expect(metadataCalls).toBe(0);
  },
);
it('main read-only snapshot includes an absent banner owner as unknown without hiding graphics', () => {
  const result = graphicsQuery(
    () => ({ settled: true }),
    () => ({ requested: false, preparationCount: 0, pending: false }),
  )();
  expect(result.settled).toBe(true);
  expect(result.readinessError).toBeNull();
  expect(result.readiness).toMatchObject({
    owners: { banner: { exists: false, completed: null, canDraw: null, errors: [] } },
  });
});

it('reads actual staged batch owners without altering the legacy graphics observation', () => {
  const environment = {
    gantry: { completed: false, canDraw: false },
    lamps: { completed: false, canDraw: true },
    banner: { completed: true, canDraw: true },
  };
  let metadataCalls = 0;
  const result = graphicsQuery(
    () => ({ settled: false }),
    () => {
      metadataCalls++;
      return { requested: true, preparationCount: 3, pending: true };
    },
    environment,
  )();
  expect(metadataCalls).toBe(1);
  expect(result.readinessError).toBeNull();
  expect(result.settled).toBe(false);
  expect(result.readiness).toMatchObject({
    owners: {
      gantry: { exists: true, completed: false, canDraw: false, errors: [] },
      lamps: { exists: true, completed: false, canDraw: true, errors: [] },
      banner: { exists: true, completed: true, canDraw: true, errors: [] },
    },
    schedule: { requested: true, preparationCount: 3, pending: true },
  });
});

it('main read-only snapshot includes an absent stripe owner as unknown without hiding graphics', () => {
  const result = graphicsQuery(
    () => ({ settled: true }),
    () => ({ requested: false, preparationCount: 0, pending: false }),
  )();
  expect(result.settled).toBe(true);
  expect(result.readinessError).toBeNull();
  expect(result.readiness).toMatchObject({
    owners: { stripe: { exists: false, completed: null, canDraw: null, errors: [] } },
  });
});
