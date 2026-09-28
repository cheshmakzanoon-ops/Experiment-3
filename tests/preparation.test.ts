import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { compileSceneTarget, PreparationTrace } from '../src/rendering/preparation.ts';

describe('grid preparation diagnostics and target ownership', () => {
  it('compiles for the actual scene attachment and restores state before an async wait', async () => {
    const original = new T.WebGLRenderTarget(),
      linear = new T.WebGLRenderTarget(32, 20, { type: T.HalfFloatType });
    let current: T.WebGLRenderTarget | null = original,
      face = 2,
      mip = 1;
    let viewport = new T.Vector4(1, 2, 30, 20),
      scissor = new T.Vector4(2, 3, 8, 8),
      scissorTest = true;
    let finish: () => void = () => {};
    const compiling = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const renderer = {
      getRenderTarget: () => current,
      getActiveCubeFace: () => face,
      getActiveMipmapLevel: () => mip,
      getViewport: (v: T.Vector4) => v.copy(viewport),
      getScissor: (v: T.Vector4) => v.copy(scissor),
      getScissorTest: () => scissorTest,
      setRenderTarget: (t: T.WebGLRenderTarget | null, f = 0, m = 0) => {
        current = t;
        face = f;
        mip = m;
        viewport.set(0, 0, 32, 20);
        scissorTest = false;
      },
      setViewport: (v: T.Vector4) => {
        viewport = v;
      },
      setScissor: (v: T.Vector4) => {
        scissor = v;
      },
      setScissorTest: (v: boolean) => {
        scissorTest = v;
      },
      compileAsync: () => {
        expect(current).toBe(linear);
        return compiling;
      },
    };
    const promise = compileSceneTarget(
      renderer as unknown as T.WebGLRenderer,
      new T.Scene(),
      new T.Camera(),
      linear,
    );
    const restored = () => {
      expect(current).toBe(original);
      expect([face, mip]).toEqual([2, 1]);
      expect(viewport.toArray()).toEqual([1, 2, 30, 20]);
      expect(scissor.toArray()).toEqual([2, 3, 8, 8]);
      expect(scissorTest).toBe(true);
    };
    restored();
    finish();
    await promise;
    renderer.compileAsync = () => {
      throw new Error('compile failed');
    };
    expect(() =>
      compileSceneTarget(
        renderer as unknown as T.WebGLRenderer,
        new T.Scene(),
        new T.Camera(),
        linear,
      ),
    ).toThrow('compile failed');
    restored();
    original.dispose();
    linear.dispose();
  });
  it('reports individual stages and never advances a completed trace on later reads', async () => {
    let now = 0;
    const trace = new PreparationTrace(() => now),
      labels: string[] = [];
    const run = trace.run(
      (label) => labels.push(label),
      async (report) => {
        report('materials');
        now = 12;
        report('GPU');
        now = 32;
        return true;
      },
    );
    expect(await run).toBe(true);
    now = 99;
    expect(trace.snapshot()).toEqual({
      status: 'complete',
      elapsedMs: 32,
      error: null,
      stages: [
        { label: 'materials', elapsedMs: 12, complete: true },
        { label: 'GPU', elapsedMs: 20, complete: true },
      ],
    });
    expect(labels).toEqual(['materials', 'GPU']);
  });
  it('retains cancellations and actual failures without swallowing them', async () => {
    let now = 0;
    const trace = new PreparationTrace(() => now);
    expect(
      await trace.run(
        () => {},
        async (report) => {
          report('grid');
          now = 7;
          return false;
        },
      ),
    ).toBe(false);
    expect(trace.snapshot()?.status).toBe('cancelled');
    await expect(
      trace.run(
        () => {},
        async (report) => {
          report('shaders');
          throw new Error('lost context');
        },
      ),
    ).rejects.toThrow('lost context');
    expect(trace.snapshot()?.error).toBe('lost context');
    expect(trace.snapshot()?.status).toBe('failed');
  });
  it('bounds history and prevents an older cancellation from overwriting a newer session', async () => {
    const trace = new PreparationTrace(() => 0);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const old = trace.run(
      () => {},
      async (report) => {
        report('old');
        await held;
        return false;
      },
    );
    await trace.run(
      () => {},
      async (report) => {
        for (let i = 0; i < 100; i++) report(`new ${i}`);
        return true;
      },
    );
    release();
    await old;
    expect(trace.snapshot()?.status).toBe('complete');
    expect(trace.snapshot()?.stages).toHaveLength(32);
    expect(trace.snapshot()?.stages.at(-1)?.label).toBe('new 99');
  });
});
