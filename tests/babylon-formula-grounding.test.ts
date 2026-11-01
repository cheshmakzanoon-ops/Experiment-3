import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { PBRMaterialDefines } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial.js';
import {
  MaterialPluginEvent,
  type MaterialPluginGetDefineNames,
} from '@babylonjs/core/Materials/materialPluginEvent.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { ProcessIncludes } from '@babylonjs/core/Engines/Processors/shaderProcessor.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { pbrVertexShader } from '@babylonjs/core/Shaders/pbr.vertex.js';
import { pbrPixelShader } from '@babylonjs/core/Shaders/pbr.fragment.js';
import { lightFragment } from '@babylonjs/core/Shaders/ShadersInclude/lightFragment.js';
import { pbrBlockFinalLitComponents } from '@babylonjs/core/Shaders/ShadersInclude/pbrBlockFinalLitComponents.js';
import { pbrBlockFinalUnlitComponents } from '@babylonjs/core/Shaders/ShadersInclude/pbrBlockFinalUnlitComponents.js';
import { pbrBlockAmbientOcclusion } from '@babylonjs/core/Shaders/ShadersInclude/pbrBlockAmbientOcclusion.js';
import {
  FormulaGroundingPoses,
  FormulaGroundingPlugin,
  FORMULA_GROUNDING_GLSL,
  assertFormulaGroundingAnchors,
} from '../src/engine/babylon/formula-grounding.ts';
import { CircuitPaintFinishPlugin } from '../src/engine/babylon/circuit-paint-finish.ts';
import { groundingOracle } from './fixtures/formula-grounding-oracle.ts';
const engines: NullEngine[] = [];
function setup() {
  const engine = new NullEngine();
  engines.push(engine);
  Object.defineProperty(engine, 'supportsUniformBuffers', { value: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const light = new HemisphericLight('native sky', Vector3.Up(), scene);
  const material = new PBRMaterial('original paint', scene);
  material.metallic = 0;
  material.roughness = 0.55;
  new CircuitPaintFinishPlugin(material);
  const mesh = new Mesh('receiver', scene),
    data = new VertexData();
  data.positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1];
  data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0];
  data.indices = [0, 2, 1];
  data.applyToMesh(mesh);
  mesh.material = material;
  const poses = new FormulaGroundingPoses(scene),
    plugin = new FormulaGroundingPlugin(material, poses);
  return { engine, scene, light, material, mesh, poses, plugin };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const engine of engines.splice(0)) engine.dispose();
});
const ready = (s: ReturnType<typeof setup>) =>
  s.plugin.isReadyForSubMesh(new PBRMaterialDefines(), s.scene, s.engine, s.mesh.subMeshes[0]);
it('validates active inputs atomically, rejects GPU overflow, and clears unused slots on shrink/reset', () => {
  const { poses } = setup();
  const values = Array.from({ length: 48 }, (_, i) => i / 10);
  poses.set(12, values);
  const initial = poses.snapshot();
  for (const count of [-1, 13, NaN, Infinity, 0.5])
    expect(() => poses.set(count, values)).toThrow();
  for (const invalid of [NaN, Infinity, -Infinity, 1e300, undefined, '4']) {
    const bad: unknown[] = values.slice();
    bad[47] = invalid;
    expect(() => poses.set(12, bad as number[])).toThrow();
    expect(poses.snapshot()).toEqual(initial);
  }
  expect(() => poses.set(2, [1, 2, 3, 4])).toThrow();
  expect(poses.snapshot()).toEqual(initial);
  const malformed = {
    length: 48,
    get 0(): number {
      throw new Error('accessor failure');
    },
  };
  expect(() => poses.set(12, malformed)).toThrow('accessor failure');
  expect(poses.snapshot()).toEqual(initial);
  poses.set(1, [1.1, 2.2, 3.3, 4.4, NaN]);
  expect(poses.snapshot().poses.slice(0, 4)).toEqual([1.1, 2.2, 3.3, 4.4].map(Math.fround));
  expect(poses.snapshot().poses.slice(4)).toEqual(new Array(44).fill(0));
  poses.clear();
  expect(poses.snapshot()).toEqual({ count: 0, poses: new Array(48).fill(0), valid: true });
  poses.set(0, [NaN]);
});
for (const ending of ['owner', 'material', 'scene', 'loss'] as const)
  it(`retains borrowed-state lifetime and clears authoritative ownership on ${ending}`, () => {
    const s = setup();
    s.poses.set(1, [1, 2, 3, 4]);
    expect(ready(s)).toBe(true);
    if (ending === 'material') {
      s.material.dispose();
      expect(s.poses.isValid).toBe(true);
      expect(s.plugin.isValid).toBe(false);
    } else if (ending === 'scene') s.scene.dispose();
    else if (ending === 'loss') {
      s.engine.onContextLostObservable.notifyObservers(s.engine);
      s.engine.onContextRestoredObservable.notifyObservers(s.engine);
      expect(s.poses.isValid).toBe(false);
    } else s.poses.dispose();
    s.poses.dispose();
    s.poses.dispose();
    expect(s.poses.snapshot()).toEqual({ count: 0, poses: new Array(48).fill(0), valid: false });
    expect(ready(s)).toBe(false);
    expect(() => s.poses.set(1, [1, 2, 3, 4])).toThrow('invalidated');
  });
