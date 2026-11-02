import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { ProcessIncludes } from '@babylonjs/core/Engines/Processors/shaderProcessor.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import { MaterialPluginManager } from '@babylonjs/core/Materials/materialPluginManager.js';
import type { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { Skeleton } from '@babylonjs/core/Bones/skeleton.js';
import { MorphTargetManager } from '@babylonjs/core/Morph/morphTargetManager.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { PBRMaterialDefines } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial.js';
import type { Effect } from '@babylonjs/core/Materials/effect.js';
import { pbrVertexShader } from '@babylonjs/core/Shaders/pbr.vertex.js';
import {
  A09ClipOrderPlugin,
  A09_CLIP_ORDER_ANCHOR,
  assertA09ClipOrderShaderAnchors,
} from '../src/engine/babylon/braking-triplet-clip-order.ts';

const engines: NullEngine[] = [];
const originalShader = ShaderStore.ShadersStore[pbrVertexShader.name];
afterEach(() => {
  vi.restoreAllMocks();
  ShaderStore.ShadersStore[pbrVertexShader.name] = originalShader;
  for (const engine of engines.splice(0)) engine.dispose();
});
function setup(ubo = false) {
  const engine = new NullEngine();
  Object.defineProperty(engine, 'supportsUniformBuffers', { value: ubo });
  Object.defineProperty(engine, 'webGLVersion', { value: 2 });
  engines.push(engine);
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const camera = new FreeCamera('original camera', new Vector3(3, 2, -10), scene);
  camera.setTarget(Vector3.Zero());
  scene.activeCamera = camera;
  scene.setTransformMatrix(camera.getViewMatrix(), camera.getProjectionMatrix());
  const material = new PBRMaterial('owned A09 material', scene);
  const mesh = CreatePlane('owned world-baked A09 part', {}, scene);
  mesh.material = material;
  mesh.freezeWorldMatrix(Matrix.Identity());
  const plugin = new A09ClipOrderPlugin(material);
  plugin.registerOwnedMesh(mesh);
  return { engine, scene, camera, material, mesh, plugin };
}
function fakeEffect() {
  const writes: { name: string; values: number[] }[] = [];
  const setMatrix = vi.fn((name: string, matrix: Matrix) => {
    writes.push({ name, values: Array.from(matrix.m) });
  });
  const methods = new Map<PropertyKey, unknown>([['setMatrix', setMatrix]]);
  // CPU transport spy only: no shader compilation or GPU rendering is claimed.
  const effect = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (!methods.has(key)) methods.set(key, vi.fn());
        return methods.get(key);
      },
    },
  ) as Effect;
  return { effect, writes, setMatrix };
}

it('accepts only one pinned ordinary projection anchor and leaves the global shader untouched', () => {
  expect(
    JSON.parse(readFileSync('node_modules/@babylonjs/core/package.json', 'utf8')).version,
  ).toBe('9.33.1');
  expect(A09_CLIP_ORDER_ANCHOR).toBe('#else\ngl_Position=viewProjection*worldPos;\n#endif');
  expect(() => assertA09ClipOrderShaderAnchors()).not.toThrow();
  for (const source of [
    pbrVertexShader.shader.replace(A09_CLIP_ORDER_ANCHOR, ''),
    pbrVertexShader.shader + A09_CLIP_ORDER_ANCHOR,
    pbrVertexShader.shader.replace('#define CUSTOM_VERTEX_DEFINITIONS', ''),
    pbrVertexShader.shader.replace(
      '#ifdef MULTIVIEW\nif (gl_ViewID_OVR==0u)',
      '#ifdef UNKNOWN\nif (false)',
    ),
  ])
    expect(() => assertA09ClipOrderShaderAnchors(source)).toThrow();
  const h = setup();
  expect(h.plugin.getCustomCode('fragment')).toBeNull();
  const code = h.plugin.getCustomCode('vertex')!;
  const replacement = Object.entries(code).filter(([key]) => key.startsWith('!'));
  expect(replacement).toHaveLength(1);
  expect(replacement[0][1]).toBe(
    '#else\ngl_Position=a09OriginalProjection*(a09OriginalView*worldPos);\n#endif',
  );
  expect(pbrVertexShader.shader).toBe(originalShader);
  expect(ShaderStore.ShadersStore[pbrVertexShader.name]).toBe(originalShader);
  ShaderStore.ShadersStore[pbrVertexShader.name] += '\n// external mutation';
  expect(() => h.plugin.getCustomCode('vertex')).toThrow('global vertex shader replaced');
});

