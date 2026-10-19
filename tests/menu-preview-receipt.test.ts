import { describe, expect, it } from 'vitest';
import { GpuFrameGate } from '../src/rendering/gpu-frame-gate.ts';
import { MenuFramePacing } from '../src/rendering/menu-frame-pacing.ts';
import { MenuPreviewReceipt } from '../src/rendering/menu-preview-receipt.ts';
import { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';

const view = { circuit: 'aurel', width: 1280, height: 800 };

function frame(machine = 'gpr1', time = 0, cars = 1) {
  const value = new Float32Array(HEADER + cars * CAR_STRIDE);
  value[H.CARS] = cars;
  value[H.TIME] = time;
  for (let id = 0; id < cars; id++) {
    value[carBase(id) + RACE_BASE + R.VEHICLE] = vehicleIndex(machine);
    value[carBase(id) + F.X] = 3.25 + id;
  }
  return value;
}

function fixture() {
  const receipt = new MenuPreviewReceipt();
  const owner = {};
  const submit = (value = frame(), revision = receipt.revision) =>
    receipt.submittedFrame(owner, revision, value, view);
  return { receipt, owner, submit };
}

describe('menu preview requests and completed display receipts', () => {
  it('does not identify a requested or merely ready preview as completed', () => {
    const { receipt, owner, submit } = fixture();
    receipt.request('selected machine');
    expect(receipt.report()).toMatchObject({
      completed: null,
      submitted: null,
      current: false,
      needsSubmission: true,
    });
    expect(receipt.observe(owner, 'completed', null)).toBe(false);
    const ticket = submit();
    for (const readiness of ['busy', 'ready', 'quiet'] as const) {
      expect(receipt.observe(owner, readiness, ticket)).toBe(false);
      expect(receipt.report()).toMatchObject({
        completed: null,
        pending: true,
        current: false,
        needsSubmission: false,
      });
    }
    expect(receipt.observe(owner, 'completed', ticket)).toBe(true);
    expect(receipt.report()).toMatchObject({
      completed: { machine: 'gpr1', time: 0, cars: 1 },
      current: true,
      pending: false,
      needsSubmission: false,
    });
  });

  it('captures the submitted frame and view without aliasing later source or diagnostic mutations', () => {
    const { receipt, owner } = fixture();
    const source = frame('gpr1', 2);
    const submittedView = { ...view };
    const before = source.slice();
    const ticket = receipt.submittedFrame(owner, receipt.revision, source, submittedView);
    source.fill(0);
    submittedView.circuit = 'poggio-alto';
    submittedView.width = 390;
    receipt.observe(owner, 'completed', ticket);
    expect(receipt.report().completed).toMatchObject({
      machine: 'gpr1',
      time: 2,
      cars: 1,
      circuit: 'aurel',
      width: 1280,
      height: 800,
    });
    expect(receipt.copyCompletedFrame()).toEqual(before);
    receipt.copyCompletedFrame()!.fill(99);
    const diagnostics = receipt.report();
    diagnostics.requested.reason = 'changed diagnostic';
    expect(receipt.copyCompletedFrame()).toEqual(before);
    expect(receipt.report().requested.reason).toBe('initial');
  });

  it('completes submitted A honestly when B was requested while A was pending', () => {
    const { receipt, owner, submit } = fixture();
    const revisionA = receipt.request('Formula selection');
    const ticketA = submit(frame('apx01'), revisionA);
    const revisionB = receipt.request('GP-R1 selection');
    expect(receipt.needsSubmission).toBe(true);
    expect(receipt.observe(owner, 'completed', ticketA)).toBe(true);
    expect(receipt.report()).toMatchObject({
      requested: { revision: revisionB },
      completed: { machine: 'apx01', revision: revisionA },
      current: false,
      needsSubmission: true,
    });
    const ticketB = submit(frame('gpr1'), revisionB);
    expect(receipt.observe(owner, 'completed', ticketA)).toBe(false);
    expect(receipt.report().completed?.machine).toBe('apx01');
    expect(receipt.observe(owner, 'completed', ticketB)).toBe(true);
    expect(receipt.report()).toMatchObject({
      completed: { machine: 'gpr1', revision: revisionB },
      current: true,
      needsSubmission: false,
    });
  });

  it('retains the revision captured with an older submitted frame rather than relabeling it', () => {
    const { receipt, owner, submit } = fixture();
    const capturedRevision = receipt.request('machine');
    const currentRevision = receipt.request('viewport');
    const ticket = submit(frame('gpr2'), capturedRevision);
    expect(receipt.report()).toMatchObject({
      submitted: { revision: capturedRevision },
      requested: { revision: currentRevision },
      needsSubmission: true,
    });
    receipt.observe(owner, 'completed', ticket);
    expect(receipt.report().current).toBe(false);
  });

  it('retains same-machine circuit, resize and Academy requests until their latest submission', () => {
    const { receipt, owner, submit } = fixture();
    receipt.observe(owner, 'completed', submit());
    const previousRevision = receipt.revision;
    for (const reason of ['circuit selection', 'resize', 'Academy guide']) receipt.request(reason);
    expect(receipt.revision).toBe(previousRevision + 3);
    expect(receipt.report()).toMatchObject({
      completed: { machine: 'gpr1', circuit: 'aurel' },
      current: false,
      needsSubmission: true,
    });
    // The helper records the actual loaded venue; it never rebuilds a track.
    const latest = submit();
    receipt.observe(owner, 'completed', latest);
    expect(receipt.report()).toMatchObject({
      completed: { machine: 'gpr1', circuit: 'aurel', revision: previousRevision + 3 },
      current: true,
      needsSubmission: false,
    });
  });

  it('does not let a replacement renderer or a late old-owner result acknowledge each other', () => {
    const { receipt, owner, submit } = fixture();
    const oldTicket = submit(frame('apx01'));
    const replacement = {};
    expect(receipt.observe(replacement, 'completed', oldTicket)).toBe(false);
    const replacementTicket = receipt.submittedFrame(
      replacement,
      receipt.revision,
      frame('gpr2'),
      view,
    );
    expect(receipt.report().completed).toBeNull();
    expect(receipt.observe(owner, 'completed', oldTicket)).toBe(false);
    expect(receipt.report().pending).toBe(true);
    expect(receipt.observe(replacement, 'completed', replacementTicket)).toBe(true);
    expect(receipt.report().completed?.machine).toBe('gpr2');
  });

  it('invalidates old tickets across reset even when the renderer object is reused', () => {
    const { receipt, owner, submit } = fixture();
    const oldTicket = submit(frame('apx01'));
    const oldGeneration = receipt.report().generation;
    receipt.reset();
    expect(receipt.observe(owner, 'completed', oldTicket)).toBe(false);
    const newTicket = submit();
    expect(newTicket).toBeGreaterThan(oldTicket);
    expect(receipt.report().generation).toBeGreaterThan(oldGeneration);
    expect(receipt.observe(owner, 'completed', oldTicket)).toBe(false);
    expect(receipt.report().completed).toBeNull();
    expect(receipt.observe(owner, 'completed', newTicket)).toBe(true);
    expect(receipt.report().completed?.machine).toBe('gpr1');
  });

  it('cannot overwrite an outstanding receipt or complete the same ticket twice', () => {
    const { receipt, owner, submit } = fixture();
    const ticket = submit();
    expect(() => submit(frame('gpr2'))).toThrow('already pending');
    expect(receipt.observe(owner, 'completed', ticket)).toBe(true);
    expect(receipt.observe(owner, 'completed', ticket)).toBe(false);
    expect(receipt.report().completed?.machine).toBe('gpr1');
  });

  it('reuses its two actual frame buffers through automatic orbit frames', () => {
    const { receipt, owner, submit } = fixture();
    const source = frame();
    receipt.observe(owner, 'completed', submit(source));
    const buffers = Object.values(receipt).filter((value) => value instanceof Float32Array);
    expect(buffers).toHaveLength(2);
    const revision = receipt.revision;
    for (let orbit = 0; orbit < 100; orbit++) {
      const ticket = submit(source);
      expect(receipt.report().current).toBe(true);
      receipt.observe(owner, 'completed', ticket);
    }
    const after = Object.values(receipt).filter((value) => value instanceof Float32Array);
    expect(after).toHaveLength(2);
    expect(after.every((buffer) => buffers.some((previous) => previous === buffer))).toBe(true);
    expect(receipt.revision).toBe(revision);
    expect(receipt.copyCompletedFrame()).toEqual(source);
  });

  it('preserves completed values when a larger submitted frame grows the reusable capacity', () => {
    const { receipt, owner, submit } = fixture();
    const previous = frame('gpr1', 2);
    receipt.observe(owner, 'completed', submit(previous));
    receipt.request('replacement display');
    const larger = frame('gpr2', 4, 2);
    const ticket = submit(larger);
    expect(receipt.copyCompletedFrame()).toEqual(previous);
    expect(receipt.report().completed?.machine).toBe('gpr1');
    receipt.observe(owner, 'completed', ticket);
    expect(receipt.copyCompletedFrame()).toEqual(larger);
    expect(receipt.report().completed).toMatchObject({ machine: 'gpr2', time: 4, cars: 2 });
  });

  it('never promotes a disposed receipt or reactivates it by resetting', () => {
    const { receipt, owner, submit } = fixture();
    const ticket = submit();
    receipt.dispose();
    receipt.dispose();
    receipt.reset();
    expect(receipt.observe(owner, 'completed', ticket)).toBe(false);
    expect(receipt.report()).toMatchObject({
      completed: null,
      submitted: null,
      current: false,
      pending: false,
      needsSubmission: false,
    });
    expect(() => receipt.request()).toThrow('disposed');
    expect(() => submit()).toThrow('disposed');
  });

  it('promotes only after the real menu pacing observes the real gate completion', () => {
    const clock = { now: 0 };
    const state = { wait: 2, polls: 0, finishes: 0 };
    const gl = {
      SYNC_GPU_COMMANDS_COMPLETE: 1,
      TIMEOUT_EXPIRED: 2,
      ALREADY_SIGNALED: 3,
      CONDITION_SATISFIED: 4,
      isContextLost: () => false,
      fenceSync: () => ({}) as WebGLSync,
      clientWaitSync: (_fence: WebGLSync, flags: number, timeout: number) => {
        expect([flags, timeout]).toEqual([0, 0]);
        state.polls++;
        return state.wait;
      },
      deleteSync: () => {},
      flush: () => {},
      finish: () => state.finishes++,
    } as unknown as WebGL2RenderingContext;
    const gpu = new GpuFrameGate(gl, () => clock.now);
    const owner = { canSubmitFrame: () => gpu.ready() };
    const pacing = new MenuFramePacing(() => clock.now);
    const receipt = new MenuPreviewReceipt();
    expect(receipt.observe(owner, pacing.poll(owner), null)).toBe(false);
    gpu.submittedFrame();
    pacing.submittedFrame(owner);
    const ticket = receipt.submittedFrame(owner, receipt.revision, frame(), view);
    for (let callback = 0; callback < 12; callback++) {
      clock.now += 16;
      expect(receipt.observe(owner, pacing.poll(owner), ticket)).toBe(false);
      expect(receipt.report().completed).toBeNull();
    }
    state.wait = gl.CONDITION_SATISFIED;
    clock.now += 16;
    expect(receipt.observe(owner, pacing.poll(owner), ticket)).toBe(true);
    expect(gpu.diagnostics()).toMatchObject({ submitted: 1, completed: 1, pending: false });
    expect(receipt.report()).toMatchObject({ current: true, completed: { machine: 'gpr1' } });
    expect(pacing.poll(owner)).toBe('quiet');
    expect(state.polls).toBe(13);
    expect(state.finishes).toBe(0);
    pacing.dispose();
    gpu.dispose();
  });
});
