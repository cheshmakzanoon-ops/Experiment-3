import * as T from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { PreparationTrace } from '../src/rendering/preparation.ts';
import { scannedGround } from '../src/rendering/ground/scan-store.ts';
import * as textureLoaders from '../src/rendering/assets/texture-loader.ts';
import { CAR_STRIDE, HEADER, H } from '../src/simulation/protocol.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

/** Run real preparation and disposal, substituting GPU services and model
 * builders. The scene owns real Three resources, but no authored content. */
function fixture(entrants = 2) {
  const events: string[] = [];
  const own = (name: string) => ({
    dispose: vi.fn(() => {
      events.push(`dispose:${name}`);
    }),
  });
  const renderer = Object.create(RacingRenderer.prototype) as RacingRenderer;
  const scene = new T.Scene();
  const sun = new T.DirectionalLight();
  const target = new T.WebGLRenderTarget(8, 8);
  const sceneTexture = new T.Texture();
  const sceneMaterial = new T.MeshBasicMaterial({ map: sceneTexture });
  const sceneGeometry = new T.BoxGeometry();
  scene.add(new T.Mesh(sceneGeometry, sceneMaterial), sun);
  const resources = [sceneGeometry, sceneMaterial, sceneTexture].map((resource) => {
    const disposed = vi.fn();
    resource.addEventListener('dispose', disposed);
    return { resource, disposed };
  });
  let bound: T.WebGLRenderTarget | null = null;
  const state = {
    disposed: false,
    scene,
    sun,
    preparation: new PreparationTrace(),
    preparationTimeoutMs: 50,
    showroomOnly: false,
    follow: 0,
    quality: 'medium',
    lighting: 'day',
    mode: 'pod',
    warmupFrames: 0,
    warmupPitPasses: 0,
    cars: [] as { root: T.Group; update: ReturnType<typeof vi.fn> }[],
    circuit: {
      track: { circuit: {} },
      setGrandPrixGrid: vi.fn(),
      setMotorcyclePresentation: vi.fn(),
      disposePlanting: vi.fn(),
      secondaryStands: own('secondaryStands'),
      wetReflection: own('wetReflection'),
      disposalMaterials: () => new Set<T.Material>(),
      stateTexture: own('stateTexture'),
    },
    renderer: {
      ...own('backend'),
      info: { programs: [] },
      properties: { get: () => ({}) },
      getRenderTarget: () => bound,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      getViewport: (v: T.Vector4) => v.set(0, 0, 64, 64),
      getScissor: (v: T.Vector4) => v.set(0, 0, 64, 64),
      getScissorTest: () => false,
      setRenderTarget: (value: T.WebGLRenderTarget | null) => {
        bound = value;
      },
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
      compileAsync: vi.fn(async () => {
        events.push('compile');
      }),
    },
    bikeShells: {
      disposeAll: vi.fn(),
      update: vi.fn(),
      warmFieldDetails: vi.fn((compile: () => Promise<unknown>) => compile()),
    },
    venueLighting: { update: vi.fn() },
    photoSky: { ...own('sky'), enabled: false, ready: vi.fn(async () => {}) },
    composer: {
      readBuffer: target,
      dispose: vi.fn(() => {
        target.dispose();
        events.push('dispose:composer');
      }),
    },
    gpuFrames: { ...own('fence'), ready: vi.fn(() => true), submittedFrame: vi.fn() },
    textures: own('textures'),
    gridPreparation: own('gridPreparation'),
    pitCrew: own('pitCrew'),
    gridPerformance: own('gridPerformance'),
    reflection: own('reflection'),
    shadowProxies: own('shadowProxies'),
    farShadow: own('farShadow'),
    gpuTimer: own('timer'),
    motionBlur: own('motionBlur'),
    exposure: own('exposure'),
    weatherPresentation: own('weather'),
    bloom: own('bloom'),
    fxaa: own('fxaa'),
    scenePass: own('scenePass'),
    grade: own('grade'),
    ultra: own('ultra'),
    environment: own('environment'),
    warmShadowCasters: vi.fn(() => {
      events.push('shadows');
      return false;
    }),
    warmPitPresentation: vi.fn(async () => {
      events.push('pit');
    }),
    draw: vi.fn(() => {
      events.push('draw');
    }),
    changeCamera: vi.fn((mode: string) => {
      Object.assign(renderer, { mode });
      events.push(`camera:${mode}`);
    }),
    reset: vi.fn(() => {
      events.push('reset');
    }),
    setCars: vi.fn((count: number) => {
      while (state.cars.length < count) state.cars.push({ root: new T.Group(), update: vi.fn() });
      events.push(`cars:${count}`);
    }),
  };
  Object.assign(renderer, state);
  const frame = new Float32Array(HEADER + entrants * CAR_STRIDE);
  frame[H.CARS] = entrants;
  const progress = vi.fn((label: string) => {
    events.push(`progress:${label}`);
  });
  const prepare = (yieldFrame = async () => {}) =>
    renderer.prepare(frame, progress, () => false, yieldFrame);
  return { renderer, state, events, frame, progress, prepare, resources };
}

