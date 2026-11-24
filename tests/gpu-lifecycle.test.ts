import { describe, expect, it } from 'vitest';
import { GpuFrameGate } from '../src/rendering/gpu-frame-gate.ts';
import { GpuTimer } from '../src/rendering/gpu-timer.ts';

function timerFixture() {
  const state = {
    lost: false,
    disjoint: false,
    available: false,
    result: 8e6 as unknown,
    loseOnRead: false,
    disjointOnRead: false,
    endThrows: false,
    deleteThrows: false,
    starts: 0,
    deleted: [] as WebGLQuery[],
  };
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    getExtension: () => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 }),
    isContextLost: () => state.lost,
    getParameter: () => state.disjoint,
    getQueryParameter: (_query: WebGLQuery, parameter: number) => {
      if (parameter === 1) return state.available;
      if (state.loseOnRead) state.lost = true;
      if (state.disjointOnRead) state.disjoint = true;
      return state.result;
    },
    createQuery: () => ({} as WebGLQuery),
    beginQuery: () => state.starts++,
    endQuery: () => {
      if (state.endThrows) throw new Error('query end threw');
    },
    deleteQuery: (query: WebGLQuery) => {
      state.deleted.push(query);
      if (state.deleteThrows) throw new Error('query deletion threw');
    },
  } as unknown as WebGL2RenderingContext;
  return { timer: new GpuTimer(gl), state };
}

function gateFixture() {
  const clock = { now: 1000 };
  const state = {
    lost: false,
    loseOnWait: false,
    waitThrows: false,
    allocateThrows: false,
    flushThrows: false,
    deleteThrows: false,
    wait: 2,
    allocated: [] as WebGLSync[],
    deleted: [] as WebGLSync[],
    waits: [] as number[][],
    flushes: 0,
  };
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    WAIT_FAILED: 5,
    isContextLost: () => state.lost,
    fenceSync: () => {
      if (state.allocateThrows) throw new Error('fence allocation threw');
      const fence = {} as WebGLSync;
      state.allocated.push(fence);
      return fence;
    },
    clientWaitSync: (_fence: WebGLSync, flags: number, timeout: number) => {
      state.waits.push([flags, timeout]);
      if (state.waitThrows) throw new Error('fence polling threw');
      if (state.loseOnWait) state.lost = true;
      return state.wait;
    },
    deleteSync: (fence: WebGLSync) => {
      state.deleted.push(fence);
      if (state.deleteThrows) throw new Error('fence deletion threw');
    },
    flush: () => {
      state.flushes++;
      if (state.flushThrows) throw new Error('flush threw');
    },
  } as unknown as WebGL2RenderingContext;
  return { gate: new GpuFrameGate(gl, () => clock.now), state, clock, gl };
}

describe('GPU query result validity', () => {
  it.each([null, undefined, false, '8000000'])('does not coerce %s into GPU elapsed time', (result) => {
    const { timer, state } = timerFixture();
    timer.begin();
    timer.end();
    state.available = true;
    state.result = result;
    timer.begin();
    timer.end();
    expect(timer.milliseconds).toBeNull();
    expect(timer.sampleSequence).toBe(0);
    timer.dispose();
    expect(state.deleted).toHaveLength(2);
  });

  it('accepts an actual numeric zero result', () => {
    const { timer, state } = timerFixture();
    timer.begin();
    timer.end();
    state.available = true;
    state.result = 0;
    timer.begin();
    expect(timer.milliseconds).toBe(0);
    expect(timer.sampleSequence).toBe(1);
    timer.dispose();
  });

  it.each(['loseOnRead', 'disjointOnRead'] as const)(
    'invalidates a query if %s occurs while fetching its result',
    (fault) => {
      const { timer, state } = timerFixture();
      timer.begin();
      timer.end();
      state.available = true;
      state[fault] = true;
      timer.begin();
      expect(timer.milliseconds).toBeNull();
      expect(timer.sampleSequence).toBe(0);
      expect(state.starts).toBe(1);
      expect(state.deleted).toHaveLength(fault === 'loseOnRead' ? 0 : 1);
      timer.dispose();
    },
  );

  it.each(['endThrows', 'deleteThrows'] as const)(
    'releases every query once and remains disposed when %s interrupts cleanup',
    (fault) => {
      const { timer, state } = timerFixture();
      timer.begin();
      timer.end();
      timer.begin();
      state[fault] = true;
      expect(() => timer.dispose()).toThrow();
      expect(() => timer.dispose()).not.toThrow();
      timer.begin();
      timer.end();
      expect(state.starts).toBe(2);
      expect(state.deleted).toHaveLength(2);
      expect(new Set(state.deleted).size).toBe(2);
      expect(timer.milliseconds).toBeNull();
    },
  );
});

