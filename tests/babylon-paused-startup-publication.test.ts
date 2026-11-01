import { BabylonPresentationGpu } from '../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import { startupVisualSubmissionSequence } from '../src/engine/babylon/paused-startup-publication.ts';
import { describe, expect, it } from 'vitest';
import {
  PausedStartupPublication,
  type StartupSubmissionState,
} from '../src/engine/babylon/paused-startup-publication.ts';
import type { PresentationReceipt } from '../src/engine/babylon/presentation-gpu.ts';
function harness() {
  let listener: (receipt: PresentationReceipt) => void = () => {};
  const scene = {},
    component = {};
  const state: StartupSubmissionState = {
    component,
    paused: true,
    tick: 43,
    frame: new Float32Array([43, 1, 2]),
    visual: 'camera/material/mesh snapshot',
  };
  let failure: unknown,
    failed = false;
  const proof = new PausedStartupPublication(
    {
      subscribe(callback) {
        listener = callback;
        return () => {
          listener = () => {};
        };
      },
    },
    scene,
    () => {
      if (failed) throw failure;
      return state;
    },
  );
  const graphics = {
    phase: 'idle',
    settled: true,
    submitted: 6,
    completed: 6,
    lastCompletedSequence: 6,
    lost: false,
    disposed: false,
    queue: { failure: null, pending: false },
    preparation: { active: false, failure: null },
  } as ReturnType<BabylonPresentationGpu['diagnostics']>;
  const complete = (ready = true, owner = scene) =>
    listener({ kind: 'completed', owner, ready, sequence: 6 });
  proof.drawn();
  return {
    proof,
    state,
    graphics,
    complete,
    emit: (r: PresentationReceipt) => listener(r),
    fail: (value: unknown) => {
      failure = value;
      failed = true;
    },
  };
}
describe('startup-only actual completed paused image proof', () => {
  it('requires an actual completion, not a ready draw or idle counter alone', () => {
    const h = harness();
    expect(h.proof.canPublish(h.graphics, true)).toBe(false);
    h.complete();
    expect(h.proof.canPublish(h.graphics, true)).toBe(true);
  });
  it.each([
    'old scene',
    'nonready',
    'pending GPU',
    'newer sequence',
    'snapshot',
    'tick',
    'component',
    'camera/material',
    'active',
    'real demand/restart/resize',
    'lost',
    'disposed',
    'compiler',
    'failure',
    'missing visual',
    'failed phase',
    'empty queue failure',
    'empty compiler failure',
  ])('%s cannot publish', (kind) => {
    const h = harness();
    h.complete(kind !== 'nonready', kind === 'old scene' ? {} : undefined);
    let eligible = true;
    if (kind === 'pending GPU') {
      h.graphics.settled = false;
      h.graphics.queue.pending = true;
    }
    if (kind === 'newer sequence') h.graphics.submitted = 7;
    if (kind === 'snapshot') h.state.frame[1]++;
    if (kind === 'tick') h.state.tick++;
    if (kind === 'component') h.state.component = {};
    if (kind === 'camera/material') h.state.visual += ' changed';
    if (kind === 'active') h.state.paused = false;
    if (kind === 'real demand/restart/resize') eligible = false;
    if (kind === 'lost') h.emit({ kind: 'lost' });
    if (kind === 'disposed') h.proof.dispose();
    if (kind === 'compiler') h.graphics.preparation.active = true;
    if (kind === 'failure') h.graphics.queue.failure = 'driver failure';
    if (kind === 'missing visual') h.state.visual = null;
    if (kind === 'failed phase') h.graphics.phase = 'failed';
    if (kind === 'empty queue failure') h.graphics.queue.failure = '';
    if (kind === 'empty compiler failure') h.graphics.preparation.failure = '';
    expect(h.proof.canPublish(h.graphics, eligible)).toBe(false);
  });
  it('does not reuse a receipt after a later nonready or other-scene completion', () => {
    const h = harness();
    h.complete();
    h.complete(false);
    expect(h.proof.canPublish(h.graphics, true)).toBe(false);
    h.proof.drawn();
    h.complete();
    h.complete(true, {});
    expect(h.proof.canPublish(h.graphics, true)).toBe(false);
  });
  it('copies all snapshot contents rather than trusting reused Float32Array identity', () => {
    const h = harness();
    h.complete();
    h.state.frame[2] = NaN;
    expect(h.proof.canPublish(h.graphics, true)).toBe(false);
  });
  it.each([undefined, null, false, 0, ''])(
    'capture failure %s conservatively redraws',
    (failure) => {
      const h = harness();
      h.complete();
      h.fail(failure);
      expect(h.proof.canPublish(h.graphics, true)).toBe(false);
      h.proof.drawn();
      h.complete();
      expect(h.proof.canPublish(h.graphics, true)).toBe(false);
    },
  );
  it('never suppresses an original graphics getter error, including falsy values', () => {
    for (const failure of [undefined, null, false, 0]) {
      const h = harness();
      h.complete();
      Object.defineProperty(h.graphics, 'settled', {
        get() {
          throw failure;
        },
      });
      let caught = false;
      try {
        h.proof.canPublish(h.graphics, true);
      } catch (error) {
        caught = true;
        expect(error).toBe(failure);
      }
      expect(caught).toBe(true);
    }
  });
});

it("attributes only this callback's new submission, even when its real fence is already signaled", () => {
  let polls = 0;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    isContextLost: () => false,
    fenceSync: () => ({}),
    deleteSync: () => {},
    flush: () => {},
    clientWaitSync: () => {
      polls++;
      return 3;
    },
  } as unknown as WebGL2RenderingContext;
  const gpu = new BabylonPresentationGpu(gl),
    schedule = new PresentationSchedule(),
    scene = {};
  let captured = false;
  expect(
    gpu.frame(schedule, true, scene, () => {
      captured = true;
      return true;
    }),
  ).toBe(true);
  const waiting = gpu.diagnostics();
  expect(polls).toBe(0); // frame() does not poll its newly issued, already-signaled fence.
  expect(waiting).toMatchObject({ phase: 'waiting', submitted: 1, completed: 0 });
  expect(startupVisualSubmissionSequence(waiting, captured, 0)).toBe(1);
  expect(startupVisualSubmissionSequence(waiting, false, 0)).toBeNull();
  expect(startupVisualSubmissionSequence(waiting, true, 1)).toBeNull();
  expect(gpu.ready()).toBe(true);
  expect(polls).toBe(1);
  expect(startupVisualSubmissionSequence(gpu.diagnostics(), true, 0)).toBeNull();
  captured = false;
  expect(
    gpu.frame(schedule, true, scene, () => {
      captured = true;
      return true;
    }),
  ).toBe(false);
  expect(captured).toBe(false);
  expect(startupVisualSubmissionSequence(gpu.diagnostics(), captured, 0)).toBeNull();
  schedule.request();
  expect(gpu.frame(schedule, true, scene, () => true)).toBe(true);
  gpu.contextLost();
  expect(startupVisualSubmissionSequence(gpu.diagnostics(), true, 1)).toBeNull();
  gpu.dispose();
  expect(startupVisualSubmissionSequence(gpu.diagnostics(), true, 1)).toBeNull();
});
