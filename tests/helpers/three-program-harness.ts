import { vi } from 'vitest';
import * as T from 'three';
import { WebGLPrograms } from 'three/src/renderers/webgl/WebGLPrograms.js';

/** Use the installed Three program cache, first-use metadata initializer and
 * actual cube-to-CubeUV consumer. The small renderer adapter connects those
 * owners; native GL calls are recorded, never executed by a browser/driver. */
export function programHarness() {
  type NativeShader = { type: number; source?: string };
  type NativeProgram = { id: number; shaders: NativeShader[] };
  const created: NativeProgram[] = [],
    deleted: NativeProgram[] = [],
    queries: { kind: string; program?: NativeProgram; stage: string }[] = [];
  let stage = 'before-scene',
    retired = false,
    failCompile: string | null = null,
    target: T.WebGLRenderTarget | null = new T.WebGLCubeRenderTarget(32),
    face = 3,
    mip = 2,
    scissorTest = true;
  const viewport = new T.Vector4(11, 13, 17, 19),
    scissor = new T.Vector4(23, 29, 31, 37);
  const alive = () => {
    if (retired) throw new Error('Native work after renderer retirement');
  };
  const gl = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    LINK_STATUS: 35714,
    ACTIVE_UNIFORMS: 35718,
    ACTIVE_ATTRIBUTES: 35721,
    createProgram: () => {
      alive();
      const program = { id: created.length + 1, shaders: [] };
      created.push(program);
      return program;
    },
    createShader: (type: number) => ({ type }),
    shaderSource: (shader: NativeShader, source: string) => {
      shader.source = source;
    },
    compileShader: alive,
    attachShader: (program: NativeProgram, shader: NativeShader) => {
      alive();
      program.shaders.push(shader);
    },
    linkProgram: alive,
    getProgramInfoLog: (program: NativeProgram) => {
      alive();
      queries.push({ kind: 'program-log', program, stage });
      return '';
    },
    getShaderInfoLog: () => {
      alive();
      queries.push({ kind: 'shader-log', stage });
      return '';
    },
    getProgramParameter: (_program: NativeProgram, parameter: number) =>
      parameter === 35714 ? true : 0,
    deleteShader: alive,
    deleteProgram: (program: NativeProgram) => {
      alive();
      deleted.push(program);
    },
  };
  const owners = new Map<T.Material, Map<string, T.WebGLProgram>>();
  const lights = Object.fromEntries(
    [
      'directional',
      'point',
      'spot',
      'spotLightMap',
      'rectArea',
      'hemi',
      'directionalShadowMap',
      'pointShadowMap',
      'spotShadowMap',
    ].map((name) => [name, []]),
  ) as unknown as Parameters<WebGLPrograms['getParameters']>[1];
  lights.numSpotLightShadowsWithMaps = 0;
  lights.numLightProbes = 0;
  const scene = new T.Scene();
  const adapter = {
    xr: { enabled: true },
    autoClear: true,
    debug: { checkShaderErrors: true },
    state: { buffers: { depth: { getReversed: () => false } } },
    shadowMap: { enabled: true, type: T.PCFSoftShadowMap },
    outputColorSpace: T.SRGBColorSpace,
    toneMapping: T.ACESFilmicToneMapping,
    info: { programs: [] as T.WebGLProgram[] },
    getContext: () => gl,
    getClearColor: (out: T.Color) => out.set(0),
    properties: {
      get: (material: T.Material) => ({ programs: owners.get(material) }),
    },
    getRenderTarget: () => target,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    getViewport: (out: T.Vector4) => out.copy(viewport),
    getScissor: (out: T.Vector4) => out.copy(scissor),
    getScissorTest: () => scissorTest,
    setRenderTarget: (next: T.WebGLRenderTarget | null, cubeFace = 0, mipLevel = 0) => {
      target = next;
      face = cubeFace;
      mip = mipLevel;
      if (next) {
        viewport.copy(next.viewport);
        scissor.copy(next.scissor);
        scissorTest = next.scissorTest;
      }
    },
    setViewport: (next: T.Vector4) => viewport.copy(next),
    setScissor: (next: T.Vector4) => scissor.copy(next),
    setScissorTest: (next: boolean) => {
      scissorTest = next;
    },
    compile: (root: T.Object3D) => {
      alive();
      const materials = new Set<T.Material>();
      root.traverse((object) => {
        const assigned = (object as T.Mesh).material;
        if (!assigned) return;
        for (const material of Array.isArray(assigned) ? assigned : [assigned]) {
          let programs = owners.get(material);
          if (!programs) {
            programs = new Map();
            owners.set(material, programs);
            material.addEventListener('dispose', () => {
              for (const program of owners.get(material)?.values() ?? [])
                cache.releaseProgram(program);
              owners.delete(material);
            });
          }
          const parameters = cache.getParameters(material, lights, [], scene, object),
            key = cache.getProgramCacheKey(parameters);
          if (!programs.has(key))
            programs.set(
              key,
              cache.acquireProgram({ ...parameters, uniforms: cache.getUniforms(material) }, key),
            );
          materials.add(material);
          if (material.name === failCompile)
            throw new Error(`Interrupted ${failCompile} compilation`);
        }
      });
      return materials;
    },
    compileAsync: (root: T.Object3D) => {
      adapter.compile(root);
      return Promise.resolve(root);
    },
    render: vi.fn((root: T.Object3D) => {
      for (const material of adapter.compile(root))
        for (const program of owners.get(material)!.values()) {
          program.getUniforms();
          program.getAttributes();
        }
    }),
  };
  const renderer = adapter as unknown as T.WebGLRenderer,
    maps = { get: (texture: T.Texture | null) => texture };
  // r180 takes a separate cubeUV map argument; the installed declarations
  // still omit it. Preserve the runtime signature rather than shift owners.
  const cache = Reflect.construct(WebGLPrograms, [
    renderer,
    maps,
    maps,
    { has: () => false },
    {
      vertexTextures: true,
      precision: 'highp',
      getMaxPrecision: (precision: string) => precision,
      logarithmicDepthBuffer: false,
    },
    { releaseStatesOfProgram: () => {} },
    { numPlanes: 0, numIntersection: 0 },
  ]) as WebGLPrograms;
  adapter.info.programs = cache.programs;
  const state = () => ({
    target,
    face,
    mip,
    viewport: viewport.toArray(),
    scissor: scissor.toArray(),
    scissorTest,
  });
  return {
    renderer,
    cache,
    owners,
    created,
    deleted,
    queries,
    render: adapter.render,
    state,
    stage: (next: string) => {
      stage = next;
    },
    failCompile: (next: string | null) => {
      failCompile = next;
    },
    retire: () => {
      retired = true;
    },
  };
}
