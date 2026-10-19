import { describe, expect, it } from 'vitest';
import { GpuFrameGate } from '../src/rendering/gpu-frame-gate.ts';
import { MenuFramePacing } from '../src/rendering/menu-frame-pacing.ts';
import { shouldDrawMenu } from '../src/rendering/menu-preview.ts';

function renderer(clock: { now: number }) {
  const state = {
    wait: 2,
    lost: false,
    allocated: 0,
    polls: 0,
    deleted: [] as WebGLSync[],
    finishes: 0,
  };
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    WAIT_FAILED: 5,
    isContextLost: () => state.lost,
    fenceSync: () => ({ id: ++state.allocated }) as unknown as WebGLSync,
    clientWaitSync: (_fence: WebGLSync, flags: number, timeout: number) => {
      expect([flags, timeout]).toEqual([0, 0]);
      state.polls++;
      return state.wait;
    },
    deleteSync: (fence: WebGLSync) => state.deleted.push(fence),
    flush: () => {},
    finish: () => state.finishes++,
  } as unknown as WebGL2RenderingContext;
  const gpu = new GpuFrameGate(gl, () => clock.now);
  const source = { canSubmitFrame: () => gpu.ready() };
  return { gl, gpu, source, state };
}

function fixture() {
  const clock = { now: 0 };
  const pacing = new MenuFramePacing(() => clock.now);
  const view = renderer(clock);
  const submit = () => {
    view.gpu.submittedFrame();
    pacing.submittedFrame(view.source);
  };
  return { clock, pacing, ...view, submit };
}

describe('menu handoff after actual GPU completion', () => {
  it('allows the initial draw but never acknowledges a frame before an owned submission completes', () => {
    const { pacing, source, gpu, gl, state, submit } = fixture();
    expect(pacing.poll(source)).toBe('ready');
    expect(gpu.diagnostics().submitted).toBe(0);
    submit();
    for (let callback = 0; callback < 12; callback++) expect(pacing.poll(source)).toBe('busy');
    expect(gpu.diagnostics().completed).toBe(0);
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('completed');
    expect(gpu.diagnostics()).toMatchObject({ submitted: 1, completed: 1, pending: false });
    expect(pacing.poll(source)).toBe('quiet');
    expect(state.deleted).toHaveLength(1);
  });

  it('starts its quiet interval after a 30-second GPU workload instead of flooding the completion callback', () => {
    const { clock, pacing, source, gpu, gl, state, submit } = fixture();
    submit();
    let inputCallbacks = 0;
    for (clock.now = 16; clock.now < 30000; clock.now += 16) {
      inputCallbacks++;
      expect(pacing.poll(source)).toBe('busy');
    }
    expect(inputCallbacks).toBeGreaterThan(1800);
    expect(state.allocated).toBe(1);
    expect(state.finishes).toBe(0);
    state.wait = gl.ALREADY_SIGNALED;
    clock.now = 30000;
    expect(pacing.poll(source)).toBe('completed');
    for (const delta of [16, 32, 48, 64]) {
      clock.now = 30000 + delta;
      expect(pacing.poll(source)).toBe('quiet');
      expect(gpu.diagnostics().submitted).toBe(1);
    }
    clock.now = 30000 + MenuFramePacing.quietMilliseconds;
    expect(pacing.poll(source)).toBe('ready');
    submit();
    expect(gpu.diagnostics()).toMatchObject({ submitted: 2, completed: 1, pending: true });
  });

  it('leaves a following paint callback free even if UI work used the entire quiet interval', () => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    submit();
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('completed');
    clock.now += 5000;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now += 16;
    expect(pacing.poll(source)).toBe('ready');
    expect(state.allocated).toBe(1);
  });

  it('keeps the covered settings frame held, including when settings preparation observes its completion', () => {
    const { clock, pacing, source, gpu, gl, state, submit } = fixture();
    submit();
    const menu = {
      covered: true,
      preview: false,
      invalidated: true,
      resizePending: false,
      settingsBusy: false,
    };
    state.wait = gl.CONDITION_SATISFIED;
    // A covered editor owns its existing frame before the GPU/menu scheduler.
    for (let callback = 0; callback < 120; callback++) {
      clock.now += 16;
      expect(shouldDrawMenu(menu)).toBe(false);
    }
    expect(state.polls).toBe(0);
    expect(gpu.diagnostics().submitted).toBe(1);
    menu.settingsBusy = true;
    expect(shouldDrawMenu(menu)).toBe(false);
    expect(gpu.ready()).toBe(true); // prepareQuality drains the same genuine fence.
    menu.settingsBusy = false;
    expect(shouldDrawMenu(menu)).toBe(false);
    menu.covered = false;
    expect(shouldDrawMenu(menu)).toBe(true);
    expect(pacing.poll(source)).toBe('completed');
    expect(pacing.poll(source)).toBe('quiet');
    clock.now += MenuFramePacing.quietMilliseconds;
    expect(pacing.poll(source)).toBe('ready');
    expect(state.allocated).toBe(1);
    expect(state.deleted).toHaveLength(1);
  });

  it('cannot use an abandoned renderer completion to reveal the replacement menu', () => {
    const { clock, pacing, gpu, gl, state, submit } = fixture();
    submit();
    const replacement = renderer(clock);
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(replacement.source)).toBe('ready'); // No completion receipt.
    expect(state.polls).toBe(0); // The stale owner is not queried.
    expect(gpu.ready()).toBe(true); // Its late completion is independent.
    replacement.gpu.submittedFrame();
    pacing.submittedFrame(replacement.source);
    expect(pacing.poll(replacement.source)).toBe('busy');
    replacement.state.wait = replacement.gl.CONDITION_SATISFIED;
    expect(pacing.poll(replacement.source)).toBe('completed');
    expect(replacement.gpu.diagnostics().completed).toBe(1);
    expect(pacing.poll(replacement.source)).toBe('quiet');
  });

  it('reset abandons a pending startup handoff and requires a new submission', () => {
    const { pacing, source, gl, state, submit } = fixture();
    submit();
    pacing.reset();
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('ready');
    submit();
    state.wait = gl.TIMEOUT_EXPIRED;
    expect(pacing.poll(source)).toBe('busy');
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('completed');
  });

  it('never acknowledges a lost context or failed completion query', () => {
    for (const failure of ['context', 'wait'] as const) {
      const { pacing, source, gl, state, submit } = fixture();
      submit();
      if (failure === 'context') {
        state.lost = true;
        expect(pacing.poll(source)).toBe('busy');
      } else {
        state.wait = gl.WAIT_FAILED;
        expect(() => pacing.poll(source)).toThrow('Unable to check GPU frame completion');
      }
      expect(pacing.poll(source)).toBe('busy');
      expect(state.allocated).toBe(1);
      expect(state.finishes).toBe(0);
    }
  });

  it('disposal cannot acknowledge or resume an old frame, including after reset', () => {
    for (const complete of [false, true]) {
      const { pacing, source, gpu, gl, state, submit } = fixture();
      submit();
      if (complete) {
        state.wait = gl.CONDITION_SATISFIED;
        expect(pacing.poll(source)).toBe('completed');
      }
      pacing.dispose();
      pacing.dispose();
      gpu.dispose();
      const polls = state.polls;
      pacing.reset();
      expect(pacing.poll(source)).toBe('busy');
      expect(() => pacing.submittedFrame(source)).toThrow('Menu frame pacing is disposed');
      expect(state.polls).toBe(polls);
      expect(state.deleted).toHaveLength(1);
      expect(state.finishes).toBe(0);
    }
  });
});
