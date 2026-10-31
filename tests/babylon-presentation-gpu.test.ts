import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import {
  BabylonPresentationGpu,
  cleanupPresentation,
} from '../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
function fixture() {
  const state = { wait: 2, lost: false, allocationFails: false, now: 0 };
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    isContextLost: () => state.lost,
    clientWaitSync: vi.fn(() => state.wait),
    fenceSync: vi.fn(() => (state.allocationFails ? null : {})),
    deleteSync: vi.fn(),
    flush: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  return {
    state,
    gl,
    gpu: new BabylonPresentationGpu(gl, () => state.now),
    schedule: new PresentationSchedule(),
  };
}
it('does not consume paused invalidations while busy; observes completion before the next submission', () => {
  const { gpu, state, schedule, gl } = fixture(),
    owner = {},
    draw = vi.fn(() => true),
    receipt = vi.fn();
  gpu.subscribe(receipt);
  expect(gpu.frame(schedule, true, owner, draw)).toBe(true);
  schedule.request();
  let simulationTicks = 0;
  for (let i = 0; i < 20; i++) {
    simulationTicks++;
    gpu.frame(schedule, true, owner, draw);
  }
  expect(simulationTicks).toBe(20);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(receipt).not.toHaveBeenCalled();
  state.wait = gl.CONDITION_SATISFIED;
  expect(gpu.frame(schedule, true, owner, draw)).toBe(true);
  expect(receipt).toHaveBeenCalledWith({ kind: 'completed', owner, ready: true, sequence: 1 });
  expect(draw).toHaveBeenCalledTimes(2);
  expect(gpu.frame(schedule, true, owner, draw)).toBe(false);
  expect(gpu.diagnostics()).toMatchObject({ submitted: 2, completed: 2 });
});
it('retains ownership across scene reset and gates queued resize work', () => {
  const { gpu, state, schedule, gl } = fixture(),
    oldScene = {},
    newScene = {},
    draw = vi.fn(() => true),
    resize = vi.fn();
  gpu.frame(schedule, false, oldScene, draw);
  schedule.reset();
  if (gpu.ready()) resize();
  expect(gpu.frame(schedule, false, newScene, draw)).toBe(false);
  expect(resize).not.toHaveBeenCalled();
  state.wait = gl.ALREADY_SIGNALED;
  if (gpu.ready()) resize();
  expect(resize).toHaveBeenCalledTimes(1);
  expect(gpu.frame(schedule, false, newScene, draw)).toBe(true);
});
it('does not fence failed draws and fails closed on fence allocation failure', () => {
  const { gpu, state, schedule, gl } = fixture();
  expect(() =>
    gpu.frame(schedule, false, {}, () => {
      throw new Error('draw failed');
    }),
  ).toThrow('draw failed');
  expect(gl.fenceSync).not.toHaveBeenCalled();
  state.allocationFails = true;
  expect(() => gpu.frame(schedule, false, {}, () => true)).toThrow('Unable to allocate');
  expect(gpu.frame(schedule, false, {}, () => true)).toBe(false);
  expect(gpu.diagnostics().submitted).toBe(0);
});
it('does not count invalid pre-loss fences as completed and never revives disposed ownership', () => {
  const { gpu, state, schedule, gl } = fixture(),
    listener = vi.fn();
  gpu.subscribe(listener);
  gpu.frame(schedule, false, {}, () => true);
  state.lost = true;
  gpu.contextLost();
  expect(listener).toHaveBeenCalledWith({ kind: 'lost' });
  expect(gpu.ready()).toBe(false);
  state.lost = false;
  gpu.contextRestored();
  schedule.request();
  expect(gpu.ready()).toBe(true);
  expect(gpu.diagnostics().completed).toBe(0);
  gpu.frame(schedule, false, {}, () => true);
  gpu.dispose();
  expect(gl.deleteSync).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenLastCalledWith({ kind: 'disposed' });
  gpu.contextRestored();
  expect(gpu.ready()).toBe(false);
  expect(gpu.frame(schedule, false, {}, () => true)).toBe(false);
});

it('does not count a pre-import in-flight frame for a newly registered asset waiter', () => {
  const { gpu, state, schedule, gl } = fixture(),
    listener = vi.fn(),
    owner = {};
  gpu.frame(schedule, false, owner, () => true);
  const unsubscribe = gpu.subscribe(listener);
  state.wait = gl.ALREADY_SIGNALED;
  gpu.ready();
  expect(listener).not.toHaveBeenCalled();
  gpu.frame(schedule, false, owner, () => true);
  gpu.ready();
  expect(listener).toHaveBeenCalledWith({ kind: 'completed', owner, ready: true, sequence: 2 });
  unsubscribe();
  gpu.dispose();
  expect(listener).toHaveBeenCalledTimes(1);
});
it('continues fatal ownership cleanup after an individual disposer throws', () => {
  const calls: string[] = [];
  const failures = cleanupPresentation([
    () => {
      calls.push('stop-loop');
    },
    () => {
      calls.push('dispose-scene');
      throw new Error('cleanup failed');
    },
    () => {
      calls.push('dispose-engine');
    },
  ]);
  expect(calls).toEqual(['stop-loop', 'dispose-scene', 'dispose-engine']);
  expect(failures).toHaveLength(1);
});

