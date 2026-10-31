import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { WebGLPrograms } from 'three/src/renderers/webgl/WebGLPrograms.js';
import { waitForAllPrograms } from '../src/rendering/preparation.ts';

function fixture(count = 3) {
  const handles = Array.from({ length: count }, () => ({}) as WebGLProgram);
  const programs = handles.map((program) => ({ program }));
  let lost = false;
  const query = vi.fn((_program: WebGLProgram, _key: number): unknown => true);
  const gl = {
    isContextLost: () => lost,
    getExtension: vi.fn(() => ({ COMPLETION_STATUS_KHR: 0x91b1 })),
    getProgramParameter: query,
  };
  const renderer = { info: { programs }, getContext: () => gl } as unknown as T.WebGLRenderer;
  return {
    renderer,
    programs,
    handles,
    query,
    gl,
    lose: () => {
      lost = true;
    },
  };
}

describe('all live shader variant readiness', () => {
  it('checks older and shared-material handles in bounded batches without log/link queries', async () => {
    const f = fixture(5),
      bursts: number[] = [];
    let queries = 0;
    f.query.mockImplementation((_program, key) => {
      expect(key).toBe(0x91b1);
      queries++;
      return true;
    });
    expect(
      await waitForAllPrograms(f.renderer, {
        batchSize: 2,
        yieldControl: async () => {
          bursts.push(queries);
          queries = 0;
        },
      }),
    ).toBe('complete');
    expect(bursts).toEqual([2, 2, 1]);
    expect(f.query.mock.calls.map(([p]) => p)).toEqual(f.handles);
  });
  it('rechecks pending handles and includes a newly live variant without querying disposed handles', async () => {
    const f = fixture(3);
    let yields = 0;
    f.query.mockReturnValueOnce(false);
    const added = {} as WebGLProgram;
    await waitForAllPrograms(f.renderer, {
      batchSize: 1,
      yieldControl: async () => {
        if (yields++ === 0) {
          f.programs.splice(1, 1);
          f.programs.push({ program: added });
        }
      },
    });
    expect(f.query.mock.calls.map(([p]) => p)).toEqual([
      f.handles[0],
      f.handles[2],
      f.handles[0],
      added,
    ]);
  });
  it('stops at cancellation between batches and never observes another program', async () => {
    const f = fixture();
    let cancelled = false;
    expect(
      await waitForAllPrograms(f.renderer, {
        batchSize: 1,
        cancelled: () => cancelled,
        yieldControl: async () => {
          cancelled = true;
        },
      }),
    ).toBe('cancelled');
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it('does no GL work for an already cancelled owner', async () => {
    const f = fixture();
    expect(await waitForAllPrograms(f.renderer, { cancelled: () => true })).toBe('cancelled');
    expect(f.gl.getExtension).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
  });
  it('fails closed on context loss, invalid status and driver errors', async () => {
    const f = fixture();
    f.query.mockImplementationOnce(() => {
      f.lose();
      return true;
    });
    await expect(waitForAllPrograms(f.renderer)).rejects.toThrow('context lost');
    const invalid = fixture();
    invalid.query.mockReturnValue(null);
    await expect(waitForAllPrograms(invalid.renderer)).rejects.toThrow('Unable to check');
    const thrown = fixture();
    thrown.query.mockImplementation(() => {
      throw new Error('driver failed');
    });
    await expect(waitForAllPrograms(thrown.renderer)).rejects.toThrow('driver failed');
  });
  it('retains the finite 45s budget, including a query that returns late', async () => {
    const f = fixture();
    let time = 0;
    f.query.mockReturnValue(false);
    await expect(
      waitForAllPrograms(f.renderer, {
        now: () => time,
        yieldControl: async () => {
          time = 45000;
        },
      }),
    ).rejects.toThrow('within 45000ms');
    const late = fixture();
    time = 0;
    late.query.mockImplementation(() => {
      time = 45000;
      return true;
    });
    await expect(waitForAllPrograms(late.renderer, { now: () => time })).rejects.toThrow(
      'within 45000ms',
    );
  });
  it('reports unsupported KHR explicitly and preserves a yielded real-draw fallback', async () => {
    const f = fixture();
    f.gl.getExtension.mockReturnValue(null as never);
    const yieldControl = vi.fn(async () => {});
    expect(await waitForAllPrograms(f.renderer, { yieldControl })).toBe('unsupported');
    expect(yieldControl).toHaveBeenCalledOnce();
    expect(f.query).not.toHaveBeenCalled();
  });
  it('reports exact query coverage without allowing observers to break readiness', async () => {
    const f = fixture(3),
      report = vi.fn(() => {
        throw new Error('observer');
      });
    expect(await waitForAllPrograms(f.renderer, { yieldControl: async () => {}, report })).toBe(
      'complete',
    );
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'complete',
        livePrograms: 3,
        queriedPrograms: 3,
        queries: 3,
      }),
    );
  });
  it.each(['cancelled', 'deadline', 'context loss'] as const)(
    'observes %s while the supplied scheduler never resolves and cleans late rejection',
    async (reason) => {
      vi.useFakeTimers();
      try {
        const f = fixture();
        f.query.mockReturnValue(false);
        let cancelled = false;
        let rejectYield: (error: Error) => void = () => {};
        const held = new Promise<void>((_resolve, reject) => {
          rejectYield = reject;
        });
        const result = waitForAllPrograms(f.renderer, {
          cancelled: () => cancelled,
          now: () => Date.now(),
          yieldControl: () => held,
        }).then(
          (value) => ({ value }),
          (error) => ({ error: String(error) }),
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(f.query).toHaveBeenCalledTimes(3);
        if (reason === 'cancelled') cancelled = true;
        if (reason === 'context loss') f.lose();
        await vi.advanceTimersByTimeAsync(reason === 'deadline' ? 45000 : 50);
        const settled = await result;
        if (reason === 'cancelled') expect(settled).toEqual({ value: 'cancelled' });
        else
          expect(settled).toEqual({
            error: expect.stringContaining(
              reason === 'deadline' ? 'within 45000ms' : 'context lost',
            ),
          });
        expect(vi.getTimerCount()).toBe(0);
        rejectYield(new Error('late scheduler failure'));
        await vi.advanceTimersByTimeAsync(100);
        expect(vi.getTimerCount()).toBe(0);
        expect(f.query).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('bounds a suspended no-extension fallback and ignores a late resolution', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.gl.getExtension.mockReturnValue(null as never);
      let cancelled = false,
        resume: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const result = waitForAllPrograms(f.renderer, {
        cancelled: () => cancelled,
        now: () => Date.now(),
        yieldControl: () => held,
      });
      await vi.advanceTimersByTimeAsync(0);
      cancelled = true;
      await vi.advanceTimersByTimeAsync(50);
      expect(await result).toBe('cancelled');
      expect(vi.getTimerCount()).toBe(0);
      resume();
      await vi.advanceTimersByTimeAsync(100);
      expect(f.query).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('cleans its scheduler watcher on normal completion and rejection', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      expect(await waitForAllPrograms(f.renderer, { yieldControl: async () => {} })).toBe(
        'complete',
      );
      expect(vi.getTimerCount()).toBe(0);
      await expect(
        waitForAllPrograms(f.renderer, {
          yieldControl: async () => {
            throw new Error('scheduler failed');
          },
        }),
      ).rejects.toThrow('scheduler failed');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('uses actual installed Three keys: one shared material has mesh, instance and skin variants', () => {
    const target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType });
    const renderer = {
      getRenderTarget: () => target,
      state: { buffers: { depth: { getReversed: () => false } } },
      shadowMap: { enabled: false, type: T.PCFSoftShadowMap },
      outputColorSpace: T.SRGBColorSpace,
      toneMapping: T.ACESFilmicToneMapping,
    };
    // The pinned runtime takes cubeuvmaps too; its DefinitelyTyped constructor lags.
    const cache = Reflect.construct(WebGLPrograms, [
      renderer as never,
      { get: (x: unknown) => x } as never,
      { get: (x: unknown) => x } as never,
      { has: () => true } as never,
      { precision: 'highp', vertexTextures: true, logarithmicDepthBuffer: false } as never,
      {} as never,
      { numPlanes: 0, numIntersection: 0 } as never,
    ]) as WebGLPrograms;
    const lights = {
      numSpotLightShadowsWithMaps: 0,
      numLightProbes: 0,
      directional: [],
      point: [],
      spot: [],
      spotLightMap: [],
      rectArea: [],
      hemi: [],
      directionalShadowMap: [],
      pointShadowMap: [],
      spotShadowMap: [],
    };
    const scene = new T.Scene(),
      material = new T.MeshStandardMaterial({ side: T.DoubleSide }),
      geometry = new T.BoxGeometry();
    const objects = [
      new T.Mesh(geometry, material),
      new T.InstancedMesh(geometry, material, 1),
      new T.SkinnedMesh(geometry, material),
    ];
    const key = (object: T.Object3D) =>
      cache.getProgramCacheKey(cache.getParameters(material, lights as never, [], scene, object));
    expect(new Set(objects.map((o) => o.material)).size).toBe(1);
    expect(new Set(objects.map(key)).size).toBe(3);
    material.transparent = true;
    material.side = T.BackSide;
    const back = key(objects[0]);
    material.side = T.FrontSide;
    expect(key(objects[0])).not.toBe(back);
    geometry.dispose();
    material.dispose();
    target.dispose();
    (objects[1] as T.InstancedMesh).dispose();
  });
});
