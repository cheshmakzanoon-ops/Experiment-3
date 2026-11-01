import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { PBRMaterialDefines } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import {
  MaterialPluginEvent,
  type MaterialPluginGetDefineNames,
} from '@babylonjs/core/Materials/materialPluginEvent.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { bumpFragment } from '@babylonjs/core/Shaders/ShadersInclude/bumpFragment.js';
import { pbrBlockAlbedoOpacity } from '@babylonjs/core/Shaders/ShadersInclude/pbrBlockAlbedoOpacity.js';
import { pbrBlockReflectivity } from '@babylonjs/core/Shaders/ShadersInclude/pbrBlockReflectivity.js';
import { pbrPixelShader } from '@babylonjs/core/Shaders/pbr.fragment.js';
import { pbrVertexShader } from '@babylonjs/core/Shaders/pbr.vertex.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { createAsphaltSubstrate } from '../src/engine/babylon/asphalt-substrate.ts';
import {
  AsphaltSubstratePlugin,
  assertAsphaltShaderAnchors,
  ASPHALT_NORMAL_ANCHOR,
} from '../src/engine/babylon/asphalt-substrate-plugin.ts';
import { arrayBytes, oracle, sha256 } from './fixtures/asphalt-source-oracle.ts';
import { AsphaltFactorOutput } from '../e2e/fixtures/babylon-asphalt-parity.ts';

const engines: NullEngine[] = [];
function setup() {
  const engine = new NullEngine();
  engines.push(engine);
  // Explicit capability simulation for ownership/source tests, NOT GPU proof.
  Object.defineProperty(engine, 'webGLVersion', { value: 2 });
  Object.assign(engine.getCaps(), { supportSRGBBuffers: true, standardDerivatives: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const infrastructure = new PBRMaterial('scene-owned-brdf', scene);
  infrastructure.dispose();
  return { engine, scene };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const engine of engines.splice(0)) engine.dispose();
});
const counts = (scene: Scene) => ({
  materials: scene.materials.length,
  textures: scene.textures.length,
});
function mesh(scene: Scene) {
  const m = new Mesh('source-derivative-plane', scene),
    v = new VertexData();
  v.positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
  v.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  v.uvs = [-0.2, -0.2, 0.2, -0.2, 0.2, 0.2, -0.2, 0.2];
  v.indices = [0, 2, 1, 0, 3, 2];
  v.applyToMesh(m);
  return m;
}
function key(m: PBRMaterial) {
  const info: MaterialPluginGetDefineNames = { defineNames: {} };
  m._callbackPluginEventGeneric(MaterialPluginEvent.GetDefineNames, info);
  return new PBRMaterialDefines(info.defineNames).toString();
}
class Output extends MaterialPluginBase {
  constructor(m: PBRMaterial) {
    super(m, 'asphalt-test-output', 300, { ASPHALT_TEST_OUTPUT: true }, true, true);
  }
  getClassName() {
    return 'AsphaltTestOutput';
  }
  getCustomCode(type: string) {
    return type === 'fragment'
      ? { CUSTOM_FRAGMENT_MAIN_END: 'gl_FragColor=vec4(normalW,1.0);' }
      : null;
  }
}