it.each([true, false])(
  'declares both ordinary matrix uniforms exactly once with UBO transport=%s',
  async (ubo) => {
    const h = setup(ubo),
      buffer = h.material._uniformBuffer;
    const add = vi.spyOn(buffer, 'addUniform');
    h.material.buildUniformLayout();
    expect(h.plugin.getUniforms()).toEqual({
      externalUniforms: ['a09OriginalView', 'a09OriginalProjection'],
    });
    expect(add.mock.calls.some(([name]) => name.startsWith('a09Original'))).toBe(false);
    const manager = h.material.pluginManager as unknown as {
      _uniformList: string[];
      _injectCustomCode(
        data: { indexParameters: Record<string, number> },
        existing: undefined,
      ): (type: string, code: string) => string;
    };
    for (const name of ['a09OriginalView', 'a09OriginalProjection'])
      expect(manager._uniformList.filter((uniform) => uniform === name)).toHaveLength(1);
    const expanded = await new Promise<string>((resolve) =>
      ProcessIncludes(
        pbrVertexShader.shader,
        {
          defines: [],
          indexParameters: { maxSimultaneousLights: 2 },
          isFragment: false,
          shouldUseHighPrecisionShader: true,
          supportsUniformBuffers: ubo,
          shadersRepository: '',
          includesShadersStore: ShaderStore.IncludesShadersStore,
          processor: null,
          version: '300',
          platformName: 'WEBGL2',
          processingContext: null,
          isNDCHalfZRange: false,
          useReverseDepthBuffer: false,
        },
        resolve,
      ),
    );
    const emitted = manager._injectCustomCode(
      { indexParameters: { maxSimultaneousLights: 2 } },
      undefined,
    )('vertex', expanded);
    for (const name of ['a09OriginalView', 'a09OriginalProjection']) {
      expect(emitted.match(new RegExp(`uniform mat4 ${name};`, 'g'))).toHaveLength(1);
      for (const block of emitted.matchAll(/uniform (?:Material|Scene|Mesh)\s*\{([\s\S]*?)\};/g))
        expect(block[1]).not.toContain(name);
    }
    expect(
      emitted.match(/gl_Position=a09OriginalProjection\*\(a09OriginalView\*worldPos\);/g),
    ).toHaveLength(1);
    expect(emitted).toContain('if (gl_ViewID_OVR==0u) {gl_Position=viewProjection*worldPos;}');
    expect(emitted.indexOf('gl_Position=a09OriginalProjection')).toBeLessThan(
      emitted.indexOf('vClipSpacePosition=gl_Position;'),
    );
    expect(ShaderStore.ShadersStore[pbrVertexShader.name]).toBe(originalShader);
  },
);

