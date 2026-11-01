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
  for (const name of ['surfacePreparation', 'gantryPreparation', 'lampPreparation'])
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

function graphicsQuery(gpuRead: () => unknown, scheduleRead: () => unknown) {
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
    gantryPreparation: undefined,
    lampPreparation: undefined,
    presentation: { diagnostics: scheduleRead },
    observePreparationReadiness,
    observeReadinessSnapshot,
  }) as () => { settled: boolean; readiness: unknown; readinessError: string | null };
}
it.each([undefined, null, new Error('new metadata failed')])(
  'new metadata failure %s cannot reject existing graphics query',
  (error) => {
    const original = Object.freeze({ settled: true });
    const query = graphicsQuery(
      () => original,
      () => {
        throw error;
      },
    );
    const observed = query();
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