beforeEach(() => {
  vi.spyOn(scannedGround, 'enabled', 'get').mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('circuit preparation ownership', () => {
  it('does no work when preparation is requested after terminal disposal', async () => {
    const h = fixture();
    h.renderer.dispose();
    const before = [...h.events];
    expect(await h.prepare()).toBe(false);
    expect(h.events).toEqual(before);
    expect(h.state.preparation.snapshot()).toBeNull();
  });

  it.each([
    'construction',
    'rider preparation',
    'sky',
    'ground',
    'compile',
    'shadow yield',
    'pit',
    'last compile',
  ] as const)('does not resume preparation after disposal during %s', async (stage) => {
    const h = fixture();
    const wait = deferred<void>();
    const reached = deferred<void>();
    let held = false;
    const pause = async () => {
      if (held) return;
      held = true;
      reached.resolve();
      await wait.promise;
    };
    let yields = 0;
    if (stage === 'rider preparation') {
      Object.assign(h.state.circuit, { offroad: { dispose: vi.fn() } });
      Object.assign(h.state.bikeShells, {
        prepareDirtField: async () => {
          await pause();
          return true;
        },
      });
    }
    if (stage === 'sky') {
      h.state.photoSky.enabled = true;
      h.state.photoSky.ready.mockImplementation(pause);
    }
    if (stage === 'ground') {
      vi.spyOn(scannedGround, 'enabled', 'get').mockReturnValue(true);
      vi.spyOn(scannedGround, 'ready').mockImplementation(async () => {
        await pause();
        return true;
      });
    }
    if (stage === 'compile') h.state.renderer.compileAsync.mockImplementation(pause);
    if (stage === 'pit') h.state.warmPitPresentation.mockImplementation(pause);
    if (stage === 'last compile') {
      let compiles = 0;
      h.state.renderer.compileAsync.mockImplementation(async () => {
        if (++compiles === 3) await pause();
      });
    }
    const pending = h.prepare(async () => {
      yields++;
      if ((stage === 'construction' && yields === 1) || (stage === 'shadow yield' && yields === 4))
        await pause();
    });
    await reached.promise;
    h.renderer.dispose();
    const before = [...h.events];
    wait.resolve();
    expect(await pending).toBe(false);
    expect(h.events).toEqual(before);
    expect(h.state.preparation.snapshot()?.status).toBe('cancelled');
    expect(h.state.renderer.dispose).toHaveBeenCalledOnce();
    for (const { disposed } of h.resources) expect(disposed).toHaveBeenCalledOnce();
  });

  it('retains successful warmup order and leaves the authoritative frame unchanged', async () => {
    const h = fixture();
    const before = h.frame.slice();
    expect(await h.prepare()).toBe(true);
    expect(h.frame).toEqual(before);
    expect(h.events.filter((event) => !event.startsWith('progress:'))).toEqual([
      'cars:1',
      'cars:2',
      'cars:2',
      'compile',
      'shadows',
      'camera:chase',
      'draw',
      'pit',
      'compile',
      'camera:cockpit',
      'draw',
      'compile',
      'camera:pod',
      'reset',
    ]);
    expect(h.state.preparation.snapshot()?.status).toBe('complete');
    expect(h.state.renderer.dispose).not.toHaveBeenCalled();
    h.renderer.dispose();
  });

  it('stops GPU-fence polling immediately when disposal occurs during a yield', async () => {
    const h = fixture();
    h.state.gpuFrames.ready.mockImplementation(() => {
      if (h.state.renderer.dispose.mock.calls.length) throw new Error('Dead GPU owner was polled');
      return false;
    });
    await expect(
      h.renderer.waitForPreparedFrame(
        () => false,
        async () => {
          h.renderer.dispose();
        },
      ),
    ).resolves.toBeUndefined();
    expect(h.state.gpuFrames.ready).toHaveBeenCalledOnce();
  });

  it('does not query a fence or warm crew resources after terminal disposal', async () => {
    const h = fixture();
    h.renderer.dispose();
    await h.renderer.waitForPreparedFrame(
      () => false,
      async () => {},
    );
    expect(h.state.gpuFrames.ready).not.toHaveBeenCalled();
    await RacingRenderer.prototype.warmPitPresentation.call(
      h.renderer,
      h.frame,
      () => false,
      async () => {},
    );
    expect(Reflect.get(h.renderer, 'warmupPitPasses')).toBe(0);
  });
});

describe('circuit teardown failure isolation', () => {
  it('reports asynchronous decoder cleanup failure without delaying independent disposal', async () => {
    const h = fixture();
    const error = new Error('Decoder pool shutdown failed');
    const cleanup = Promise.reject(error);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(textureLoaders, 'disposeTextureLoaders').mockReturnValue(cleanup);

    expect(() => h.renderer.dispose()).not.toThrow();
    expect(h.state.renderer.dispose).toHaveBeenCalledOnce();
    for (const { disposed } of h.resources) expect(disposed).toHaveBeenCalledOnce();
    await expect(cleanup).rejects.toBe(error);
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      'Circuit texture loader cleanup failed:',
      error,
    );
    h.renderer.dispose();
    expect(textureLoaders.disposeTextureLoaders).toHaveBeenCalledOnce();
  });

  it.each(['reflection', 'textures', 'pitCrew', 'gpuFrames', 'environment'] as const)(
    'releases remaining independent owners when %s fails',
    (name) => {
      const h = fixture();
      const error = new Error(`${name} disposal failed`);
      h.state[name].dispose.mockImplementation(() => {
        throw error;
      });
      expect(() => h.renderer.dispose()).toThrow(error);
      for (const [key, value] of Object.entries(h.state)) {
        if (
          value &&
          typeof value === 'object' &&
          'dispose' in value &&
          vi.isMockFunction(value.dispose)
        ) {
          expect(value.dispose, key).toHaveBeenCalledOnce();
        }
      }
      for (const { disposed } of h.resources) expect(disposed).toHaveBeenCalledOnce();
      expect(() => h.renderer.dispose()).not.toThrow();
      expect(h.state.renderer.dispose).toHaveBeenCalledOnce();
    },
  );

  it('preserves a non-Error first failure and still releases resources after later failures', () => {
    const h = fixture();
    h.state.reflection.dispose.mockImplementation(() => {
      throw undefined;
    });
    h.state.gpuFrames.dispose.mockImplementation(() => {
      throw new Error('later failure');
    });
    h.resources[0].resource.addEventListener('dispose', () => {
      throw new Error('geometry listener');
    });
    let caught = false;
    try {
      h.renderer.dispose();
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(h.state.renderer.dispose).toHaveBeenCalledOnce();
    for (const { disposed } of h.resources) expect(disposed).toHaveBeenCalledOnce();
  });
});