describe('GPU frame ownership across lifecycle faults', () => {
  it('keeps abandoned submissions uncompleted when a lost context is restored', () => {
    const { gate, state } = gateFixture();
    gate.submittedFrame();
    state.lost = true;
    expect(gate.ready()).toBe(false);
    state.lost = false;
    expect(gate.ready()).toBe(false);
    expect(() => gate.submittedFrame()).toThrow(/context.*lost/i);
    expect(gate.diagnostics()).toMatchObject({ submitted: 1, completed: 0, pending: false });
    expect(state.allocated).toHaveLength(1);
    expect(state.deleted).toHaveLength(0);
  });

  it('does not acknowledge a fence when its context is lost during the poll', () => {
    const { gate, state, gl } = gateFixture();
    gate.submittedFrame();
    state.wait = gl.CONDITION_SATISFIED;
    state.loseOnWait = true;
    expect(gate.ready()).toBe(false);
    expect(gate.diagnostics().completed).toBe(0);
    expect(state.deleted).toHaveLength(0);
  });

  it.each(['allocateThrows', 'flushThrows'] as const)(
    'fails closed if %s interrupts a superseding submission',
    (fault) => {
      const { gate, state } = gateFixture();
      gate.submittedFrame();
      state[fault] = true;
      expect(() => gate.submittedFrame()).toThrow();
      expect(gate.ready()).toBe(false);
      expect(gate.diagnostics().completed).toBe(0);
      expect(gate.diagnostics().failure).not.toBeNull();
      expect(new Set(state.deleted).size).toBe(state.allocated.length);
    },
  );

  it('fails closed on a thrown fence poll without attempting a blocking wait', () => {
    const { gate, state } = gateFixture();
    gate.submittedFrame();
    state.waitThrows = true;
    expect(() => gate.ready()).toThrow();
    state.waitThrows = false;
    expect(gate.ready()).toBe(false);
    expect(gate.diagnostics().completed).toBe(0);
    expect(state.waits).toEqual([[0, 0]]);
    expect(state.deleted).toHaveLength(1);
  });

  it('detaches a disposed fence even when its deletion throws', () => {
    const { gate, state } = gateFixture();
    gate.submittedFrame();
    state.deleteThrows = true;
    expect(() => gate.dispose()).toThrow();
    expect(() => gate.dispose()).not.toThrow();
    expect(gate.ready()).toBe(false);
    expect(() => gate.submittedFrame()).toThrow(/disposed/);
    expect(gate.diagnostics().pending).toBe(false);
    expect(state.deleted).toHaveLength(1);
  });
});

describe('GPU completion timing across clock discontinuities', () => {
  it.each([500, NaN, Infinity, -Infinity])(
    'retains unfinished work with finite diagnostics after clock value %s',
    (invalid) => {
      const { gate, state, clock, gl } = gateFixture();
      gate.submittedFrame();
      clock.now = 1016;
      expect(gate.ready()).toBe(false);
      clock.now = invalid;
      expect(gate.ready()).toBe(false);
      const diagnostics = gate.diagnostics();
      expect(diagnostics.pending).toBe(true);
      expect(Number.isFinite(diagnostics.pendingMs)).toBe(true);
      expect(diagnostics.activeWaitMs).toBe(0);
      expect(diagnostics.completed).toBe(0);
      clock.now = 2000;
      expect(gate.ready()).toBe(false);
      clock.now = 2016;
      state.wait = gl.CONDITION_SATISFIED;
      expect(gate.ready()).toBe(true);
      expect(gate.completionLatencyMs).toBe(0);
      expect(gate.diagnostics().completed).toBe(1);
      expect(state.waits.every(([flags, timeout]) => flags === 0 && timeout === 0)).toBe(true);
    },
  );

  it('does not turn time in a hidden tab into a completion latency sample', () => {
    const { gate, state, clock, gl } = gateFixture();
    gate.submittedFrame();
    clock.now += 600_000;
    expect(gate.ready()).toBe(false);
    clock.now += 16;
    state.wait = gl.ALREADY_SIGNALED;
    expect(gate.ready()).toBe(true);
    expect(gate.completionLatencyMs).toBe(0);
    gate.submittedFrame();
    clock.now += 16;
    expect(gate.ready()).toBe(true);
    expect(gate.completionLatencyMs).toBe(16);
  });
});
