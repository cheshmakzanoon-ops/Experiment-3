import { transpileModule } from 'typescript';
import { SubmissionObservation } from '../src/engine/babylon/submission-observation.ts';
import { expect, it, vi } from 'vitest';
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
    source.indexOf('function readGraphicsDiagnostics('),
    source.indexOf("Object.defineProperty(window, 'babylonGraphicsDiagnostics'"),
  );
  expect(body).toContain('gpu?.diagnostics()');
  expect(body).toContain('schedule: presentation.diagnostics()');
  for (const name of [
    'surfacePreparation',
    'environmentPreparation?.gantry',
    'environmentPreparation?.lamps',
    'environmentPreparation?.banner',
    'environmentPreparation?.grid',
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
  visual: unknown = null,
  rejection: string | null = null,
  submissionObservation = new SubmissionObservation(),
) {
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  const body = source.slice(
    source.indexOf('function readGraphicsDiagnostics('),
    source.indexOf("Object.defineProperty(window, 'babylonGraphicsDiagnostics'"),
  );
  return runInNewContext(transpileModule(`(${body})`, {}).outputText, {
    submissionObservation,
    componentEpoch: 2,
    sceneEpoch: 1,
    restartSceneDecision: null,
    startupPublicationDecision: 'reused-completed-image',
    startupPublicationRejection: rejection,
    renderedStartupVisualState: visual,
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
  }) as (options?: boolean | { submissionObservation?: boolean }) => {
    submissionObservation?: ReturnType<SubmissionObservation['snapshot']> | null;
    settled: boolean;
    readiness: unknown;
    readinessError: string | null;
    startupPublicationDecision?: string | null;
    startupPublicationRejection?: string | null;
    startupVisualState?: {
      source: string;
      rejectionCode: string | null;
      state: string | null;
      sequence: number | null;
      tick: number;
    } | null;
  };
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
    for (const includeVisual of [false, true]) {
      let caught = false;
      try {
        query(includeVisual);
      } catch (failure) {
        caught = true;
        expect(failure).toBe(error);
      }
      expect(caught).toBe(true);
      expect(metadataCalls).toBe(0);
    }
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

it('opt-in visual evidence is a detached cached draw record, never fresh scene traversal', () => {
  const cached = {
    source: 'last-owned-paused-draw',
    rejectionCode: 'unsupported-texture',
    state: '["canonical CPU state"]',
    sequence: 6,
    tick: 43,
  };
  const query = graphicsQuery(
    () => ({ settled: true }),
    () => ({ pending: false }),
    undefined,
    cached,
  );
  expect(query()).not.toHaveProperty('startupVisualState');
  expect(query()).not.toHaveProperty('startupPublicationDecision');
  expect(query()).not.toHaveProperty('startupPublicationRejection');
  const observed = query(true);
  expect(observed.startupVisualState).toEqual(cached);
  expect(observed.startupPublicationDecision).toBe('reused-completed-image');
  expect(observed.startupPublicationRejection).toBeNull();
  expect(observed.startupVisualState?.rejectionCode).toBe('unsupported-texture');
  observed.startupVisualState!.state = 'changed locally';
  expect(cached.state).toBe('["canonical CPU state"]');
  expect(
    graphicsQuery(
      () => ({ settled: true }),
      () => ({}),
    )(true).startupVisualState,
  ).toBeNull();
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  const body = source.slice(
    source.indexOf('function readGraphicsDiagnostics('),
    source.indexOf("Object.defineProperty(window, 'babylonGraphicsDiagnostics'"),
  );
  expect(body).not.toContain('captureStartupVisualState(');
  expect(body).not.toContain('inspectStartupVisualState(');
  expect(body).not.toContain('isReady(');
});

it('clears startup rejection evidence with the existing surface restart/loss reset', () => {
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  const body = source.slice(
    source.indexOf('function clearSurfaceDiagnostics()'),
    source.indexOf('function readGraphicsDiagnostics('),
  );
  expect(body).toContain('startupPublicationRejection = null;');
  expect(body).toContain('renderedStartupVisualState = null;');
});

it('opt-in reports the cached actual publication rejection independently of GPU idle', () => {
  const query = graphicsQuery(
    () => ({ settled: true }),
    () => ({ pending: false }),
    undefined,
    {
      source: 'last-owned-paused-draw',
      state: null,
      rejectionCode: 'unsupported-texture',
      sequence: 6,
      tick: 43,
    },
    'unavailable-completion',
  );
  expect(query()).not.toHaveProperty('startupPublicationRejection');
  expect(query(true).startupPublicationRejection).toBe('unavailable-completion');
  expect(query(true).startupVisualState?.rejectionCode).toBe('unsupported-texture');
});

it('submission capture is explicit opt-in, isolated, and does not expose canonical visuals', () => {
  const observer = new SubmissionObservation();
  const query = graphicsQuery(
    () => ({ settled: true, losses: 0 }),
    () => ({}),
    undefined,
    null,
    null,
    observer,
  );
  expect(query()).not.toHaveProperty('submissionObservation');
  expect(observer.enabled).toBe(false);
  expect(query(true)).not.toHaveProperty('submissionObservation');
  expect(observer.enabled).toBe(false);
  const result = query({ submissionObservation: true });
  expect(observer.enabled).toBe(true);
  expect(result).not.toHaveProperty('startupVisualState');
  expect(result.submissionObservation).toMatchObject({
    version: 1,
    currentComponentEpoch: 2,
    currentSceneEpoch: 1,
    records: [],
  });
});
it.each([undefined, null, false, 0, ''])(
  'optional submission observer failure %s cannot mask original health',
  (failure) => {
    const observer = new SubmissionObservation();
    observer.snapshot = () => {
      throw failure;
    };
    const query = graphicsQuery(
      () => ({ settled: true, losses: 0 }),
      () => ({}),
      undefined,
      null,
      null,
      observer,
    );
    expect(query({ submissionObservation: true })).toMatchObject({
      settled: true,
      submissionObservation: null,
    });
    const broken = graphicsQuery(
      () => {
        throw failure;
      },
      () => ({}),
      undefined,
      null,
      null,
      observer,
    );
    let caught = false;
    try {
      broken({ submissionObservation: true });
    } catch (error) {
      caught = true;
      expect(error).toBe(failure);
    }
    expect(caught).toBe(true);
  },
);

it('main read-only snapshot exposes grid owner without allocating or invoking a receipt', () => {
  const receipt = vi.fn(() => {
    throw new Error('must not inspect resources');
  });
  const result = graphicsQuery(
    () => ({ settled: false }),
    () => ({ requested: true, preparationCount: 1, pending: true }),
    { grid: { completed: false, canDraw: true, receipt } },
  )();
  expect(result.readiness).toHaveProperty('owners.grid', {
    exists: true,
    completed: false,
    canDraw: true,
    errors: [],
  });
  expect(receipt).not.toHaveBeenCalled();
  const absent = graphicsQuery(
    () => ({}),
    () => ({}),
  )();
  expect(absent.readiness).toHaveProperty('owners.grid', {
    exists: false,
    completed: null,
    canDraw: null,
    errors: [],
  });
});

it('main observes the A09 preparation owner as plain readonly readiness without touching resource receipts', () => {
  const receipt = vi.fn(() => {
    throw new Error('resource traversal forbidden');
  });
  const owner = Object.freeze({ completed: false, canDraw: true, receipt });
  const query = graphicsQuery(
    () => ({ settled: true }),
    () => ({ requested: false, preparationCount: 1, pending: true }),
    Object.freeze({ brakingTriplet: owner }),
  );
  const observed = query();
  expect(observed.readiness).toHaveProperty('owners.brakingTriplet', {
    exists: true,
    completed: false,
    canDraw: true,
    errors: [],
  });
  expect(receipt).not.toHaveBeenCalled();
  expect(observed).not.toHaveProperty('startupVisualState');
  expect(observed).not.toHaveProperty('submissionObservation');
  const absent = graphicsQuery(
    () => ({ settled: false }),
    () => ({}),
  )();
  expect(absent.readiness).toHaveProperty('owners.brakingTriplet', {
    exists: false,
    completed: null,
    canDraw: null,
    errors: [],
  });
});