it('settles a restored paused frame without inventing completion of the abandoned frame', () => {
  const { gpu, state, schedule, gl } = fixture(),
    owner = {};
  gpu.frame(schedule, true, owner, () => true);
  state.lost = true;
  gpu.contextLost();
  expect(gpu.diagnostics()).toMatchObject({
    submitted: 1,
    completed: 0,
    abandoned: 1,
    settled: false,
  });
  state.lost = false;
  gpu.contextRestored();
  schedule.request();
  expect(gpu.frame(schedule, true, owner, () => true)).toBe(true);
  expect(gpu.diagnostics().settled).toBe(false);
  state.wait = gl.CONDITION_SATISFIED;
  expect(gpu.frame(schedule, true, owner, () => true)).toBe(false);
  expect(schedule.pending).toBe(false);
  expect(gpu.diagnostics()).toMatchObject({
    submitted: 2,
    completed: 1,
    abandoned: 1,
    lastCompletedSequence: 2,
    settled: true,
  });
});

it('guards startup after the asynchronous settings read before constructing resources', () => {
  const source = readFileSync(new URL('../src/engine/babylon/main.ts', import.meta.url), 'utf8');
  const pagehide = source.indexOf("window.addEventListener('pagehide'");
  const read = source.indexOf("await new SaveStore().read('settings')");
  const guard = source.indexOf('abort.signal.throwIfAborted();', read);
  const input = source.indexOf('input = new InputController', read);
  const engine = source.indexOf('engine = new Engine', read);
  expect(pagehide).toBeGreaterThan(-1);
  expect(read).toBeGreaterThan(pagehide);
  expect(guard).toBeGreaterThan(read);
  expect(input).toBeGreaterThan(guard);
  expect(engine).toBeGreaterThan(input);
  const stop = source.slice(source.indexOf('function stop('), source.indexOf('function reset()'));
  expect(stop).toContain('abort.abort()');
});

it('retains an independent pre-clear loss receipt across restoration without inventing completion', () => {
  const { gpu, state, schedule } = fixture();
  gpu.frame(schedule, false, {}, () => {
    state.now = 7;
    return true;
  });
  state.now = 107;
  gpu.ready();
  state.lost = true;
  gpu.contextLost();
  const snapshot = gpu.diagnostics();
  expect(snapshot.lastLoss).toMatchObject({
    number: 1,
    phase: 'waiting',
    pendingSequence: 1,
    submitted: 1,
    completed: 0,
    lastDrawCpuMs: 7,
    drawStartedAtMs: null,
    queue: { pending: true, pendingMs: 100, activeWaitMs: 100, submitted: 1, completed: 0 },
  });
  snapshot.lastLoss!.queue.pendingMs = -1;
  snapshot.lastLoss!.pendingSequence = -1;
  snapshot.queue.pendingMs = -1;
  state.lost = false;
  gpu.contextRestored();
  expect(gpu.diagnostics()).toMatchObject({
    completed: 0,
    losses: 1,
    phase: 'idle',
    lastLoss: { pendingSequence: 1, queue: { pendingMs: 100, pending: true } },
  });
});
it('keeps exactly the latest loss receipt and cumulative count through repeated recovery', () => {
  const { gpu, state, schedule } = fixture();
  for (let i = 1; i <= 40; i++) {
    gpu.frame(schedule, false, {}, () => true);
    state.now += 100;
    state.lost = true;
    gpu.contextLost();
    gpu.contextLost(); // duplicate notification is not another loss
    state.lost = false;
    gpu.contextRestored();
  }
  const d = gpu.diagnostics();
  expect(d).toMatchObject({
    losses: 40,
    completed: 0,
    abandoned: 40,
    lastLoss: { number: 40, pendingSequence: 40, submitted: 40 },
  });
  expect(JSON.stringify(d).length).toBeLessThan(2000);
});
it('reports draw CPU phase/duration and preserves a thrown draw as a failed phase', () => {
  const { gpu, state, schedule } = fixture();
  expect(() =>
    gpu.frame(schedule, false, {}, () => {
      expect(gpu.diagnostics()).toMatchObject({ phase: 'drawing', drawStartedAtMs: 0 });
      state.now = 42;
      throw new Error('draw failed');
    }),
  ).toThrow('draw failed');
  expect(gpu.diagnostics()).toMatchObject({
    phase: 'failed',
    lastDrawCpuMs: 42,
    drawStartedAtMs: null,
    submitted: 0,
  });
});

it('retains independent submission age when GL loss is polled before the loss observable fires', () => {
  const { gpu, state, schedule } = fixture();
  gpu.frame(schedule, false, {}, () => {
    state.now = 7;
    return true;
  });
  state.now = 107;
  state.lost = true;
  // The existing gate correctly drops its invalid sync before the engine's
  // later context-loss notification; do not reconstruct a fake gate fence.
  expect(gpu.ready()).toBe(false);
  expect(gpu.diagnostics().queue.pending).toBe(false);
  gpu.contextLost();
  expect(gpu.diagnostics().lastLoss).toMatchObject({
    pendingSequence: 1,
    pendingSubmittedAtMs: 7,
    pendingAgeMs: 100,
    submitted: 1,
    completed: 0,
    queue: { pending: false, pendingMs: 0 },
  });
  state.lost = false;
  gpu.contextRestored();
  expect(gpu.diagnostics()).toMatchObject({
    completed: 0,
    abandoned: 1,
    lastLoss: { pendingSubmittedAtMs: 7, pendingAgeMs: 100 },
  });
});
