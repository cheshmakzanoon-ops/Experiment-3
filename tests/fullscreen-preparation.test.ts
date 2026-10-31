import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { WebGLPrograms } from 'three/src/renderers/webgl/WebGLPrograms.js';
import { SceneAmbientPass } from '../src/rendering/scene-ambient-pass.ts';
import { compileFullscreenTargets } from '../src/rendering/fullscreen-preparation.ts';
import { waitForAllPrograms } from '../src/rendering/preparation.ts';

vi.mock('../src/rendering/preparation.ts', async (original) => ({
  ...(await original<typeof import('../src/rendering/preparation.ts')>()),
  waitForAllPrograms: vi.fn(),
}));

beforeEach(() => vi.mocked(waitForAllPrograms).mockReset().mockResolvedValue('complete'));

function harness() {
  const original = new T.WebGLRenderTarget(40, 20);
  let target: T.WebGLRenderTarget | null = original,
    face = 2,
    mip = 1;
  const viewport = new T.Vector4(1, 2, 30, 16),
    scissor = new T.Vector4(3, 4, 8, 9);
  let scissorTest = true,
    lost = false;
  const compile = vi.fn<T.WebGLRenderer['compile']>(() => new Set());
  const render = vi.fn();
  const renderer = {
    compile,
    render,
    getContext: () => ({ isContextLost: () => lost }),
    getRenderTarget: () => target,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    getViewport: (value: T.Vector4) => value.copy(viewport),
    getScissor: (value: T.Vector4) => value.copy(scissor),
    getScissorTest: () => scissorTest,
    setRenderTarget: (value: T.WebGLRenderTarget | null, nextFace = 0, nextMip = 0) => {
      target = value;
      face = nextFace;
      mip = nextMip;
      viewport.set(0, 0, 1, 1);
      scissor.set(0, 0, 1, 1);
      scissorTest = false;
    },
    setViewport: (value: T.Vector4) => viewport.copy(value),
    setScissor: (value: T.Vector4) => scissor.copy(value),
    setScissorTest: (value: boolean) => {
      scissorTest = value;
    },
  };
  return {
    renderer: renderer as unknown as T.WebGLRenderer,
    compile,
    render,
    target: () => target,
    lose: () => {
      lost = true;
    },
    restored: () => {
      expect(target).toBe(original);
      expect([face, mip]).toEqual([2, 1]);
      expect(viewport.toArray()).toEqual([1, 2, 30, 16]);
      expect(scissor.toArray()).toEqual([3, 4, 8, 9]);
      expect(scissorTest).toBe(true);
    },
    dispose: () => original.dispose(),
  };
}

