import { expect, it, vi } from 'vitest';
import type * as T from 'three';
import { waitForAllPrograms } from '../src/rendering/preparation.ts';
import { snapshotPrograms, describeProgramChanges } from '../src/rendering/program-inventory.ts';
function fixture() {
  const events: string[] = [];
  const programs = Array.from({ length: 6 }, (_, id) => ({
    id,
    name: `material${id}`,
    cacheKey: `variant${id}`,
    program: {} as WebGLProgram,
    getUniforms: vi.fn(function (this: { id: number }) {
      events.push(`uniforms${this.id}`);
    }),
    getAttributes: vi.fn(function (this: { id: number }) {
      events.push(`attributes${this.id}`);
    }),
  }));
  const query = vi.fn(() => {
    events.push('ready');
    return true;
  });
  const gl = {
    isContextLost: () => false,
    getExtension: vi.fn(() => ({ COMPLETION_STATUS_KHR: 0x91b1 })),
    getProgramParameter: query,
  };
  const renderer = { info: { programs }, getContext: () => gl } as unknown as T.WebGLRenderer;
  return { programs, events, renderer, query, gl };
}
it('primes existing native getters only after all readiness and cooperates between bounded cache batches', async () => {
  const f = fixture();
  let calls = 0;
  const bursts: number[] = [];
  expect(
    await waitForAllPrograms(f.renderer, {
      initializeCaches: true,
      yieldControl: async () => {
        bursts.push(f.events.filter((x) => x.startsWith('uniforms')).length - calls);
        calls += bursts.at(-1)!;
      },
    }),
  ).toBe('complete');
  expect(f.events.slice(0, 6)).toEqual(Array(6).fill('ready'));
  expect(bursts).toEqual([0, 4, 2]);
  f.programs.forEach((p) => {
    expect(p.getUniforms).toHaveBeenCalledOnce();
    expect(p.getAttributes).toHaveBeenCalledOnce();
  });
});
it('reports cache coverage alongside program-query coverage', async () => {
  const f = fixture(),
    report = vi.fn();
  await waitForAllPrograms(f.renderer, {
    initializeCaches: true,
    yieldControl: async () => {},
    report,
  });
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({ initializedPrograms: 6, queriedPrograms: 6, status: 'complete' }),
  );
});

it('does not prime unsupported or cancelled owners and propagates original getter errors', async () => {
  const f = fixture();
  f.gl.getExtension.mockReturnValue(null as never);
  expect(
    await waitForAllPrograms(f.renderer, { initializeCaches: true, yieldControl: async () => {} }),
  ).toBe('unsupported');
  expect(f.programs[0].getUniforms).not.toHaveBeenCalled();
  const bad = fixture();
  bad.programs[0].getUniforms.mockImplementation(() => {
    throw new Error('native first-use failure');
  });
  await expect(
    waitForAllPrograms(bad.renderer, { initializeCaches: true, yieldControl: async () => {} }),
  ).rejects.toThrow('native first-use failure');
  expect(bad.programs[0].getAttributes).not.toHaveBeenCalled();
});
it('stops cache priming after cancellation between batches', async () => {
  const f = fixture();
  let cancelled = false;
  let yielded = 0;
  expect(
    await waitForAllPrograms(f.renderer, {
      initializeCaches: true,
      cancelled: () => cancelled,
      yieldControl: async () => {
        if (++yielded === 2) cancelled = true;
      },
    }),
  ).toBe('cancelled');
  expect(f.programs[3].getUniforms).toHaveBeenCalledOnce();
  expect(f.programs[4].getUniforms).not.toHaveBeenCalled();
});
it('retains exact identity changes even at equal net count, with bounded new-program keys', () => {
  const f = fixture();
  const before = snapshotPrograms(f.programs as never);
  const next = [
    ...f.programs.slice(1),
    { ...f.programs[0], id: 99, name: 'new', cacheKey: 'X'.repeat(2000) },
  ];
  const inventory = describeProgramChanges(before, next as never);
  expect(inventory.beforeCount).toBe(inventory.afterCount);
  expect(inventory.oldIds).toEqual([0, 1, 2, 3, 4, 5]);
  expect(inventory.newIds).toEqual([99]);
  expect(inventory.removedIds).toEqual([0]);
  expect(inventory.newPrograms[0]).toMatchObject({ id: 99, name: 'new', cacheKeyTruncated: true });
  expect(inventory.newPrograms[0].cacheKey).toHaveLength(1200);
});

it('observes a variant added during a yield before initializing its caches', async () => {
  const f = fixture();
  let added = false;
  const program = {
    ...f.programs[0],
    id: 99,
    program: {} as WebGLProgram,
    getUniforms: vi.fn(() => {
      expect(f.query).toHaveBeenCalledTimes(7);
    }),
    getAttributes: vi.fn(),
  };
  expect(
    await waitForAllPrograms(f.renderer, {
      initializeCaches: true,
      yieldControl: async () => {
        if (!added) {
          added = true;
          f.programs.push(program);
        }
      },
    }),
  ).toBe('complete');
  expect(program.getUniforms).toHaveBeenCalledOnce();
  expect(program.getAttributes).toHaveBeenCalledOnce();
});

it('does not continue native cache calls after disposal/cancellation inside a getter', async () => {
  const f = fixture();
  let cancelled = false;
  f.programs[0].getUniforms.mockImplementation(() => {
    cancelled = true;
  });
  expect(
    await waitForAllPrograms(f.renderer, {
      initializeCaches: true,
      cancelled: () => cancelled,
      yieldControl: async () => {},
    }),
  ).toBe('cancelled');
  expect(f.programs[0].getAttributes).not.toHaveBeenCalled();
  expect(f.programs[1].getUniforms).not.toHaveBeenCalled();
});

it('observes cancellation while a cache-batch scheduler is suspended', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    let cancelled = false,
      yields = 0;
    const result = waitForAllPrograms(f.renderer, {
      initializeCaches: true,
      cancelled: () => cancelled,
      now: () => Date.now(),
      yieldControl: () => (++yields === 1 ? Promise.resolve() : new Promise<void>(() => {})),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.programs[3].getUniforms).toHaveBeenCalledOnce();
    cancelled = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe('cancelled');
    expect(vi.getTimerCount()).toBe(0);
    expect(f.programs[4].getUniforms).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('bounds inventory ID lists and new-program descriptions with explicit dropped counts', () => {
  const old = Array.from({ length: 600 }, (_, id) => ({ id, name: 'old', cacheKey: 'key' }));
  const next = Array.from({ length: 13 }, (_, id) => ({
    id: id + 1000,
    name: 'N'.repeat(200),
    cacheKey: 'K'.repeat(2000),
  }));
  const detail = describeProgramChanges(snapshotPrograms(old as never), next as never);
  expect(detail.oldIds).toHaveLength(512);
  expect(detail.oldIdsDropped).toBe(88);
  expect(detail.removedIds).toHaveLength(512);
  expect(detail.removedIdsDropped).toBe(88);
  expect(detail.newPrograms).toHaveLength(12);
  expect(detail.newProgramsDropped).toBe(1);
  expect(detail.newPrograms[0].name).toHaveLength(120);
  expect(detail.newPrograms[0].cacheKey).toHaveLength(1200);
  expect(detail.newPrograms[0].cacheKeyTruncated).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(detail)).byteLength).toBeLessThan(32768);
});