it('hard-binds current camera matrices before the actual cached PBR rebind decision on every draw', () => {
  const h = setup(),
    f = fakeEffect(),
    subMesh = h.mesh.subMeshes[0];
  subMesh.setEffect(f.effect, new PBRMaterialDefines());
  h.material.buildUniformLayout();
  h.material.freeze();
  const cached = h.scene as unknown as {
    _cachedMaterial: PBRMaterial;
    _cachedEffect: Effect;
    _cachedVisibility: number;
  };
  cached._cachedMaterial = h.material;
  cached._cachedEffect = f.effect;
  cached._cachedVisibility = 1;
  subMesh._drawWrapper._forceRebindOnNextCall = false;
  expect(h.scene.isCachedMaterialInvalid(h.material, f.effect, 1)).toBe(false);
  const events: string[] = [];
  const hard = h.plugin.hardBindForSubMesh.bind(h.plugin);
  vi.spyOn(h.plugin, 'hardBindForSubMesh').mockImplementation((...args) => {
    events.push('hard');
    hard(...args);
  });
  const internal = h.material as unknown as {
    _mustRebind(scene: Scene, effect: Effect, subMesh: SubMesh, visibility: number): boolean;
  };
  const must = internal._mustRebind.bind(h.material);
  vi.spyOn(internal, '_mustRebind').mockImplementation((...args) => {
    events.push('cached');
    const result = must(...args);
    expect(result).toBe(false);
    return result;
  });
  const firstView = Array.from(h.scene.getViewMatrix().m),
    firstProjection = Array.from(h.scene.getProjectionMatrix().m);
  h.material.bindForSubMesh(Matrix.Identity(), h.mesh, subMesh);
  expect(events).toEqual(['hard', 'cached']);
  const second = new FreeCamera('second current camera', new Vector3(-8, 7, 12), h.scene);
  second.fov = 0.6;
  second.setTarget(new Vector3(1, 2, 3));
  h.scene.activeCamera = second;
  h.scene.setTransformMatrix(second.getViewMatrix(), second.getProjectionMatrix());
  events.length = 0;
  h.material.bindForSubMesh(Matrix.Identity(), h.mesh, subMesh);
  expect(events).toEqual(['hard', 'cached']);
  const viewWrites = f.writes.filter((r) => r.name === 'a09OriginalView');
  const projectionWrites = f.writes.filter((r) => r.name === 'a09OriginalProjection');
  expect(viewWrites.map((r) => r.values)).toEqual([
    firstView,
    Array.from(h.scene.getViewMatrix().m),
  ]);
  expect(projectionWrites.map((r) => r.values)).toEqual([
    firstProjection,
    Array.from(h.scene.getProjectionMatrix().m),
  ]);
  expect(viewWrites[0].values).not.toEqual(viewWrites[1].values);
  expect(projectionWrites[0].values).not.toEqual(projectionWrites[1].values);
});