describe('fullscreen compilation ownership', () => {
  it('borrows actual materials in an empty orthographic scene and restores before waiting', async () => {
    const h = harness();
    const material = new T.ShaderMaterial(),
      second = new T.ShaderMaterial();
    const target = new T.WebGLRenderTarget();
    const disposeMaterial = vi.fn(),
      disposeTarget = vi.fn(),
      disposeGeometry = vi.fn();
    material.addEventListener('dispose', disposeMaterial);
    second.addEventListener('dispose', disposeMaterial);
    target.addEventListener('dispose', disposeTarget);
    let geometry: T.BufferGeometry | undefined;
    let finish!: (status: 'complete') => void;
    vi.mocked(waitForAllPrograms).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const borrowed: T.Material[] = [];
    h.compile.mockImplementation((scene, camera) => {
      expect(scene).toBeInstanceOf(T.Scene);
      expect((scene as T.Scene).fog).toBeNull();
      expect((scene as T.Scene).environment).toBeNull();
      expect(camera).toBeInstanceOf(T.OrthographicCamera);
      const orthographic = camera as T.OrthographicCamera;
      expect([
        orthographic.left,
        orthographic.right,
        orthographic.top,
        orthographic.bottom,
        orthographic.near,
        orthographic.far,
      ]).toEqual([-1, 1, 1, -1, 0, 1]);
      expect(scene.children).toHaveLength(1);
      const mesh = scene.children[0] as T.Mesh;
      expect(mesh).toBeInstanceOf(T.Mesh);
      borrowed.push(mesh.material as T.Material);
      expect(h.target()).toBe(borrowed.length === 1 ? target : null);
      if (!geometry) {
        geometry = mesh.geometry;
        geometry.addEventListener('dispose', disposeGeometry);
      }
      expect(mesh.geometry).toBe(geometry);
      expect(Array.from(mesh.geometry.attributes.position.array)).toEqual([
        -1, 3, 0, -1, -1, 0, 3, -1, 0,
      ]);
      expect(Array.from(mesh.geometry.attributes.uv.array)).toEqual([0, 2, 0, 0, 2, 0]);
      return new Set([mesh.material as T.Material]);
    });
    const options = { initializeCaches: true, cancelled: () => false };
    const pending = compileFullscreenTargets(
      h.renderer,
      [
        { material, target },
        { material: second, target: null },
      ],
      options,
    );
    h.restored();
    expect(borrowed).toEqual([material, second]);
    expect(waitForAllPrograms).toHaveBeenCalledExactlyOnceWith(h.renderer, options);
    expect(h.render).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
    expect(disposeTarget).not.toHaveBeenCalled();
    finish('complete');
    await expect(pending).resolves.toBe('complete');
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    h.restored();
    material.dispose();
    second.dispose();
    target.dispose();
    h.dispose();
  });

  it('restores state and disposes only its geometry on synchronous compilation failure', async () => {
    const h = harness(),
      material = new T.ShaderMaterial(),
      target = new T.WebGLRenderTarget();
    const ownDispose = vi.fn(),
      borrowedDispose = vi.fn();
    material.addEventListener('dispose', borrowedDispose);
    target.addEventListener('dispose', borrowedDispose);
    h.compile.mockImplementation((scene) => {
      (scene.children[0] as T.Mesh).geometry.addEventListener('dispose', ownDispose);
      throw new Error('fullscreen compile failed');
    });
    await expect(compileFullscreenTargets(h.renderer, [{ material, target }], {})).rejects.toThrow(
      'fullscreen compile failed',
    );
    h.restored();
    expect(ownDispose).toHaveBeenCalledTimes(1);
    expect(borrowedDispose).not.toHaveBeenCalled();
    expect(waitForAllPrograms).not.toHaveBeenCalled();
    material.dispose();
    target.dispose();
    h.dispose();
  });

  it.each(['cancelled', 'failed'] as const)(
    'keeps restored state when readiness is %s',
    async (outcome) => {
      const h = harness(),
        material = new T.ShaderMaterial(),
        target = new T.WebGLRenderTarget();
      const disposed = vi.fn();
      h.compile.mockImplementation((scene) => {
        (scene.children[0] as T.Mesh).geometry.addEventListener('dispose', disposed);
        return new Set([material]);
      });
      if (outcome === 'cancelled') vi.mocked(waitForAllPrograms).mockResolvedValueOnce('cancelled');
      else vi.mocked(waitForAllPrograms).mockRejectedValueOnce(new Error('context lost'));
      const pending = compileFullscreenTargets(h.renderer, [{ material, target }], {});
      h.restored();
      if (outcome === 'cancelled') await expect(pending).resolves.toBe('cancelled');
      else await expect(pending).rejects.toThrow('context lost');
      expect(disposed).toHaveBeenCalledTimes(1);
      h.restored();
      material.dispose();
      target.dispose();
      h.dispose();
    },
  );

  it('stops before a second submission after context loss and still restores borrowed state', async () => {
    const h = harness(),
      material = new T.ShaderMaterial(),
      target = new T.WebGLRenderTarget();
    const ownDispose = vi.fn();
    h.compile.mockImplementationOnce((scene) => {
      (scene.children[0] as T.Mesh).geometry.addEventListener('dispose', ownDispose);
      h.lose();
      return new Set([material]);
    });
    await expect(
      compileFullscreenTargets(
        h.renderer,
        [
          { material, target },
          { material, target: null },
        ],
        {},
      ),
    ).rejects.toThrow('context lost');
    expect(h.compile).toHaveBeenCalledTimes(1);
    expect(waitForAllPrograms).not.toHaveBeenCalled();
    expect(ownDispose).toHaveBeenCalledTimes(1);
    h.restored();
    material.dispose();
    target.dispose();
    h.dispose();
  });

  it('bounds the plan to three active materials and makes an empty plan a no-op', async () => {
    const h = harness(),
      material = new T.ShaderMaterial();
    await expect(compileFullscreenTargets(h.renderer, [], {})).resolves.toBe('complete');
    await expect(
      compileFullscreenTargets(
        h.renderer,
        Array.from({ length: 4 }, () => ({ material, target: null })),
        {},
      ),
    ).rejects.toThrow('three materials');
    expect(h.compile).not.toHaveBeenCalled();
    expect(waitForAllPrograms).not.toHaveBeenCalled();
    h.restored();
    material.dispose();
    h.dispose();
  });

  it('starts no compilation for a cancelled owner', async () => {
    const h = harness(),
      material = new T.ShaderMaterial();
    await expect(
      compileFullscreenTargets(h.renderer, [{ material, target: null }], { cancelled: () => true }),
    ).resolves.toBe('cancelled');
    expect(h.compile).not.toHaveBeenCalled();
    expect(h.render).not.toHaveBeenCalled();
    h.restored();
    material.dispose();
    h.dispose();
  });
});

