import { describe, expect, it, vi } from 'vitest';
import { GpuPassTimer, PassLedger } from '../src/rendering/ultra/pass-ledger.ts';

function fixture() {
  let lost = false;
  let disjoint = false;
  let sequence = 0;
  const queries: WebGLQuery[] = [];
  const values = new Map<WebGLQuery, unknown>();
  const ready = new Map<WebGLQuery, boolean>();
  const ext = {
    TIMESTAMP_EXT: 1,
    QUERY_COUNTER_BITS_EXT: 2,
    GPU_DISJOINT_EXT: 3,
    queryCounterEXT: vi.fn((query: WebGLQuery) => {
      values.set(query, ++sequence * 2e6);
    }),
  };
  const gl = {
    QUERY_RESULT_AVAILABLE: 10,
    QUERY_RESULT: 11,
    getExtension: vi.fn(() => ext),
    getQuery: vi.fn(() => 64),
    createQuery: vi.fn((): WebGLQuery | null => {
      const query = {} as WebGLQuery;
      queries.push(query);
      ready.set(query, true);
      return query;
    }),
    deleteQuery: vi.fn((_query: WebGLQuery) => {}),
    getParameter: vi.fn(() => disjoint),
    isContextLost: vi.fn(() => lost),
    getQueryParameter: vi.fn((query: WebGLQuery, name: number): unknown =>
      name === 10 ? ready.get(query) : values.get(query),
    ),
  };
  return {
    gl,
    ext,
    queries,
    values,
    ready,
    timer: () => new GpuPassTimer(gl as unknown as WebGL2RenderingContext),
    lose: () => {
      lost = true;
    },
    restore: () => {
      lost = false;
    },
    disjoin: (value = true) => {
      disjoint = value;
    },
  };
}

const deletions = (f: ReturnType<typeof fixture>) => f.gl.deleteQuery.mock.calls.map(([q]) => q);