it.each([
  'MULTIVIEW',
  'INSTANCES',
  'THIN_INSTANCES',
  'NUM_BONE_INFLUENCERS',
  'NUM_MORPH_INFLUENCERS',
])('rejects unsupported compile variant %s', (key) => {
  const h = setup(),
    defines = new PBRMaterialDefines();
  Object.assign(defines, { [key]: key.startsWith('NUM_') ? 1 : true });
  expect(() => h.plugin.prepareDefines(defines, h.scene, h.mesh)).toThrow();
});
it.each([
  'parent',
  'world',
  'unfrozen',
  'instances',
  'thin-instances',
  'skeleton',
  'morph',
  'geometry',
  'material',
  'disposed',
])('rejects unsupported or changed owned mesh %s', (kind) => {
  const h = setup();
  if (kind === 'parent') h.mesh.parent = new TransformNode('external parent', h.scene);
  if (kind === 'world') h.mesh.freezeWorldMatrix(Matrix.Translation(1, 0, 0));
  if (kind === 'unfrozen') h.mesh.unfreezeWorldMatrix();
  if (kind === 'instances') {
    h.mesh.createInstance('unsupported instance');
    expect(h.mesh.hasInstances).toBe(true);
  }
  if (kind === 'thin-instances') {
    // CPU capability seam only, not hardware instancing qualification.
    h.engine.getCaps().instancedArrays = true;
    expect(h.mesh.thinInstanceAdd(Matrix.Identity())).toBe(0);
    expect(h.mesh.hasThinInstances).toBe(true);
  }
  if (kind === 'skeleton') h.mesh.skeleton = new Skeleton('unsupported bones', 'bones', h.scene);
  if (kind === 'morph') h.mesh.morphTargetManager = new MorphTargetManager(h.scene);
  if (kind === 'geometry') h.mesh.geometry!.copy('replacement').applyToMesh(h.mesh);
  if (kind === 'material') h.mesh.material = new PBRMaterial('foreign material', h.scene);
  if (kind === 'disposed') h.mesh.dispose();
  expect(() => h.plugin.prepareDefines(new PBRMaterialDefines(), h.scene, h.mesh)).toThrow();
});
it('rejects unregistered, duplicate and invalidated bindings without writing effect matrices', () => {
  const h = setup(),
    f = fakeEffect(),
    other = CreatePlane('unowned', {}, h.scene);
  other.material = h.material;
  other.freezeWorldMatrix(Matrix.Identity());
  other.subMeshes[0].setEffect(f.effect, new PBRMaterialDefines());
  expect(() =>
    h.plugin.hardBindForSubMesh(h.material._uniformBuffer, h.scene, h.engine, other.subMeshes[0]),
  ).toThrow();
  expect(f.setMatrix).not.toHaveBeenCalled();
  expect(() => h.plugin.registerOwnedMesh(h.mesh)).toThrow();
  h.plugin.invalidate();
  expect(h.plugin.isValid).toBe(false);
  expect(() => h.plugin.registerOwnedMesh(other)).toThrow();
  expect(() => h.plugin.prepareDefines(new PBRMaterialDefines(), h.scene, h.mesh)).toThrow();
  expect(() => h.plugin.dispose()).not.toThrow();
});
it('rejects WGSL and invalid draw camera/effect/scene ownership', () => {
  const h = setup();
  const unsupported = new PBRMaterial('WGSL', h.scene);
  Object.defineProperty(unsupported, 'shaderLanguage', { value: 1 });
  expect(() => new A09ClipOrderPlugin(unsupported)).toThrow('GLSL');
  const subMesh = h.mesh.subMeshes[0],
    f = fakeEffect();
  expect(() =>
    h.plugin.hardBindForSubMesh(h.material._uniformBuffer, h.scene, h.engine, subMesh),
  ).toThrow();
  subMesh.setEffect(f.effect, new PBRMaterialDefines());
  h.scene.activeCamera = null;
  expect(() =>
    h.plugin.hardBindForSubMesh(h.material._uniformBuffer, h.scene, h.engine, subMesh),
  ).toThrow();
  h.scene.activeCamera = h.camera;
  h.camera.cameraRigMode = 10;
  expect(() =>
    h.plugin.hardBindForSubMesh(h.material._uniformBuffer, h.scene, h.engine, subMesh),
  ).toThrow();
  h.camera.cameraRigMode = 0;
  const other = new Scene(h.engine);
  expect(() =>
    h.plugin.hardBindForSubMesh(h.material._uniformBuffer, other, h.engine, subMesh),
  ).toThrow();
  other.dispose();
  expect(f.setMatrix).not.toHaveBeenCalled();
});

it.each([undefined, null, false])(
  'finishes native material cleanup after a partially registered plugin constructor throws %s',
  (primary) => {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine),
      material = new PBRMaterial('partial plugin owner', scene);
    const disposed = vi.fn();
    material.onDisposeObservable.add(disposed);
    const release = vi.spyOn(material._uniformBuffer, 'dispose');
    const manager = MaterialPluginManager.prototype as unknown as {
      _addPlugin(plugin: MaterialPluginBase): boolean;
    };
    const original = manager._addPlugin;
    let captured: A09ClipOrderPlugin | undefined;
    vi.spyOn(manager, '_addPlugin').mockImplementation(function (
      this: MaterialPluginManager,
      plugin,
    ) {
      const result = original.call(this, plugin);
      if (plugin.name === 'OriginalA09ClipOrder') {
        captured = plugin as A09ClipOrderPlugin;
        throw primary;
      }
      return result;
    });
    let failed = false,
      error: unknown;
    try {
      new A09ClipOrderPlugin(material);
    } catch (caught) {
      failed = true;
      error = caught;
    }
    expect(failed).toBe(true);
    expect(error).toBe(primary);
    expect(captured).toBeDefined();
    expect(material.pluginManager!.getPlugin('OriginalA09ClipOrder')).toBe(captured);
    expect(() => material.dispose()).not.toThrow();
    expect(captured!.isValid).toBe(false);
    expect(release).toHaveBeenCalledOnce();
    expect(disposed).toHaveBeenCalledOnce();
    expect(scene.materials).not.toContain(material);
  },
);