describe('actual scene-ambient fullscreen subjects', () => {
  it('selects AO/blur only when active and always preserves the actual composite output', () => {
    const pass = new SceneAmbientPass(new T.Scene(), new T.PerspectiveCamera());
    const output = new T.WebGLRenderTarget();
    const active = pass.compilationSubjects(output);
    expect(active).toHaveLength(3);
    expect(active.map((entry) => entry.material.name)).toEqual([
      'APEX scalable ambient obscurance',
      'APEX depth-aware obscurance blur',
      'APEX obscurance composite',
    ]);
    expect(active[0].target).not.toBe(output);
    expect(active[1].target).not.toBe(active[0].target);
    expect(active[2].target).toBe(output);
    pass.ambientOcclusion = false;
    const inactive = pass.compilationSubjects(output);
    expect(inactive).toHaveLength(1);
    expect(inactive[0].material).toBe(active[2].material);
    expect(inactive[0].target).toBe(output);
    // The caller resolves the current final destination, not stale composer flags.
    pass.renderToScreen = true;
    expect(pass.compilationSubjects(output)[0].target).toBe(output);
    expect(pass.compilationSubjects(null)[0].target).toBeNull();
    pass.enabled = false;
    expect(pass.compilationSubjects(output)).toEqual([]);
    pass.dispose();
    output.dispose();
  });

  it.each([0, 2, 4, 8])(
    'uses installed Three keys equivalent to a real fullscreen mesh at samples=%s',
    (samples) => {
      const pass = new SceneAmbientPass(new T.Scene(), new T.PerspectiveCamera(), samples);
      const output = new T.WebGLRenderTarget(64, 64, { type: T.HalfFloatType });
      let target: T.WebGLRenderTarget | null = output;
      const renderer = {
        getRenderTarget: () => target,
        state: { buffers: { depth: { getReversed: () => false } } },
        shadowMap: { enabled: true, type: T.PCFSoftShadowMap },
        outputColorSpace: T.SRGBColorSpace,
        toneMapping: T.ACESFilmicToneMapping,
      };
      // The pinned runtime takes cubeuvmaps too; its declaration lags.
      const cache = Reflect.construct(WebGLPrograms, [
        renderer,
        { get: (x: unknown) => x },
        { get: (x: unknown) => x },
        { has: () => true },
        { precision: 'highp', vertexTextures: true, logarithmicDepthBuffer: false },
        {},
        { numPlanes: 0, numIntersection: 0 },
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
      const empty = new T.Scene();
      // Actual Mesh-rendering fallback data shape from pinned WebGLRenderer.js.
      const meshContext = {
        background: null,
        fog: null,
        environment: null,
        overrideMaterial: null,
        isScene: true,
      } as unknown as T.Scene;
      const triangle = new T.BufferGeometry();
      triangle.setAttribute(
        'position',
        new T.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
      );
      triangle.setAttribute('uv', new T.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
      const subjects = pass.compilationSubjects(output);
      for (const subject of subjects) {
        const material = subject.material as T.ShaderMaterial,
          version = material.version;
        const defines = { ...material.defines },
          mesh = new T.Mesh(triangle, material);
        const key = (scene: T.Scene) =>
          cache.getProgramCacheKey(cache.getParameters(material, lights as never, [], scene, mesh));
        target = subject.target;
        const original = key(empty);
        expect(key(meshContext)).toBe(original);
        target = output;
        expect(key(empty)).toBe(original);
        expect(material.version).toBe(version);
        expect(material.defines).toEqual(defines);
        expect(pass.compilationSubjects(output).some((entry) => entry.material === material)).toBe(
          true,
        );
      }
      expect((subjects[0].material as T.ShaderMaterial).defines.GTAO_SLICES).toBe(
        samples >= 4 ? 3 : 2,
      );
      triangle.dispose();
      pass.dispose();
      output.dispose();
    },
  );
});
