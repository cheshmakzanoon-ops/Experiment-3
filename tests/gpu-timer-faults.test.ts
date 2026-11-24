import { describe, expect, it } from 'vitest';
import { GpuTimer } from '../src/rendering/gpu-timer.ts';

type Site =
  | 'extension'
  | 'status'
  | 'disjoint'
  | 'available'
  | 'result'
  | 'create'
  | 'begin'
  | 'end'
  | 'delete';

function fixture(constructorFault = false) {
  const failure = new Error('optional GL timing failed');
  const calls = new Map<Site, number>();
  const faults = new Map<Site, number | 'always'>();
  if (constructorFault) faults.set('extension', 1);
  const allocated: WebGLQuery[] = [];
  const deleted: WebGLQuery[] = [];
  const begun: WebGLQuery[] = [];
  const state = {
    lost: false,
    disjoint: false,
    available: false,
    value: 8e6 as unknown,
    allocationNull: false,
    loseOnResult: false,
    disjointOnResult: false,
  };
  function enter(site: Site) {
    const count = (calls.get(site) ?? 0) + 1;
    calls.set(site, count);
    if (faults.get(site) === 'always' || faults.get(site) === count) throw failure;
  }
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    getExtension: () => {
      enter('extension');
      return { TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 };
    },
    isContextLost: () => {
      enter('status');
      return state.lost;
    },
    getParameter: () => {
      enter('disjoint');
      return state.disjoint;
    },
    getQueryParameter: (_query: WebGLQuery, parameter: number) => {
      if (parameter === 1) {
        enter('available');
        return state.available;
      }
      enter('result');
      if (state.loseOnResult) state.lost = true;
      if (state.disjointOnResult) state.disjoint = true;
      return state.value;
    },
    createQuery: () => {
      enter('create');
      if (state.allocationNull) return null;
      const query = { id: allocated.length } as WebGLQuery;
      allocated.push(query);
      return query;
    },
    beginQuery: (_target: number, query: WebGLQuery) => {
      enter('begin');
      begun.push(query);
    },
    endQuery: () => enter('end'),
    deleteQuery: (query: WebGLQuery) => {
      deleted.push(query);
      enter('delete');
    },
  } as unknown as WebGL2RenderingContext;
  return {
    timer: new GpuTimer(gl),
    state,
    calls,
    faults,
    allocated,
    deleted,
    begun,
    failure,
    failNext(site: Site) {
      faults.set(site, (calls.get(site) ?? 0) + 1);
    },
  };
}

/** Same ordering as the renderer: begin precedes its try; accounting follows
 * end inside finally. A timing exception at either boundary used to break it. */
function frame(timer: GpuTimer, draw: () => void, accounting: () => void) {
  timer.begin();
  try {
    draw();
  } finally {
    timer.end();
    accounting();
  }
}

function pending(f: ReturnType<typeof fixture>, count = 1) {
  for (let i = 0; i < count; i++) {
    f.timer.begin();
    f.timer.end();
  }
}

function expectRetired(f: ReturnType<typeof fixture>) {
  expect(f.deleted).toHaveLength(f.allocated.length);
  expect(new Set(f.deleted)).toEqual(new Set(f.allocated));
}