describe('per-pass GPU timing ownership', () => {
  it('releases a partial query pair and still renders exactly once', () => {
    const f = fixture();
    const timer = f.timer();
    const first = {} as WebGLQuery;
    f.gl.createQuery.mockReturnValueOnce(first).mockReturnValueOnce(null);
    const render = vi.fn();
    timer.measure('pass', render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(deletions(f)).toEqual([first]);
    expect(f.ext.queryCounterEXT).not.toHaveBeenCalled();
    timer.dispose();
    expect(deletions(f)).toEqual([first]);
  });

  it('does not allocate a second query when the first is unavailable', () => {
    const f = fixture();
    const timer = f.timer();
    f.gl.createQuery.mockReturnValueOnce(null);
    const render = vi.fn();
    timer.measure('pass', render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(f.gl.createQuery).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteQuery).not.toHaveBeenCalled();
  });

  it.each(['allocation', 'start', 'end'] as const)(
    'contains %s failures without skipping rendering or leaking ownership',
    (failure) => {
      const f = fixture();
      const timer = f.timer();
      const error = new Error('timing failure');
      if (failure === 'allocation') {
        const first = {} as WebGLQuery;
        f.gl.createQuery.mockReturnValueOnce(first).mockImplementationOnce(() => {
          throw error;
        });
      } else if (failure === 'start') {
        f.ext.queryCounterEXT.mockImplementationOnce(() => {
          throw error;
        });
      } else {
        f.ext.queryCounterEXT
          .mockImplementationOnce(() => {})
          .mockImplementationOnce(() => {
            throw error;
          });
      }
      const render = vi.fn();
      expect(() => timer.measure('pass', render)).not.toThrow();
      expect(render).toHaveBeenCalledTimes(1);
      expect(f.gl.deleteQuery).toHaveBeenCalledTimes(failure === 'allocation' ? 1 : 2);
      const report = vi.fn();
      timer.poll(report);
      expect(report).not.toHaveBeenCalled();
      timer.dispose();
      expect(f.gl.deleteQuery).toHaveBeenCalledTimes(failure === 'allocation' ? 1 : 2);
    },
  );

  it('preserves the render exception when the ending timestamp also fails', () => {
    const f = fixture();
    const timer = f.timer();
    f.ext.queryCounterEXT
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('timestamp failure');
      });
    const renderError = new Error('render failure');
    expect(() =>
      timer.measure('pass', () => {
        throw renderError;
      }),
    ).toThrow(renderError);
    expect(f.gl.deleteQuery).toHaveBeenCalledTimes(2);
  });

  it('retires all pending disjoint samples before they become available', () => {
    const f = fixture();
    const timer = f.timer();
    timer.measure('old-a', () => {});
    timer.measure('old-b', () => {});
    for (const q of f.queries) f.ready.set(q, false);
    f.disjoin();
    const report = vi.fn();
    timer.poll(report);
    expect(deletions(f)).toEqual(f.queries);
    expect(report).not.toHaveBeenCalled();
    f.disjoin(false);
    for (const q of f.queries) f.ready.set(q, true);
    timer.measure('new', () => {});
    timer.poll(report);
    expect(report.mock.calls).toEqual([['new', 2]]);
    expect(deletions(f)).toEqual(f.queries);
  });

  it('drops lost-context handles without deleting them or publishing after restoration', () => {
    const f = fixture();
    const timer = f.timer();
    timer.measure('old', () => {});
    f.lose();
    const report = vi.fn();
    timer.poll(report);
    expect(report).not.toHaveBeenCalled();
    expect(f.gl.deleteQuery).not.toHaveBeenCalled();
    f.restore();
    timer.measure('new', () => {});
    timer.poll(report);
    expect(report.mock.calls).toEqual([['new', 2]]);
    expect(deletions(f)).toEqual(f.queries.slice(2));
  });

  it.each([null, undefined, NaN, Infinity, -1, '2000000', true])(
    'does not coerce an invalid start timestamp %s into a measured duration',
    (invalid) => {
      const f = fixture();
      const timer = f.timer();
      timer.measure('pass', () => {});
      f.values.set(f.queries[0], invalid);
      const report = vi.fn();
      timer.poll(report);
      expect(report).not.toHaveBeenCalled();
      expect(deletions(f)).toEqual(f.queries);
    },
  );

  it.each(['lost', 'disjoint'] as const)(
    'rechecks %s status after reading timestamps',
    (failure) => {
      const f = fixture();
      const timer = f.timer();
      timer.measure('pass', () => {});
      const read = f.gl.getQueryParameter.getMockImplementation()!;
      f.gl.getQueryParameter.mockImplementation((query, name) => {
        const result = read(query, name);
        if (name === 11) {
          if (failure === 'lost') f.lose();
          else f.disjoin();
        }
        return result;
      });
      const report = vi.fn();
      timer.poll(report);
      expect(report).not.toHaveBeenCalled();
      expect(f.gl.deleteQuery).toHaveBeenCalledTimes(failure === 'lost' ? 0 : 2);
    },
  );

  it('contains query-result failures and resumes measurement after cleanup', () => {
    const f = fixture();
    const timer = f.timer();
    timer.measure('old-a', () => {});
    timer.measure('old-b', () => {});
    f.gl.getQueryParameter.mockImplementationOnce(() => {
      throw new Error('read failure');
    });
    const report = vi.fn();
    expect(() => timer.poll(report)).not.toThrow();
    expect(deletions(f)).toEqual(f.queries);
    timer.measure('new', () => {});
    timer.poll(report);
    expect(report.mock.calls).toEqual([['new', 2]]);
  });

  it('retires the reported pair before invoking a throwing report callback', () => {
    const f = fixture();
    const timer = f.timer();
    timer.measure('first', () => {});
    timer.measure('second', () => {});
    const reportError = new Error('report failure');
    expect(() =>
      timer.poll(() => {
        throw reportError;
      }),
    ).toThrow(reportError);
    expect(deletions(f)).toEqual(f.queries.slice(0, 2));
    const report = vi.fn();
    timer.poll(report);
    expect(report.mock.calls).toEqual([['second', 2]]);
    expect(deletions(f)).toEqual(f.queries);
  });

  it('releases active nested measurements on disposal without closing them afterward', () => {
    const f = fixture();
    const timer = f.timer();
    const render = vi.fn();
    timer.measure('outer', () => {
      timer.measure('inner', () => {
        timer.dispose();
        render();
      });
    });
    expect(render).toHaveBeenCalledTimes(1);
    expect(f.ext.queryCounterEXT).toHaveBeenCalledTimes(2);
    expect(new Set(deletions(f))).toEqual(new Set(f.queries));
    expect(f.gl.deleteQuery).toHaveBeenCalledTimes(4);
    timer.dispose();
    timer.poll(vi.fn());
    timer.measure('late', render);
    expect(render).toHaveBeenCalledTimes(2);
    expect(f.gl.createQuery).toHaveBeenCalledTimes(4);
    expect(f.gl.deleteQuery).toHaveBeenCalledTimes(4);
  });

  it('continues cleanup if one query deletion throws and stays idempotent', () => {
    const f = fixture();
    const timer = f.timer();
    timer.measure('first', () => {});
    timer.measure('second', () => {});
    f.gl.deleteQuery.mockImplementationOnce(() => {
      throw new Error('delete failure');
    });
    expect(() => timer.dispose()).not.toThrow();
    expect(deletions(f)).toEqual(f.queries);
    timer.dispose();
    expect(f.gl.deleteQuery).toHaveBeenCalledTimes(4);
  });

  it('bounds pending measurements while continuing every rendering callback', () => {
    const f = fixture();
    const timer = f.timer();
    const render = vi.fn();
    for (let i = 0; i < 100; i++) timer.measure('pass', render);
    expect(render).toHaveBeenCalledTimes(100);
    expect(f.gl.createQuery).toHaveBeenCalledTimes(96);
    timer.dispose();
    expect(deletions(f)).toEqual(f.queries);
  });

  it.each(['extension', 'counterBits', 'contextStatus'] as const)(
    'treats a failed %s capability probe as unsupported timing',
    (failure) => {
      const f = fixture();
      const fail = () => {
        throw new Error('probe failure');
      };
      if (failure === 'extension') f.gl.getExtension.mockImplementationOnce(fail);
      if (failure === 'counterBits') f.gl.getQuery.mockImplementationOnce(fail);
      if (failure === 'contextStatus') f.gl.isContextLost.mockImplementationOnce(fail);
      const timer = f.timer();
      expect(timer.supported).toBe(false);
      const render = vi.fn();
      timer.measure('pass', render);
      expect(render).toHaveBeenCalledTimes(1);
      expect(f.gl.createQuery).not.toHaveBeenCalled();
    },
  );

  it.each([null, NaN, -1, '4000000'])(
    'rejects invalid ending timestamp %s while retiring the pair',
    (invalid) => {
      const f = fixture();
      const timer = f.timer();
      timer.measure('pass', () => {});
      f.values.set(f.queries[1], invalid);
      const report = vi.fn();
      timer.poll(report);
      expect(report).not.toHaveBeenCalled();
      expect(deletions(f)).toEqual(f.queries);
    },
  );

  it('retains genuine zero timestamps and nonblocking pending samples', () => {
    const f = fixture();
    const timer = f.timer();
    timer.measure('pass', () => {});
    f.ready.set(f.queries[1], false);
    const report = vi.fn();
    timer.poll(report);
    expect(report).not.toHaveBeenCalled();
    expect(f.gl.deleteQuery).not.toHaveBeenCalled();
    f.values.set(f.queries[0], 0);
    f.values.set(f.queries[1], 0);
    f.ready.set(f.queries[1], true);
    timer.poll(report);
    expect(report.mock.calls).toEqual([['pass', 0]]);
    expect(deletions(f)).toEqual(f.queries);
  });

  it('includes active nested measurements in the capacity bound', () => {
    const f = fixture();
    const timer = f.timer();
    const render = vi.fn();
    const recurse = (depth: number) =>
      timer.measure('pass', () => {
        render();
        if (depth > 1) recurse(depth - 1);
      });
    recurse(100);
    expect(render).toHaveBeenCalledTimes(100);
    expect(f.gl.createQuery).toHaveBeenCalledTimes(96);
    timer.dispose();
    expect(new Set(deletions(f))).toEqual(new Set(f.queries));
    expect(f.gl.deleteQuery).toHaveBeenCalledTimes(96);
  });

  it('drops pending and active handles when context loss occurs while rendering', () => {
    const f = fixture();
    const timer = f.timer();
    timer.measure('previous', () => {});
    timer.measure('lost', () => {
      f.lose();
    });
    expect(f.ext.queryCounterEXT).toHaveBeenCalledTimes(3);
    expect(f.gl.deleteQuery).not.toHaveBeenCalled();
    f.restore();
    const report = vi.fn();
    timer.poll(report);
    expect(report).not.toHaveBeenCalled();
    timer.measure('new', () => {});
    timer.poll(report);
    expect(report.mock.calls).toEqual([['new', 2]]);
    expect(deletions(f)).toEqual(f.queries.slice(4));
  });

  it('preserves pass return values and draw accounting across timing failures', () => {
    const f = fixture();
    const timer = f.timer();
    const info = { calls: 0, triangles: 0 };
    const ledger = new PassLedger(info, timer);
    f.gl.createQuery.mockImplementationOnce(() => {
      throw new Error('allocation failure');
    });
    const result = {};
    expect(
      ledger.measure('pass', () => {
        info.calls += 3;
        info.triangles += 18;
        return result;
      }),
    ).toBe(result);
    expect(ledger.snapshot().pass).toEqual({
      calls: 3,
      triangles: 18,
      frames: 1,
      gpuMs: null,
      fetchesM: 0,
    });
  });
});
