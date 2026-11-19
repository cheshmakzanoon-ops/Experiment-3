import { expect, it, vi } from 'vitest';
import * as T from 'three';
import { WebGLPrograms } from 'three/src/renderers/webgl/WebGLPrograms.js';
import { WebGLCubeUVMaps } from 'three/src/renderers/webgl/WebGLCubeUVMaps.js';
import { ReflectionSystem } from '../src/rendering/reflections.ts';

/** Use the installed Three program cache, first-use metadata initializer and
 * actual cube-to-CubeUV consumer. The small renderer adapter connects those
 * owners; native GL calls are recorded, never executed by a browser/driver. */
function programHarness() {
  type NativeProgram = { id: number };
  type NativeShader = { type: number; source?: string };
  const created: NativeProgram[] = [],
    deleted: NativeProgram[] = [],
    queries: { kind: string; program?: NativeProgram; stage: string }[] = [];
  let stage = 'before-scene',
    retired = false,
    failCompile = false,
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
      const program = { id: created.length + 1 };
      created.push(program);
      return program;
    },
    createShader: (type: number) => ({ type }),
    shaderSource: (shader: NativeShader, source: string) => {
      shader.source = source;
    },
    compileShader: alive,
    attachShader: alive,
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
        const material = (object as T.Mesh).material;
        if (!material || Array.isArray(material)) return;
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
        if (failCompile && material.name === 'CubemapToCubeUV')
          throw new Error('Interrupted cube shader compilation');
      });
      return materials;
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
    created,
    deleted,
    queries,
    render: adapter.render,
    state,
    stage: (next: string) => {
      stage = next;
    },
    failCompile: (next: boolean) => {
      failCompile = next;
    },
    retire: () => {
      retired = true;
    },
  };
}

function linearTarget() {
  return new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType });
}

it('exposes the unprepared Three conversion issuing its first metadata queries after the scene', () => {
  const h = programHarness(),
    source = new T.WebGLCubeRenderTarget(256),
    maps = new WebGLCubeUVMaps(h.renderer);
  h.stage('after-six-faces');
  maps.get(source.texture);
  const conversion = h.cache.programs.find((program) => program.name === 'CubemapToCubeUV')!;
  expect(h.queries.filter((query) => query.program === conversion.program)).toEqual([
    { kind: 'program-log', program: conversion.program, stage: 'after-six-faces' },
  ]);
  maps.dispose();
  source.dispose();
});

it('reuses the exact installed Three conversion handle and first-use metadata before scene work', async () => {
  const h = programHarness(),
    reflection = new ReflectionSystem(),
    target = linearTarget(),
    previous = h.state();
  reflection.beginProbePreparation(h.renderer, target);
  expect(h.state()).toEqual(previous);
  expect(h.created).toHaveLength(1);
  expect(h.queries).toEqual([]);
  expect(h.render).not.toHaveBeenCalled();
  await Promise.resolve(); // The existing photographed-asset wait.
  reflection.completeProbePreparation();
  const warmed = h.cache.programs[0],
    handle = warmed.program;
  expect(warmed.usedTimes).toBe(1);
  expect(h.queries.map((query) => query.kind)).toEqual(['program-log', 'shader-log', 'shader-log']);
  const source = new T.WebGLCubeRenderTarget(256),
    maps = new WebGLCubeUVMaps(h.renderer);
  h.stage('after-six-faces');
  const atlas = maps.get(source.texture);
  expect(atlas.mapping).toBe(T.CubeUVReflectionMapping);
  const conversion = h.cache.programs.filter((program) => program.name === 'CubemapToCubeUV');
  expect(conversion).toEqual([warmed]);
  expect(conversion[0].program).toBe(handle);
  expect(warmed.usedTimes).toBe(2);
  expect(h.queries.filter((query) => query.program === handle)).toEqual([
    { kind: 'program-log', program: handle, stage: 'before-scene' },
  ]);
  reflection.dispose();
  expect(warmed.usedTimes).toBe(1);
  expect(h.deleted).not.toContain(handle);
  maps.dispose();
  expect(h.deleted.filter((program) => program === handle)).toHaveLength(1);
  source.dispose();
  target.dispose();
});

it('prepares once across repeated quality entry and selects its linear reference over a canvas variant', () => {
  const h = programHarness(),
    target = linearTarget();
  h.renderer.setRenderTarget(null);
  const canvasOwner = new T.PMREMGenerator(h.renderer);
  canvasOwner.compileCubemapShader();
  const canvasProgram = h.cache.programs[0];
  const reflection = new ReflectionSystem();
  reflection.beginProbePreparation(h.renderer, target);
  const linearProgram = h.cache.programs[1];
  expect(linearProgram.cacheKey).not.toBe(canvasProgram.cacheKey);
  // Cancelled High may retain a linked owner while Low does not consume it.
  // Re-entering High before metadata completion must acquire no extra ref.
  reflection.beginProbePreparation(h.renderer, target);
  expect(h.queries).toEqual([]);
  expect(linearProgram.usedTimes).toBe(1);
  reflection.completeProbePreparation();
  reflection.beginProbePreparation(h.renderer, target);
  reflection.completeProbePreparation();
  expect(h.created).toHaveLength(2);
  expect(linearProgram.usedTimes).toBe(1);
  expect(h.queries.filter((query) => query.kind === 'program-log')).toEqual([
    { kind: 'program-log', program: linearProgram.program, stage: 'before-scene' },
  ]);
  reflection.dispose();
  canvasOwner.dispose();
  target.dispose();
});

it('restores the exact target, face, mip, viewport and scissor after an interrupted compilation', () => {
  const h = programHarness(),
    reflection = new ReflectionSystem(),
    target = linearTarget(),
    previous = h.state();
  h.failCompile(true);
  expect(() => reflection.beginProbePreparation(h.renderer, target)).toThrow(
    'Interrupted cube shader compilation',
  );
  expect(h.state()).toEqual(previous);
  expect(h.cache.programs).toEqual([]);
  expect(h.deleted).toEqual(h.created);
  h.failCompile(false);
  reflection.beginProbePreparation(h.renderer, target);
  reflection.completeProbePreparation();
  reflection.dispose();
  target.dispose();
});

it('does no late work after disposal and gives a replacement renderer its own live program', async () => {
  const old = programHarness(),
    reflection = new ReflectionSystem(),
    target = linearTarget();
  reflection.beginProbePreparation(old.renderer, target);
  const pending = Promise.resolve().then(() => reflection.completeProbePreparation());
  reflection.dispose();
  old.retire();
  await pending;
  reflection.beginProbePreparation(old.renderer, target);
  expect(old.queries).toEqual([]);
  expect(old.deleted).toEqual(old.created);
  const next = programHarness(),
    replacement = new ReflectionSystem();
  replacement.beginProbePreparation(next.renderer, target);
  replacement.completeProbePreparation();
  expect(next.created).toHaveLength(1);
  expect(next.created[0]).not.toBe(old.created[0]);
  expect(next.queries.filter((query) => query.kind === 'program-log')).toHaveLength(1);
  expect(() => replacement.beginProbePreparation(old.renderer, target)).toThrow(
    'Reflection preparation belongs to another renderer',
  );
  replacement.dispose();
  target.dispose();
});