describe('optional whole-frame timing faults', () => {
  it('contains an extension lookup failure and keeps rendering/accounting usable', () => {
    const f = fixture(true);
    const steps: string[] = [];
    frame(
      f.timer,
      () => steps.push('draw'),
      () => steps.push('account'),
    );
    expect(() => f.timer.dispose()).not.toThrow();
    expect(steps).toEqual(['draw', 'account']);
    expect(f.timer.supported).toBe(false);
    expect(f.timer.milliseconds).toBeNull();
    expect(f.timer.sampleSequence).toBe(0);
    expect([...f.calls]).toEqual([['extension', 1]]);
  });

  it.each([
    'status',
    'disjoint',
    'available',
    'result',
    'create',
    'begin',
    'end',
    'delete',
  ] as const)('does not suppress rendering or mask its exception when %s throws', (site) => {
    const f = fixture();
    if (site === 'available' || site === 'result' || site === 'delete') {
      pending(f);
      f.state.available = true;
    }
    f.failNext(site);
    const sentinel = new Error('render failed');
    const steps: string[] = [];
    expect(() =>
      frame(
        f.timer,
        () => {
          steps.push('draw');
          throw sentinel;
        },
        () => steps.push('account'),
      ),
    ).toThrow(sentinel);
    expect(steps).toEqual(['draw', 'account']);
    expect(f.timer.milliseconds).toBeNull();
    expect(f.timer.sampleSequence).toBe(0);
    expectRetired(f);
    // The fault policy is bounded even when its cause clears on the next frame.
    const calls = [...f.calls];
    f.faults.clear();
    for (let i = 0; i < 1000; i++)
      frame(
        f.timer,
        () => {},
        () => {},
      );
    expect([...f.calls]).toEqual(calls);
    f.timer.dispose();
    expectRetired(f);
  });

  it('deletes a failed begin exactly once without ending a query that never began', () => {
    const f = fixture();
    f.failNext('begin');
    expect(() => f.timer.begin()).not.toThrow();
    f.timer.end();
    f.timer.dispose();
    f.timer.dispose();
    expect(f.allocated).toHaveLength(1);
    expect(f.begun).toHaveLength(0);
    expect(f.calls.get('end') ?? 0).toBe(0);
    expectRetired(f);
  });

  it('does not retry a failed end or retain its query behind later frames', () => {
    const f = fixture();
    f.timer.begin();
    f.faults.set('end', 'always');
    expect(() => f.timer.end()).not.toThrow();
    for (let i = 0; i < 1000; i++) {
      f.timer.begin();
      f.timer.end();
    }
    f.timer.dispose();
    expect(f.calls.get('end')).toBe(1);
    expectRetired(f);
  });

  it.each(['create', 'begin', 'delete'] as const)(
    'does not publish a fetched sample if the subsequent %s operation fails',
    (site) => {
      const f = fixture();
      pending(f);
      f.state.available = true;
      f.failNext(site);
      f.timer.begin();
      expect(f.calls.get('result')).toBe(1);
      expect(f.timer.milliseconds).toBeNull();
      expect(f.timer.sampleSequence).toBe(0);
      expectRetired(f);
    },
  );

  it('retains the last completed sample sequence but clears its value after a later fault', () => {
    const f = fixture();
    pending(f);
    f.state.available = true;
    f.timer.begin();
    f.timer.end();
    expect(f.timer.sampleSequence).toBe(1);
    expect(f.timer.milliseconds).toBe(8);
    f.failNext('available');
    f.timer.begin();
    expect(f.timer.sampleSequence).toBe(1);
    expect(f.timer.milliseconds).toBeNull();
    expectRetired(f);
  });

  it.each(['status', 'disjoint'] as const)(
    'contains a %s fault at end and preserves the surrounding render exception',
    (site) => {
      const f = fixture();
      const sentinel = new Error('draw sentinel');
      let accounted = false;
      expect(() =>
        frame(
          f.timer,
          () => {
            f.failNext(site);
            throw sentinel;
          },
          () => {
            accounted = true;
          },
        ),
      ).toThrow(sentinel);
      expect(accounted).toBe(true);
      expect(f.calls.get('end')).toBe(1);
      expectRetired(f);
    },
  );

  it.each(['status', 'disjoint'] as const)(
    'rejects a fetched result when its final %s validity check throws',
    (site) => {
      const f = fixture();
      pending(f);
      f.state.available = true;
      // begin first checks status/disjoint, then repeats them after readback.
      f.faults.set(site, (f.calls.get(site) ?? 0) + 2);
      expect(() => f.timer.begin()).not.toThrow();
      expect(f.calls.get('result')).toBe(1);
      expect(f.timer.milliseconds).toBeNull();
      expect(f.timer.sampleSequence).toBe(0);
      expectRetired(f);
    },
  );

  it('cleans all four owned queries even when live invalidation end and deletion throw', () => {
    const f = fixture();
    pending(f, 3);
    f.timer.begin();
    f.state.disjoint = true;
    f.faults.set('end', 'always');
    f.faults.set('delete', 'always');
    expect(() => f.timer.begin()).not.toThrow();
    expect(f.calls.get('end')).toBe(4);
    expectRetired(f);
    expect(() => f.timer.dispose()).not.toThrow();
    expectRetired(f);
  });

  it('continues bounded cleanup when the context-status probe itself keeps throwing', () => {
    const f = fixture();
    pending(f, 3);
    f.timer.begin();
    f.faults.set('status', 'always');
    f.faults.set('delete', 'always');
    expect(() => f.timer.end()).not.toThrow();
    expect(f.calls.get('end')).toBe(4);
    expectRetired(f);
    const calls = [...f.calls];
    f.timer.begin();
    f.timer.end();
    f.timer.dispose();
    expect([...f.calls]).toEqual(calls);
  });

  it.each(['end', 'delete', 'status'] as const)(
    'explicit disposal attempts every handle and reports its first %s failure once',
    (site) => {
      const f = fixture();
      pending(f, 3);
      f.timer.begin();
      f.faults.set(site, 'always');
      expect(() => f.timer.dispose()).toThrow(f.failure);
      expectRetired(f);
      const calls = [...f.calls];
      expect(() => f.timer.dispose()).not.toThrow();
      f.timer.begin();
      f.timer.end();
      expect([...f.calls]).toEqual(calls);
      expect(f.timer.milliseconds).toBeNull();
    },
  );
});