describe('isolated asphalt owner (NullEngine/source contracts, not GPU evidence)', () => {
  it('allocates exactly three original textures once and shares them across chunk meshes', () => {
    const { scene } = setup(),
      before = counts(scene),
      owner = createAsphaltSubstrate(scene);
    const saved = oracle.cases.find((c) => c.name === 'asphalt-512-1887')!;
    expect(counts(scene)).toEqual({
      materials: before.materials + 1,
      textures: before.textures + 3,
    });
    const { albedo, data, normal } = owner.textures;
    for (const [texture, expected, srgb] of [
      [albedo, saved.arrays.albedo, true],
      [data, saved.arrays.roughness, false],
      [normal, saved.normal, false],
    ] as const) {
      const internal = texture.getInternalTexture()!;
      expect(sha256(arrayBytes(internal._bufferView!))).toBe(expected.sha256);
      expect(internal._useSRGBBuffer).toBe(srgb);
      expect(texture.gammaSpace).toBe(false);
      expect(texture.getSize()).toEqual({ width: 512, height: 512 });
      expect(texture.wrapU).toBe(Texture.WRAP_ADDRESSMODE);
      expect(texture.wrapV).toBe(Texture.WRAP_ADDRESSMODE);
      expect(texture.uScale).toBe(7.8125);
      expect(texture.vScale).toBe(7.8125);
      expect(texture.samplingMode).toBe(Texture.TRILINEAR_SAMPLINGMODE);
      expect(internal.generateMipMaps).toBe(true);
      expect(internal.invertY).toBe(true);
      expect(texture.anisotropicFilteringLevel).toBe(8);
    }
    const chunks = [mesh(scene), mesh(scene)];
    chunks.forEach((m) => (m.material = owner.material));
    expect(new Set(chunks.map((m) => m.material)).size).toBe(1);
    expect(counts(scene)).toEqual({
      materials: before.materials + 1,
      textures: before.textures + 3,
    });
    expect(owner.material.getActiveTextures()).toEqual(
      expect.arrayContaining([albedo, data, normal]),
    );
    expect(owner.material.metallicTexture).toBeNull();
    chunks.forEach((m) => m.dispose());
    owner.dispose();
    owner.dispose();
    expect(counts(scene)).toEqual(before);
  });
  for (const ending of ['owner', 'material', 'scene'] as const)
    it(`releases each authored resource exactly once on ${ending} disposal`, () => {
      const { scene } = setup(),
        owner = createAsphaltSubstrate(scene);
      const calls = Object.values(owner.textures).map((t) => {
        const f = vi.fn();
        t.onDisposeObservable.add(f);
        return f;
      });
      if (ending === 'owner') owner.dispose();
      else if (ending === 'material') owner.material.dispose(false, false);
      else scene.dispose();
      owner.dispose();
      expect(owner.isValid).toBe(false);
      calls.forEach((f) => expect(f).toHaveBeenCalledTimes(1));
    });
  it('cleans even a texture constructor that registers a resource then throws, retaining the original failure', () => {
    const { scene } = setup(),
      before = counts(scene),
      original = RawTexture.CreateRGBATexture;
    let calls = 0;
    const failure = new Error('original upload failure');
    vi.spyOn(RawTexture, 'CreateRGBATexture').mockImplementation((...args) => {
      const texture = original(...args);
      if (++calls === 2) throw failure;
      return texture;
    });
    expect(() => createAsphaltSubstrate(scene)).toThrow(failure);
    expect(counts(scene)).toEqual(before);
  });
  it('rejects capability/context failures before allocating and never substitutes a reduced-quality path', () => {
    const { scene, engine } = setup(),
      before = counts(scene);
    engine.getCaps().supportSRGBBuffers = false;
    expect(() => createAsphaltSubstrate(scene)).toThrow('WebGL2/sRGB');
    expect(counts(scene)).toEqual(before);
    engine.getCaps().supportSRGBBuffers = true;
    scene.useRightHandedSystem = false;
    expect(() => createAsphaltSubstrate(scene)).toThrow();
    expect(counts(scene)).toEqual(before);
  });
  it('invalidates permanently on real-owner context loss; restoration alone cannot rearm', () => {
    const { scene, engine } = setup(),
      owner = createAsphaltSubstrate(scene),
      m = mesh(scene);
    m.material = owner.material;
    expect(owner.isValid).toBe(true);
    engine.onContextLostObservable.notifyObservers(engine);
    expect(owner.isValid).toBe(false);
    engine.onContextRestoredObservable.notifyObservers(engine);
    expect(owner.isValid).toBe(false);
    expect(
      owner.plugin.isReadyForSubMesh(new PBRMaterialDefines(), scene, engine, m.subMeshes[0]),
    ).toBe(false);
    owner.dispose();
    m.dispose();
  });
  it('fails closed for non-source material and tangent/UV configurations', () => {
    const { scene, engine } = setup(),
      owner = createAsphaltSubstrate(scene),
      m = mesh(scene);
    m.material = owner.material;
    const ready = () =>
      owner.plugin.isReadyForSubMesh(new PBRMaterialDefines(), scene, engine, m.subMeshes[0]);
    owner.material.useParallax = true;
    expect(ready).toThrow('sampling contract');
    owner.material.useParallax = false;
    owner.textures.normal.level = 0.5;
    expect(ready).toThrow('transform/level');
    owner.textures.normal.level = 0.75;
    owner.textures.data.wrapU = Texture.CLAMP_ADDRESSMODE;
    expect(ready).toThrow('transform/level');
    owner.textures.data.wrapU = Texture.WRAP_ADDRESSMODE;
    owner.textures.normal.getInternalTexture()!.invertY = false;
    expect(ready).toThrow('transform/level');
    owner.textures.normal.getInternalTexture()!.invertY = true;
    m.setVerticesData('tangent', new Float32Array(16), false, 4);
    expect(ready).toThrow('derivative-frame');
    owner.dispose();
    m.dispose();
  });
  it('rejects active vertex colours but accepts disabled colour data without changing the mesh', () => {
    const { scene, engine } = setup(),
      owner = createAsphaltSubstrate(scene),
      m = mesh(scene);
    m.material = owner.material;
    const colors = new Float32Array([
      0.2, 0.3, 0.4, 1, 0.4, 0.5, 0.6, 1, 0.6, 0.7, 0.8, 1, 0.8, 0.9, 1, 1,
    ]);
    m.setVerticesData('color', colors, false, 4);
    const buffer = m.getVertexBuffer('color'),
      saved = Float32Array.from(m.getVerticesData('color')!);
    const ready = () =>
      owner.plugin.isReadyForSubMesh(new PBRMaterialDefines(), scene, engine, m.subMeshes[0]);
    // NullEngine does not establish actual raw-texture GPU readiness. Exercise
    // geometry acceptance independently while retaining both readiness outcomes.
    const textureReady = vi.spyOn(owner.textures.data, 'isReady').mockReturnValue(true);
    m.useVertexColors = true;
    expect(ready).toThrow('geometry contract');
    expect(textureReady).not.toHaveBeenCalled();
    expect(m.useVertexColors).toBe(true);
    expect(m.getVertexBuffer('color')).toBe(buffer);
    expect(m.getVerticesData('color')).toEqual(saved);
    m.useVertexColors = false;
    expect(ready()).toBe(true);
    textureReady.mockReturnValue(false);
    expect(ready()).toBe(false);
    expect(textureReady).toHaveBeenCalledTimes(2);
    expect(m.useVertexColors).toBe(false);
    expect(m.getVertexBuffer('color')).toBe(buffer);
    expect(m.getVerticesData('color')).toEqual(saved);
    owner.dispose();
    m.dispose();
  });
});
it('pins unique tangent-branch anchors and rejects missing/ambiguous/replaced global shaders', () => {
  assertAsphaltShaderAnchors();
  const source = {
    bump: bumpFragment.shader,
    albedo: pbrBlockAlbedoOpacity.shader,
    roughness: pbrBlockReflectivity.shader,
    fragment: pbrPixelShader.shader,
    vertex: pbrVertexShader.shader,
  };
  expect(() =>
    assertAsphaltShaderAnchors({ ...source, bump: source.bump.replace(ASPHALT_NORMAL_ANCHOR, '') }),
  ).toThrow();
  expect(() =>
    assertAsphaltShaderAnchors({ ...source, bump: source.bump + ASPHALT_NORMAL_ANCHOR }),
  ).toThrow();
  const saved = ShaderStore.IncludesShadersStore.bumpFragment;
  try {
    ShaderStore.IncludesShadersStore.bumpFragment = saved + '\n// changed';
    expect(() => assertAsphaltShaderAnchors()).toThrow('global shader');
  } finally {
    ShaderStore.IncludesShadersStore.bumpFragment = saved;
  }
});
it('preserves persistent source/rounded-mean cache identity with later output plugins in both orders', () => {
  const { scene } = setup(),
    owner = createAsphaltSubstrate(scene);
  new Output(owner.material);
  const plain = new PBRMaterial('plain', scene);
  new Output(plain);
  expect(key(owner.material)).toContain('ORIGINAL_ASPHALT_SUBSTRATE_V1');
  expect(key(plain)).not.toContain('ORIGINAL_ASPHALT_SUBSTRATE_V1');
  const reversed = new PBRMaterial('reversed', scene);
  new Output(reversed);
  const other = new AsphaltSubstratePlugin(reversed, owner.textures.data, {
    albedo: [0.1, 0.11, 0.12],
    roughness: 0.8,
  });
  expect(key(reversed)).toContain('ORIGINAL_ASPHALT_SUBSTRATE_V1');
  expect(key(reversed)).not.toBe(key(owner.material));
  const before = key(reversed);
  other.dispose();
  expect(key(reversed)).toBe(before);
  const code = owner.plugin.getCustomCode('fragment')!;
  expect(code.CUSTOM_FRAGMENT_UPDATE_ALBEDO).toContain('0.09685, 0.09461, 0.09022');
  expect(code.CUSTOM_FRAGMENT_UPDATE_ALBEDO.indexOf('pow(')).toBeLessThan(
    code.CUSTOM_FRAGMENT_UPDATE_ALBEDO.indexOf('float broad='),
  );
  expect(code.CUSTOM_FRAGMENT_DEFINITIONS).toContain('0.26548');
  expect(Object.values(code).join('\n')).not.toContain('CUSTOM_FRAGMENT_BUMP_FRAGMENT');
  expect(owner.plugin.getUniforms().ubo).toEqual([
    { name: 'asphaltSubstrateView', size: 16, type: 'mat4' },
  ]);
  owner.dispose();
  reversed.dispose();
  plain.dispose();
});
it('rejects global shader replacement after installation, before effect injection', () => {
  const { scene } = setup(),
    owner = createAsphaltSubstrate(scene);
  for (const [store, name] of [
    [ShaderStore.IncludesShadersStore, bumpFragment.name],
    [ShaderStore.ShadersStore, pbrPixelShader.name],
  ] as const) {
    const original = store[name];
    try {
      store[name] = original + '\n// replaced after plugin installation';
      expect(() => owner.plugin.getCustomCode('vertex')).toThrow('global shader');
      expect(() => owner.plugin.getCustomCode('fragment')).toThrow('global shader');
    } finally {
      store[name] = original;
    }
  }
  expect(owner.plugin.getCustomCode('fragment')).not.toBeNull();
  owner.dispose();
});
it('observes actual native roughness after the substrate assignment and before the renderer clamp', () => {
  const { scene } = setup(),
    owner = createAsphaltSubstrate(scene);
  const output = new AsphaltFactorOutput(owner.material);
  expect(owner.plugin.priority).toBe(200);
  expect(output.priority).toBe(300);
  // Exercise the pinned real manager's composition, not a hand-concatenated
  // imitation. This source contract is not a claim of driver compilation.
  const manager = owner.material.pluginManager as unknown as {
    _injectCustomCode(
      data: { indexParameters: Record<string, number> },
      existing: undefined,
    ): (type: string, code: string) => string;
  };
  const composed = manager._injectCustomCode({ indexParameters: {} }, undefined)(
    'fragment',
    pbrBlockReflectivity.shader,
  );
  const assignment = composed.indexOf('metallicRoughness.g=asphaltSubstrateRoughness;');
  const capture = composed.indexOf('asphaltProbeRoughness=metallicRoughness.g;');
  const conversion = composed.indexOf('microSurface=1.0-metallicRoughness.g;');
  const clamp = composed.indexOf('microSurface=saturate(microSurface);');
  expect(assignment).toBeGreaterThanOrEqual(0);
  expect(capture).toBeGreaterThan(assignment);
  expect(conversion).toBeGreaterThan(capture);
  expect(clamp).toBeGreaterThan(conversion);
  const code = output.getCustomCode('fragment')!;
  expect(code.CUSTOM_FRAGMENT_MAIN_END).toContain('vec3(asphaltProbeRoughness*.5)');
  expect(code.CUSTOM_FRAGMENT_MAIN_END).not.toContain('asphaltSubstrateRoughness');
  owner.dispose();
});
