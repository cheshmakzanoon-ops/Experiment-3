import * as T from 'three';
import { UltraHDRLoader } from 'three/addons/loaders/UltraHDRLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnvironment } from '../src/rendering/assets/environment-loader.ts';
import * as gainMap from '../src/rendering/assets/gain-map.ts';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function pair(): gainMap.GainMapTextures {
  return {
    base: new T.Texture(),
    gain: new T.Texture(),
    gainMax: 1,
    width: 64,
    height: 32,
    bytes: 2,
    dispose: vi.fn(),
  };
}

function fixture() {
  vi.stubGlobal('document', {});
  let target: T.WebGLRenderTarget | null = new T.WebGLCubeRenderTarget(16),
    face = 3,
    mip = 2;
  const adapter = {
    extensions: { has: vi.fn(() => true) },
    compile: vi.fn(),
    render: vi.fn(),
    xr: { enabled: true },
    autoClear: true,
    getRenderTarget: () => target,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    setRenderTarget: vi.fn((next: T.WebGLRenderTarget | null, cubeFace = 0, mipLevel = 0) => {
      target = next;
      face = cubeFace;
      mip = mipLevel;
    }),
  };
  const renderer = adapter as unknown as T.WebGLRenderer;
  const load = vi.spyOn(gainMap, 'loadGainMapTextures').mockImplementation(async () => pair());
  const decode = vi
    .spyOn(gainMap, 'decodeGainMapToHalfFloat')
    .mockImplementation(() => new T.WebGLRenderTarget(64, 32, { type: T.HalfFloatType }));
  const convert = vi.spyOn(T.PMREMGenerator.prototype, 'fromEquirectangular');
  const generatorDispose = vi.spyOn(T.PMREMGenerator.prototype, 'dispose');
  const targetDispose = vi.spyOn(T.WebGLRenderTarget.prototype, 'dispose');
  const fallback = vi.spyOn(UltraHDRLoader.prototype, 'loadAsync');
  const state = () => ({ target, face, mip, xr: adapter.xr.enabled, autoClear: adapter.autoClear });
  return {
    renderer,
    adapter,
    load,
    decode,
    convert,
    generatorDispose,
    targetDispose,
    fallback,
    state,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('environment loader resource ownership', () => {
  it('shares pending work and keeps a reference for callers whose handles have not been read yet', async () => {
    const f = fixture(),
      pending = deferred<gainMap.GainMapTextures>(),
      textures = pair();
    f.load.mockReturnValueOnce(pending.promise);
    const first = loadEnvironment(f.renderer, 'quarry-02');
    const second = loadEnvironment(f.renderer, 'quarry-02');
    expect(f.load).toHaveBeenCalledTimes(1);
    pending.resolve(textures);
    const a = await first;
    const background = f.decode.mock.results[0].value as T.WebGLRenderTarget;
    const pmrem = f.convert.mock.results[0].value as T.WebGLRenderTarget;
    a.dispose();
    a.dispose();
    expect(f.targetDispose.mock.contexts).not.toContain(background);
    expect(f.targetDispose.mock.contexts).not.toContain(pmrem);
    const b = await second;
    expect(a).not.toBe(b);
    expect(a.background).toBe(b.background);
    expect(a.environment).toBe(b.environment);
    expect(a.background.mapping).toBe(T.EquirectangularReflectionMapping);
    expect(a.environment.mapping).toBe(T.CubeUVReflectionMapping);
    expect(f.decode).toHaveBeenCalledWith(f.renderer, textures, 1);
    expect(f.convert).toHaveBeenCalledTimes(1);
    expect(textures.dispose).toHaveBeenCalledTimes(1);
    b.dispose();
    b.dispose();
    expect(f.targetDispose.mock.contexts.filter((target) => target === background)).toHaveLength(1);
    expect(f.targetDispose.mock.contexts.filter((target) => target === pmrem)).toHaveLength(1);

    const replacement = await loadEnvironment(f.renderer, 'quarry-02');
    a.dispose();
    b.dispose();
    const companion = await loadEnvironment(f.renderer, 'quarry-02');
    expect(companion.environment).toBe(replacement.environment);
    expect(replacement.environment).not.toBe(b.environment);
    expect(f.load).toHaveBeenCalledTimes(2);
    replacement.dispose();
    companion.dispose();
  });

  it('isolates each renderer, requested variant and radiance scale', async () => {
    const f = fixture();
    const environments = await Promise.all([
      loadEnvironment(f.renderer, 'quarry-02'),
      loadEnvironment(f.renderer, 'quarry-02', { variant: '4k' }),
      loadEnvironment(f.renderer, 'quarry-02', { scale: 2 }),
      loadEnvironment({ ...f.renderer } as T.WebGLRenderer, 'quarry-02'),
    ]);
    expect(f.load).toHaveBeenCalledTimes(4);
    expect(new Set(environments.map((environment) => environment.environment)).size).toBe(4);
    expect(f.decode.mock.calls.map((call) => call[2])).toEqual([1, 1, 2, 1]);
    for (const environment of environments) environment.dispose();
  });

  it('evicts a shared failed download so concurrent consumers can retry', async () => {
    const f = fixture(),
      pending = deferred<gainMap.GainMapTextures>(),
      failure = new Error('download interrupted');
    f.load.mockReturnValueOnce(pending.promise);
    const results = Promise.allSettled([
      loadEnvironment(f.renderer, 'quarry-02'),
      loadEnvironment(f.renderer, 'quarry-02'),
    ]);
    pending.reject(failure);
    expect(await results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(f.decode).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([
      loadEnvironment(f.renderer, 'quarry-02'),
      loadEnvironment(f.renderer, 'quarry-02'),
    ]);
    expect(f.load).toHaveBeenCalledTimes(2);
    expect(a.environment).toBe(b.environment);
    a.dispose();
    b.dispose();
  });

  it.each(['capability check', 'gain-map conversion'])(
    'releases the decoded pair after a failed %s',
    async (stage) => {
      const f = fixture(),
        textures = pair(),
        failure = new Error(stage);
      f.load.mockResolvedValueOnce(textures);
      if (stage === 'capability check')
        f.adapter.extensions.has.mockImplementationOnce(() => {
          throw failure;
        });
      else
        f.decode.mockImplementationOnce(() => {
          throw failure;
        });
      await expect(loadEnvironment(f.renderer, 'quarry-02')).rejects.toBe(failure);
      expect(textures.dispose).toHaveBeenCalledTimes(1);
      expect(f.generatorDispose).not.toHaveBeenCalled();
      const retry = await loadEnvironment(f.renderer, 'quarry-02');
      expect(f.load).toHaveBeenCalledTimes(2);
      retry.dispose();
    },
  );

  it('releases a completed gain-map output if disposing its input pair throws', async () => {
    const f = fixture(),
      textures = pair(),
      failure = new Error('pair disposal interrupted');
    f.load.mockResolvedValueOnce(textures);
    vi.mocked(textures.dispose).mockImplementationOnce(() => {
      throw failure;
    });
    await expect(loadEnvironment(f.renderer, 'quarry-02')).rejects.toBe(failure);
    expect(f.targetDispose.mock.contexts).toContain(f.decode.mock.results[0].value);
    expect(textures.dispose).toHaveBeenCalledTimes(1);
    expect(f.convert).not.toHaveBeenCalled();
  });

  it('releases the gain-map pair before waiting for the fallback and owns its decoded texture', async () => {
    const f = fixture(),
      textures = pair(),
      pending = deferred<T.DataTexture>();
    f.load.mockResolvedValueOnce(textures);
    f.adapter.extensions.has.mockReturnValue(false);
    f.fallback.mockImplementation(() => {
      expect(textures.dispose).toHaveBeenCalledTimes(1);
      return pending.promise;
    });
    const loaded = loadEnvironment(f.renderer, 'quarry-02');
    const background = new T.DataTexture(new Uint16Array(64 * 32 * 4), 64, 32);
    const release = vi.spyOn(background, 'dispose');
    pending.resolve(background);
    const environment = await loaded;
    expect(environment.background).toBe(background);
    expect(f.decode).not.toHaveBeenCalled();
    environment.dispose();
    environment.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('retries a failed fallback without retaining its already released pair', async () => {
    const f = fixture(),
      textures = pair(),
      failure = new Error('fallback decode interrupted');
    f.load.mockResolvedValueOnce(textures);
    f.adapter.extensions.has.mockReturnValue(false);
    f.fallback.mockRejectedValueOnce(failure);
    await expect(loadEnvironment(f.renderer, 'quarry-02')).rejects.toBe(failure);
    expect(textures.dispose).toHaveBeenCalledTimes(1);
    f.fallback.mockResolvedValueOnce(new T.DataTexture(new Uint16Array(64 * 32 * 4), 64, 32));
    const retry = await loadEnvironment(f.renderer, 'quarry-02');
    expect(f.fallback).toHaveBeenCalledTimes(2);
    retry.dispose();
  });

  it('releases the decoded background when PMREM construction throws, then retries', async () => {
    const f = fixture(),
      failure = new Error('PMREM constructor interrupted');
    f.adapter.compile.mockImplementationOnce(() => {
      throw failure;
    });
    await expect(loadEnvironment(f.renderer, 'quarry-02')).rejects.toBe(failure);
    expect(f.targetDispose.mock.contexts).toContain(f.decode.mock.results[0].value);
    expect(f.generatorDispose).not.toHaveBeenCalled();
    const retry = await loadEnvironment(f.renderer, 'quarry-02');
    expect(f.load).toHaveBeenCalledTimes(2);
    retry.dispose();
  });

  it('also releases a fallback texture when PMREM construction fails', async () => {
    const f = fixture(),
      background = new T.DataTexture(new Uint16Array(64 * 32 * 4), 64, 32),
      release = vi.spyOn(background, 'dispose'),
      failure = new Error('PMREM constructor interrupted');
    f.adapter.extensions.has.mockReturnValue(false);
    f.fallback.mockResolvedValueOnce(background);
    f.adapter.compile.mockImplementationOnce(() => {
      throw failure;
    });
    await expect(loadEnvironment(f.renderer, 'quarry-02')).rejects.toBe(failure);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1])(
    'releases the native PMREM output and restores renderer state after draw %i fails',
    async (draw) => {
      const f = fixture(),
        before = f.state(),
        failure = new Error('PMREM draw interrupted');
      if (draw) f.adapter.render.mockImplementationOnce(() => {});
      f.adapter.render.mockImplementationOnce(() => {
        throw failure;
      });
      await expect(loadEnvironment(f.renderer, 'quarry-02')).rejects.toBe(failure);
      const output = f.adapter.setRenderTarget.mock.calls[0][0];
      expect(output).not.toBe(before.target);
      expect(f.targetDispose.mock.contexts.filter((target) => target === output)).toHaveLength(1);
      expect(f.targetDispose.mock.contexts).toContain(f.decode.mock.results[0].value);
      expect(f.generatorDispose).toHaveBeenCalledTimes(1);
      expect(f.state()).toEqual(before);
      const retry = await loadEnvironment(f.renderer, 'quarry-02');
      expect(f.load).toHaveBeenCalledTimes(2);
      retry.dispose();
    },
  );

  it('releases both finished textures when disposing the temporary generator throws', async () => {
    const nativeDispose = T.PMREMGenerator.prototype.dispose,
      f = fixture(),
      failure = new Error('generator disposal interrupted');
    f.generatorDispose.mockImplementationOnce(function (this: T.PMREMGenerator) {
      nativeDispose.call(this);
      throw failure;
    });
    await expect(loadEnvironment(f.renderer, 'quarry-02')).rejects.toBe(failure);
    const pmrem = f.convert.mock.results[0].value as T.WebGLRenderTarget;
    expect(f.targetDispose.mock.contexts).toContain(f.decode.mock.results[0].value);
    expect(f.targetDispose.mock.contexts.filter((target) => target === pmrem)).toHaveLength(1);
    expect(f.generatorDispose).toHaveBeenCalledTimes(1);
  });

  it('still releases PMREM if background disposal throws and leaves the cache ready for a new owner', async () => {
    const f = fixture();
    const environment = await loadEnvironment(f.renderer, 'quarry-02');
    const background = f.decode.mock.results[0].value as T.WebGLRenderTarget;
    const pmrem = f.convert.mock.results[0].value as T.WebGLRenderTarget;
    const failure = new Error('background disposal listener interrupted');
    vi.spyOn(background, 'dispose').mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => environment.dispose()).toThrow(failure);
    expect(() => environment.dispose()).not.toThrow();
    expect(f.targetDispose.mock.contexts.filter((target) => target === pmrem)).toHaveLength(1);
    const replacement = await loadEnvironment(f.renderer, 'quarry-02');
    expect(replacement.environment).not.toBe(environment.environment);
    expect(f.load).toHaveBeenCalledTimes(2);
    replacement.dispose();
  });
});