describe('normal timer semantics with fault containment', () => {
  it.each([null, undefined, NaN, Infinity, -Infinity, -1, false, '8000000'])(
    'rejects invalid result %s without making sampling terminal',
    (value) => {
      const f = fixture();
      pending(f);
      f.state.available = true;
      f.state.value = value;
      f.timer.begin();
      f.timer.end();
      expect(f.timer.milliseconds).toBeNull();
      expect(f.timer.sampleSequence).toBe(0);
      f.state.value = 0;
      f.timer.begin();
      f.timer.end();
      expect(f.timer.milliseconds).toBe(0);
      expect(f.timer.sampleSequence).toBe(1);
      f.timer.dispose();
      expectRetired(f);
    },
  );

  it('still publishes a valid fetched sample when query allocation returns null normally', () => {
    const f = fixture();
    pending(f);
    f.state.available = true;
    f.state.allocationNull = true;
    f.timer.begin();
    f.timer.end();
    expect(f.timer.milliseconds).toBe(8);
    expect(f.timer.sampleSequence).toBe(1);
    expectRetired(f);
    f.state.allocationNull = false;
    f.timer.begin();
    f.timer.end();
    expect(f.begun).toHaveLength(2);
  });

  it('keeps four-query capacity and nested-begin protection unchanged', () => {
    const f = fixture();
    for (let i = 0; i < 1000; i++) {
      f.timer.begin();
      f.timer.begin();
      f.timer.end();
    }
    expect(f.allocated).toHaveLength(4);
    expect(f.begun).toHaveLength(4);
    expect(f.calls.get('end')).toBe(4);
    f.timer.dispose();
    expectRetired(f);
  });

  it('abandons handles on known context loss and samples with fresh handles after restoration', () => {
    const f = fixture();
    pending(f, 3);
    f.timer.begin();
    f.state.lost = true;
    const ends = f.calls.get('end');
    f.timer.end();
    expect(f.calls.get('end')).toBe(ends);
    expect(f.deleted).toHaveLength(0);
    expect(f.timer.milliseconds).toBeNull();
    f.state.lost = false;
    f.timer.begin();
    f.timer.end();
    expect(f.allocated).toHaveLength(5);
    f.timer.dispose();
    expect(f.deleted).toEqual([f.allocated[4]]);
  });

  it.each(['loseOnResult', 'disjointOnResult'] as const)(
    'invalidates a sample when %s happens during readback',
    (transition) => {
      const f = fixture();
      pending(f);
      f.state.available = true;
      f.state[transition] = true;
      f.timer.begin();
      expect(f.timer.milliseconds).toBeNull();
      expect(f.timer.sampleSequence).toBe(0);
      expect(f.begun).toHaveLength(1);
      expect(f.deleted).toHaveLength(transition === 'loseOnResult' ? 0 : 1);
    },
  );
});