it('authoritative dispose clears state even when an earlier Scene observer skips its callback', () => {
  const e = new NullEngine();
  engines.push(e);
  const scene = new Scene(e);
  scene.useRightHandedSystem = true;
  scene.onDisposeObservable.add((_scene, state) => {
    state.skipNextObservers = true;
  });
  const poses = new FormulaGroundingPoses(scene);
  poses.set(1, [1, 2, 3, 4]);
  scene.dispose();
  expect(poses.isValid).toBe(false);
  poses.dispose();
  expect(poses.snapshot().poses).toEqual(new Array(48).fill(0));
});
it('uses the existing material UBO with no maps, meshes or independent GPU owner', () => {
  const s = setup(),
    before = {
      meshes: s.scene.meshes.length,
      textures: s.scene.textures.length,
      materials: s.scene.materials.length,
    };
  s.poses.set(1, [1, 2, 3, 4]);
  const values = { useUbo: true, updateInt: vi.fn(), updateArray: vi.fn() };
  s.plugin.hardBindForSubMesh(
    values as unknown as UniformBuffer,
    s.scene,
    s.engine,
    s.mesh.subMeshes[0],
  );
  expect(values.updateInt).toHaveBeenCalledWith('formulaGroundingCount', 1);
  expect(values.updateArray).toHaveBeenCalledWith('formulaGroundingPose', [
    1,
    2,
    3,
    4,
    ...new Array(44).fill(0),
  ]);
  expect(s.plugin.getUniforms().ubo).toEqual([
    { name: 'formulaGroundingCount', size: 1, type: 'highp int' },
    { name: 'formulaGroundingPose', size: 4, type: 'vec4', arraySize: 12 },
  ]);
  expect({
    meshes: s.scene.meshes.length,
    textures: s.scene.textures.length,
    materials: s.scene.materials.length,
  }).toEqual(before);
  expect(() => s.poses.bind({ ...values, useUbo: false } as unknown as UniformBuffer)).toThrow(
    'UBO',
  );
});
it('generates matching explicit integer precision in both native Material blocks without changing UBO layout or uploads', async () => {
  const s = setup(),
    buffer = s.material._uniformBuffer,
    addUniform = vi.spyOn(buffer, 'addUniform');
  s.material.buildUniformLayout();
  expect(addUniform).toHaveBeenCalledWith('formulaGroundingCount', 1, 0);
  expect(addUniform).toHaveBeenCalledWith('formulaGroundingPose', 4, 12);
  const layout = buffer as unknown as {
    _uniformLocations: Record<string, number>;
    _uniformSizes: Record<string, number>;
  };
  const countOffset = layout._uniformLocations.formulaGroundingCount,
    poseOffset = layout._uniformLocations.formulaGroundingPose;
  expect(layout._uniformSizes.formulaGroundingCount).toBe(1);
  expect(layout._uniformSizes.formulaGroundingPose).toBe(48);
  expect(poseOffset).toBe(Math.ceil((countOffset + 1) / 4) * 4);
  const poses = Array.from({ length: 48 }, (_, i) => Math.fround((i + 1) / 10));
  s.poses.set(12, poses);
  s.poses.bind(buffer);
  const data = buffer.getData(),
    words = new Int32Array(data.buffer, data.byteOffset, data.length);
  expect(words[countOffset]).toBe(12);
  expect(Array.from(data.slice(poseOffset, poseOffset + 48))).toEqual(poses);

  const manager = s.material.pluginManager as unknown as {
    _injectCustomCode(
      data: { indexParameters: Record<string, number> },
      existing: undefined,
    ): (type: string, code: string) => string;
  };
  const emit = async (stage: 'vertex' | 'fragment', ubo: boolean) => {
    const expanded = await new Promise<string>((resolve) =>
      ProcessIncludes(
        stage === 'vertex' ? pbrVertexShader.shader : pbrPixelShader.shader,
        {
          defines: [],
          indexParameters: { maxSimultaneousLights: 2 },
          isFragment: stage === 'fragment',
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
    return manager._injectCustomCode({ indexParameters: { maxSimultaneousLights: 2 } }, undefined)(
      stage,
      expanded,
    );
  };
  const blocks: string[] = [];
  for (const stage of ['vertex', 'fragment'] as const) {
    const emitted = await emit(stage, true),
      block = emitted.match(/uniform Material\s*\{([\s\S]*?)\};/)?.[1];
    expect(block, stage).toBeDefined();
    expect(block, stage).toContain('highp int formulaGroundingCount;');
    expect(block?.match(/formulaGroundingCount/g), stage).toHaveLength(1);
    expect(block, stage).toContain('vec4 formulaGroundingPose[12];');
    expect(emitted).not.toContain('#define ADDITIONAL_UBO_DECLARATION');
    blocks.push(block!);
  }
  expect(blocks[0]).toBe(blocks[1]);
  const standalone = await emit('fragment', false);
  expect(standalone).toContain('uniform highp int formulaGroundingCount;');
  expect(standalone).not.toContain('uniform int formulaGroundingCount;');
});
it('keeps persistent shader/cache identity across zero, maximum and shrinking counts and later plugins', () => {
  const s = setup();
  const key = () => {
    const info: MaterialPluginGetDefineNames = { defineNames: {} };
    s.material._callbackPluginEventGeneric(MaterialPluginEvent.GetDefineNames, info);
    return new PBRMaterialDefines(info.defineNames).toString();
  };
  const initial = key();
  expect(initial).toContain('#define ORIGINAL_FORMULA_GROUNDING_V1');
  s.poses.set(12, new Array(48).fill(1));
  expect(key()).toBe(initial);
  s.poses.clear();
  expect(key()).toBe(initial);
  expect(() => new FormulaGroundingPlugin(s.material, s.poses)).toThrow('install once');
  s.material.buildUniformLayout();
  expect(
    () => new FormulaGroundingPlugin(s.material, new FormulaGroundingPoses(s.scene)),
  ).toThrow();
});
it('pins the original Formula-only GLSL algebra and formatted constants without importing original hooks', () => {
  const original = groundingOracle.factories[0].shader.fragmentShader;
  for (const line of FORMULA_GROUNDING_GLSL.split('\n')
    .map((x) => x.trim())
    .filter((x) => x.startsWith('occ = max(')))
    expect(original).toContain(line.replaceAll('formulaGroundBox', 'apexGroundBox'));
  expect(FORMULA_GROUNDING_GLSL).toContain('dot( d, d ) > 16.000');
  expect(FORMULA_GROUNDING_GLSL).toContain('smoothstep( 0.180, 0.450, abs( l.y ) )');
  expect(FORMULA_GROUNDING_GLSL).toContain('i < 12');
  expect(FORMULA_GROUNDING_GLSL).not.toMatch(/Gp|front\.w|shape\./);
  const source = readFileSync('src/engine/babylon/formula-grounding.ts', 'utf8');
  expect(source).not.toMatch(/from ['"][^'"]*(?:three|rendering\/studio)/);
  expect(source).not.toMatch(
    /finalColor\s*[*=]|gl_FragColor\s*[*=]|surfaceAlbedo\s*[*=]|normalW\s*[*=]|finalEmissive\s*[*=]/,
  );
});
it('captures HEMI native info, then reproduces native albedo/clamp/intensity/AO and specular energy order before application', () => {
  const { plugin } = setup(),
    code = plugin.getCustomCode('fragment')!,
    apply = code.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION;
  expect(code['!#define CUSTOM_LIGHT([0-9]+)_COLOR']).toContain('#ifdef HEMILIGHT$1');
  expect(code['!aggShadow\\+=shadow;numLights\\+=1\\.0;']).toContain(
    'formulaSkySpecularBase+=info.specular*shadow;',
  );
  const terms = [
    'formulaSkyDiffuse*=surfaceAlbedo;',
    'formulaSkyDiffuse=max(formulaSkyDiffuse,0.0);',
    'formulaSkyDiffuse*=vLightingIntensity.x;',
    'formulaSkyDiffuse*=ambientOcclusionForDirectDiffuse;',
    'finalDiffuse=finalDiffuse*formulaDirect',
  ];
  let previous = -1;
  for (const term of terms) {
    const index = apply.indexOf(term);
    expect(index).toBeGreaterThan(previous);
    previous = index;
  }
  expect(apply).toContain('formulaSkySpecular*=coloredEnergyConservationFactor;');
  expect(apply).toContain('1.0-0.600*formulaGround');
  expect(apply).toContain('1.0-0.320*formulaGround*formulaGround');
  expect(apply.indexOf('if(formulaGround>0.0)')).toBeLessThan(apply.indexOf('finalDiffuse='));
});
it('rejects late global include drift before returning custom shader injection', () => {
  const { plugin } = setup();
  const before = ShaderStore.IncludesShadersStore[lightFragment.name];
  try {
    ShaderStore.IncludesShadersStore[lightFragment.name] = before + '\n// late drift';
    expect(() => plugin.getCustomCode('fragment')).toThrow('include replaced');
    expect(() => plugin.getCustomCode('vertex')).toThrow('include replaced');
  } finally {
    ShaderStore.IncludesShadersStore[lightFragment.name] = before;
  }
});
it('fails closed on native operation/anchor order changes rather than silently compiling an omitted layer', () => {
  const source = {
    fragment: pbrPixelShader.shader,
    vertex: pbrVertexShader.shader,
    light: lightFragment.shader,
    lit: pbrBlockFinalLitComponents.shader,
    unlit: pbrBlockFinalUnlitComponents.shader,
    ao: pbrBlockAmbientOcclusion.shader,
  };
  assertFormulaGroundingAnchors(source);
  for (const [key, anchor] of [
    ['fragment', '#define CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION'],
    ['light', 'specularBase+=info.specular*shadow;'],
    ['lit', 'finalSpecular=max(finalSpecular,0.0);'],
    ['unlit', 'finalDiffuse*=ambientOcclusionForDirectDiffuse;'],
  ] as const)
    expect(() =>
      assertFormulaGroundingAnchors({ ...source, [key]: source[key].replace(anchor, '') }),
    ).toThrow();
});
for (const mutation of [
  'negative-light',
  'point-light',
  'ambient',
  'transparent',
  'unlit',
  'roughness',
  'metallic',
  'vertex-color',
  'environment',
  'sheen',
] as const)
  it(`fails closed for ${mutation} without removing resource data`, () => {
    const s = setup();
    expect(ready(s)).toBe(true);
    if (mutation === 'negative-light') s.light.intensity = -1;
    if (mutation === 'point-light') new PointLight('unsupported', Vector3.Zero(), s.scene);
    if (mutation === 'ambient') s.scene.ambientColor.r = 0.1;
    if (mutation === 'transparent') s.material.alpha = 0.5;
    if (mutation === 'unlit') s.material.unlit = true;
    if (mutation === 'roughness') s.material.roughness = 0.1;
    if (mutation === 'metallic') s.material.metallic = 1;
    if (mutation === 'vertex-color') s.mesh.setVerticesData('color', new Array(12).fill(1));
    if (mutation === 'environment') s.material.reflectionTexture = s.scene.textures[0];
    if (mutation === 'sheen') s.material.sheen.isEnabled = true;
    expect(() => ready(s)).toThrow('Formula grounding');
    if (mutation === 'vertex-color') {
      expect(s.mesh.getVerticesData('color')).toEqual(new Array(12).fill(1));
      s.mesh.useVertexColors = false;
      expect(ready(s)).toBe(true);
    }
  });
it('rejects unsupported prepared native defines even when material properties look ordinary', () => {
  const s = setup();
  for (const key of [
    'CUSTOMUSERLIGHTING',
    'SHADOW0',
    'CLUSTLIGHT0',
    'INSTANCES',
    'NUM_BONE_INFLUENCERS',
    'REFLECTION',
    'PREPASS',
  ]) {
    const defines = new PBRMaterialDefines();
    Object.assign(defines, { [key]: true });
    expect(() => s.plugin.prepareDefines(defines, s.scene, s.mesh)).toThrow('native define');
  }
});

for (const mutation of [
  'f0-factor',
  'f0-color',
  'ior',
  'legacy',
  'diffuse-model',
  'dielectric-model',
  'conductor-model',
  'energy',
  'reflectance-map',
  'metallic-map',
  'micro-surface',
  'brdf-cache',
  'paint-map',
] as const)
  it(`rejects ${mutation} before assuming native clamp commutation`, () => {
    const s = setup();
    expect(ready(s)).toBe(true);
    if (mutation === 'f0-factor') s.material.metallicF0Factor = 50;
    if (mutation === 'f0-color') s.material.metallicReflectanceColor.r = 50;
    if (mutation === 'ior') s.material.indexOfRefraction = 2.4;
    if (mutation === 'legacy') s.material.brdf.useLegacySpecularEnergyConservation = false;
    if (mutation === 'diffuse-model') s.material.brdf.baseDiffuseModel = 1;
    if (mutation === 'dielectric-model') s.material.brdf.dielectricSpecularModel = 1;
    if (mutation === 'conductor-model') s.material.brdf.conductorSpecularModel = 1;
    if (mutation === 'energy') s.material.brdf.useEnergyConservation = false;
    if (mutation === 'reflectance-map') s.material.reflectanceTexture = s.scene.textures[0];
    if (mutation === 'metallic-map') s.material.metallicTexture = s.scene.textures[0];
    if (mutation === 'micro-surface') s.material.microSurfaceTexture = s.scene.textures[0];
    if (mutation === 'brdf-cache') s.material.environmentBRDFTexture = null;
    if (mutation === 'paint-map') s.material.albedoTexture = s.scene.textures[0];
    expect(() => ready(s)).toThrow('BRDF/F0/IOR');
  });

it('invalidates and clears on cancelled preparation, rejects pre-cancelled construction and never rearms', () => {
  const s = setup(),
    abort = new AbortController(),
    poses = new FormulaGroundingPoses(s.scene, abort.signal);
  poses.set(2, new Array(8).fill(2));
  abort.abort(new Error('obsolete isolated preparation'));
  expect(poses.snapshot()).toEqual({ count: 0, poses: new Array(48).fill(0), valid: false });
  expect(() => poses.set(1, [1, 2, 3, 4])).toThrow('invalidated');
  expect(() => new FormulaGroundingPoses(s.scene, abort.signal)).toThrow(
    'obsolete isolated preparation',
  );
  poses.dispose();
  poses.dispose();
});
it('does not commit a staged pose if reading input cancels its owner', () => {
  const { poses } = setup();
  const input = {
    length: 4,
    get 0() {
      poses.dispose();
      return 1;
    },
    1: 2,
    2: 3,
    3: 4,
  };
  expect(() => poses.set(1, input)).toThrow('invalidated');
  expect(poses.snapshot()).toEqual({ count: 0, poses: new Array(48).fill(0), valid: false });
});
