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
    pacing.suspend();
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

describe('adaptive recovery for active menu callbacks', () => {
  it('learns the longest occupied callback gap, then returns a later fast frame to the base cadence', () => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    expect(pacing.poll(source)).toBe('ready');
    submit();
    clock.now = 16;
    expect(pacing.poll(source)).toBe('busy');
    clock.now = 2016;
    expect(pacing.poll(source)).toBe('busy');
    clock.now = 2032;
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('completed');
    clock.now = 2048;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 3032;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 4031;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 4032;
    expect(pacing.poll(source)).toBe('ready');
    expect(state.allocated).toBe(1);
    submit();
    clock.now = 4048;
    expect(pacing.poll(source)).toBe('completed');
    clock.now = 4064;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 4115;
    expect(pacing.poll(source)).toBe('ready');
    expect(state.allocated).toBe(2);
    expect(state.finishes).toBe(0);
  });

  it('includes the admission query and synchronous draw before submittedFrame returns', () => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    const canSubmitFrame = source.canSubmitFrame;
    source.canSubmitFrame = () => {
      clock.now += 300;
      return canSubmitFrame();
    };
    expect(pacing.poll(source)).toBe('ready');
    clock.now += 700; // The complete draw is synchronous work in this same callback.
    submit();
    source.canSubmitFrame = canSubmitFrame;
    clock.now = 1016;
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('completed');
    clock.now = 1032;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 1800;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 2031;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 2032;
    expect(pacing.poll(source)).toBe('ready');
    expect(state.allocated).toBe(1);
  });

  it('includes a blocking final completion query even without another pending callback', () => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    expect(pacing.poll(source)).toBe('ready');
    submit();
    clock.now = 16;
    expect(pacing.poll(source)).toBe('busy');
    const canSubmitFrame = source.canSubmitFrame;
    source.canSubmitFrame = () => {
      clock.now += 500;
      return canSubmitFrame();
    };
    clock.now = 32;
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('completed');
    expect(clock.now).toBe(532);
    source.canSubmitFrame = canSubmitFrame;
    clock.now = 548;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 1031;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 1032;
    expect(pacing.poll(source)).toBe('ready');
    expect(state.allocated).toBe(1);
    expect(state.finishes).toBe(0);
  });

  it('prioritizes one explicit redraw after the base interval without admitting automatic orbit', () => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    expect(pacing.poll(source)).toBe('ready');
    submit();
    clock.now = 1000;
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source, true)).toBe('completed');
    clock.now = 1016;
    expect(pacing.poll(source, true)).toBe('quiet');
    clock.now = 1066;
    expect(pacing.poll(source, true)).toBe('quiet');
    clock.now = 1067;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 1083;
    expect(pacing.poll(source, true)).toBe('ready');
    expect(state.allocated).toBe(1);
    submit();
    clock.now = 1099;
    expect(pacing.poll(source)).toBe('completed');
    clock.now = 1115;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 1166;
    expect(pacing.poll(source)).toBe('ready');
    expect(state.allocated).toBe(2);
  });

  it('does not let explicit redraw consume the mandatory following paint callback', () => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    submit();
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source, true)).toBe('completed');
    clock.now = 5000;
    expect(pacing.poll(source, true)).toBe('quiet');
    clock.now += 16;
    expect(pacing.poll(source, true)).toBe('ready');
    expect(state.allocated).toBe(1);
  });

  it('breaks suspended callback gaps while retaining an earlier active gap and owned fence', () => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    expect(pacing.poll(source)).toBe('ready');
    submit();
    clock.now = 16;
    expect(pacing.poll(source)).toBe('busy');
    clock.now = 2016;
    expect(pacing.poll(source)).toBe('busy');
    const polls = state.polls;
    pacing.suspend();
    clock.now = 62016;
    pacing.suspend();
    expect(state.polls).toBe(polls);
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('completed');
    clock.now = 62032;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 64015;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 64016;
    expect(pacing.poll(source)).toBe('ready');
    expect(state.allocated).toBe(1);
    expect(state.deleted).toHaveLength(1);
  });

  it.each([false, true])(
    'does not spend visible control recovery during suspension (explicit redraw: %s)',
    (explicit) => {
      const { clock, pacing, source, gl, state, submit } = fixture();
      expect(pacing.poll(source)).toBe('ready');
      submit();
      clock.now = 1000;
      state.wait = gl.CONDITION_SATISFIED;
      expect(pacing.poll(source)).toBe('completed');
      clock.now = 1016;
      expect(pacing.poll(source)).toBe('quiet');
      pacing.suspend();
      clock.now = 61016;
      expect(pacing.poll(source, explicit)).toBe('quiet');
      const remaining = (explicit ? MenuFramePacing.quietMilliseconds : 1000) - 16;
      clock.now = 61016 + remaining - 1;
      expect(pacing.poll(source, explicit)).toBe('quiet');
      clock.now = 61016 + remaining + 1;
      expect(pacing.poll(source, explicit)).toBe('ready');
      expect(state.allocated).toBe(1);
    },
  );

  it('does not charge unrelated time before the callback that actually admits a draw', () => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    expect(pacing.poll(source)).toBe('ready');
    // The caller may coalesce an invalidation instead of drawing this callback.
    clock.now = 50000;
    expect(pacing.poll(source)).toBe('ready');
    submit();
    clock.now = 50016;
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('completed');
    clock.now = 50032;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 50083;
    expect(pacing.poll(source)).toBe('ready');
  });

  it('discards an old admission timestamp when presentation is suspended before submission', () => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    expect(pacing.poll(source)).toBe('ready');
    pacing.suspend();
    clock.now = 50000;
    submit();
    clock.now = 50016;
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('completed');
    clock.now = 50032;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 50083;
    expect(pacing.poll(source)).toBe('ready');
  });

  it('does not transfer learned recovery from an abandoned renderer to its replacement', () => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    expect(pacing.poll(source)).toBe('ready');
    submit();
    clock.now = 2000;
    expect(pacing.poll(source)).toBe('busy');
    const replacement = renderer(clock);
    clock.now = 60000;
    expect(pacing.poll(replacement.source)).toBe('ready');
    state.wait = gl.CONDITION_SATISFIED;
    const oldPolls = state.polls;
    replacement.gpu.submittedFrame();
    pacing.submittedFrame(replacement.source);
    clock.now = 60016;
    replacement.state.wait = replacement.gl.CONDITION_SATISFIED;
    expect(pacing.poll(replacement.source)).toBe('completed');
    clock.now = 60032;
    expect(pacing.poll(replacement.source)).toBe('quiet');
    clock.now = 60083;
    expect(pacing.poll(replacement.source)).toBe('ready');
    expect(state.polls).toBe(oldPolls);
    expect(replacement.state.allocated).toBe(1);
  });

  it.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['a backwards sample', -1],
  ] as const)('preserves genuine pending work across %s', (_label, invalid) => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    expect(pacing.poll(source)).toBe('ready');
    submit();
    clock.now = 100;
    expect(pacing.poll(source)).toBe('busy');
    clock.now = invalid;
    expect(pacing.poll(source)).toBe('busy');
    expect(state.deleted).toHaveLength(0);
    clock.now = 1000;
    expect(pacing.poll(source)).toBe('busy');
    clock.now = 1016;
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('completed');
    clock.now = 1032;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 1083;
    expect(pacing.poll(source)).toBe('ready');
    expect(state.allocated).toBe(1);
    expect(state.deleted).toHaveLength(1);
  });

  it('resumes finite remaining recovery after the clock becomes invalid and starts again', () => {
    const { clock, pacing, source, gl, state, submit } = fixture();
    expect(pacing.poll(source)).toBe('ready');
    submit();
    clock.now = 1000;
    state.wait = gl.CONDITION_SATISFIED;
    expect(pacing.poll(source)).toBe('completed');
    clock.now = 1016;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = Number.NaN;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 0;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 983;
    expect(pacing.poll(source)).toBe('quiet');
    clock.now = 984;
    expect(pacing.poll(source)).toBe('ready');
    expect(state.allocated).toBe(1);
  });
});
