import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import {
  MaterialPluginEvent,
  type MaterialPluginGetDefineNames,
} from '@babylonjs/core/Materials/materialPluginEvent.js';
import { PBRMaterialDefines } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial.js';
import { ProcessIncludes } from '@babylonjs/core/Engines/Processors/shaderProcessor.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { pbrPixelShader } from '@babylonjs/core/Shaders/pbr.fragment.js';
import { pbrBlockReflectivity } from '@babylonjs/core/Shaders/ShadersInclude/pbrBlockReflectivity.js';
import {
  FormulaGroundingPoses,
  FormulaGroundingPlugin,
} from '../src/engine/babylon/formula-grounding.ts';
import { CircuitPaintFinishPlugin } from '../src/engine/babylon/circuit-paint-finish.ts';
import {
  GroundingNativeBefore,
  GroundingNativeOutput,
  groundingRawBytes,
  groundingEffectIdentity,
  groundingProbePlanes,
} from '../e2e/fixtures/babylon-grounding-parity.ts';
const engines: NullEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});
it('observes actual native terms before/after the applied plugin using the real include processor and manager ordering', async () => {
  const engine = new NullEngine();
  engines.push(engine);
  Object.defineProperty(engine, 'supportsUniformBuffers', { value: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const material = new PBRMaterial('original paint', scene);
  new CircuitPaintFinishPlugin(material);
  const poses = new FormulaGroundingPoses(scene);
  new GroundingNativeBefore(material);
  const plugin = new FormulaGroundingPlugin(material, poses);
  const output = new GroundingNativeOutput(material, 'paint');
  const info: MaterialPluginGetDefineNames = { defineNames: {} };
  material._callbackPluginEventGeneric(MaterialPluginEvent.GetDefineNames, info);
  const defines = new PBRMaterialDefines(info.defineNames).toString();
  expect(defines).toContain('#define ORIGINAL_FORMULA_GROUNDING_V1');
  expect(defines).toContain('#define GROUNDING_NATIVE_OUTPUT_V1');
  expect(plugin.priority).toBe(250);
  expect(output.priority).toBe(300);
  const expanded = await new Promise<string>((resolve) =>
    ProcessIncludes(
      pbrPixelShader.shader,
      {
        defines: [],
        indexParameters: { maxSimultaneousLights: 2 },
        isFragment: true,
        shouldUseHighPrecisionShader: true,
        supportsUniformBuffers: true,
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
  const manager = material.pluginManager as unknown as {
    _injectCustomCode(
      data: { indexParameters: Record<string, number> },
      existing: undefined,
    ): (type: string, code: string) => string;
  };
  const composed = manager._injectCustomCode(
    { indexParameters: { maxSimultaneousLights: 2 } },
    undefined,
  )('fragment', expanded);
  expect(composed).not.toContain('#include<');
  expect(composed.match(/formulaHemi=true;/g)).toHaveLength(2);
  expect(composed).toContain('#ifdef HEMILIGHT0');
  expect(composed).toContain('#ifdef HEMILIGHT1');
  expect(composed.match(/formulaSkyDiffuseBase\+=info.diffuse\*shadow;/g)).toHaveLength(2);
  const positions = [
    'finalDiffuse*=ambientOcclusionForDirectDiffuse;',
    'groundingNativeBefore=vec4(',
    'finalDiffuse=finalDiffuse*formulaDirect',
    'finalSpecularScaled=finalSpecularScaled*formulaDirect',
    'groundingNativeAfter=vec4(',
    'vec4 finalColor=',
  ].map((s) => composed.indexOf(s));
  expect(positions[0]).toBeGreaterThan(0);
  for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeGreaterThan(positions[i - 1]);
  const reflectivity = manager._injectCustomCode({ indexParameters: {} }, undefined)(
    'fragment',
    pbrBlockReflectivity.shader,
  );
  expect(reflectivity.indexOf('groundingProbeRoughness=metallicRoughness.g;')).toBeLessThan(
    reflectivity.indexOf('microSurface=1.0-metallicRoughness.g;'),
  );
  const emitted = output.getCustomCode('fragment')!;
  expect(emitted.CUSTOM_FRAGMENT_MAIN_END).toContain(
    'groundingProbeNative(groundingNativeBefore.x,groundingNativeAfter.x)',
  );
  expect(emitted.CUSTOM_FRAGMENT_MAIN_END).not.toMatch(
    /formula(?:Ground|Indirect|Direct|Sky)|asphaltSubstrateRoughness/,
  );
  poses.dispose();
});
it('losslessly transports packed native words with zero and low alpha without a canvas/PNG round trip', () => {
  const source = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < source.length; i++) source[i] = (i * 73 + 23) % 256;
  source.set([255, 241, 191, 0, 251, 193, 127, 1, 237, 233, 229, 2], 0);
  const encoded = groundingRawBytes(source),
    binary = atob(encoded),
    decoded = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  expect(decoded).toEqual(source);
  const code = readFileSync('e2e/fixtures/babylon-grounding-parity.ts', 'utf8');
  expect(code).toContain('rgbaBase64: groundingRawBytes(observation.pixels)');
  expect(code).not.toMatch(/getImageData|drawImage|createImageBitmap/);
});
it('uses identical original-scale input for adjacent road and paint, not a new shadow-card geometry', () => {
  const [road, paint] = groundingProbePlanes();
  expect(road.positions[3]).toBe(paint.positions[0]);
  expect(road.uvs[2]).toBe(paint.uvs[0]);
  expect(road.indices).toEqual(paint.indices);
  expect(road.normals).toEqual(paint.normals);
  for (const data of [road, paint]) {
    expect(data.positions).toHaveLength(12);
    expect(data.indices).toEqual(new Uint16Array([0, 2, 1, 0, 3, 2]));
    for (let i = 0; i < 4; i++) {
      expect(data.uvs[i * 2]).toBeCloseTo(data.positions[i * 3] / 5, 7);
      expect(data.uvs[i * 2 + 1]).toBeCloseTo(data.positions[i * 3 + 2] / 5, 7);
    }
  }
});
it('gates real original repeats, native denominators, controls and own-baseline closure before candidate allocation', () => {
  const source = readFileSync('e2e/fixtures/babylon-grounding-parity.ts', 'utf8');
  const gate = source.indexOf('referenceQualified = true');
  for (const token of [
    'closureBound = groundingClosureBound',
    'Original grounding control did not discriminate on both receivers',
    'Original grounding shader failure',
  ])
    expect(source.indexOf(token)).toBeLessThan(gate);
  for (const token of [
    'owner = createAsphaltSubstrate',
    'poses = new FormulaGroundingPoses',
    'new FormulaGroundingPlugin',
  ])
    expect(source.indexOf(token)).toBeGreaterThan(gate);
  expect(source.replace(/\s+/g, '').replace(/,\]/g, ']')).toContain("light==='sky'?[[0,0],[1,0]]");
  expect(source).toContain(
    "rendererName === 'three' && light === 'sky' && output === 'native-specular'",
  );
  expect(source).toContain('h.abort.signal.throwIfAborted()');
  expect(source).toContain('h.deadline');
  expect(source).not.toMatch(/setTimeout|120001|240000|requestAnimationFrame|setInterval/);
  expect(source).toContain('new FormulaGroundingPoses(h.scene, h.abort.signal)');
  expect(source).toContain('poses?.dispose()');
  expect(source).toContain('productionActivated: false');
});
it('keeps the plugin isolated from all live entries/owners and keeps Windows path classification portable', () => {
  const files: string[] = [];
  function walk(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (child.endsWith('.ts')) files.push(child);
    }
  }
  walk('src');
  const target = 'src/engine/babylon/formula-grounding.ts';
  const imports = files.filter((file) =>
    [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].some(
      (match) => relative('.', resolve(dirname(file), match[1])).replaceAll('\\', '/') === target,
    ),
  );
  expect(imports).toEqual([]);
});

it('preserves exact qualified extraction, original hooks, live asphalt/paint and consumed pinned native sources', () => {
  const hashes = {
    'src/engine/assets/formula-grounding.ts':
      'fc943986f9ee11c2aa2613d91882c34486b83157202dc46210a8386f1e2a8c16',
    'src/rendering/studio/car-grounding.ts':
      '327771f615127caded76c61f7b0278d673c8522c3a4e42d5cadf1b63f4faa096',
    'src/rendering/studio/studio-frame.ts':
      '757c60b0d4f9581b8e55a72eab1e269fca6b68a6680a9920f77acd44fa3e9efa',
    'tests/fixtures/formula-grounding-source-2041020.json.gz':
      '6156be159c6826b87dda551ee6dd0b564ff571a4fbd5695cb87a7d5b91fde7fe',
    'src/engine/assets/surface-texel-data.ts':
      '3d0e12b700c141a4d1db6dfc4e5d7789acf593646b01a6199c2a57f3f45f7353',
    'src/engine/babylon/asphalt-substrate.ts':
      'ef39cb24a4f161742e2b9f611269523adbdafb24dfcff7a4f8a4d687c14287a6',
    'src/engine/babylon/asphalt-substrate-plugin.ts':
      'ddc9f5cf7b545d069366d82199c60b3b1f75afd47d34fec7a4f17bc566398850',
    'src/engine/babylon/circuit-paint-finish.ts':
      '461b189e5c3018404c20ec3a239020228f6f144989bd9bb2d039db588a5c18ae',
    'src/engine/babylon/formula-surfaces.ts':
      'b3322b728fa549f415696d42dd3dd5616d8a270e6079cb6a7085fc5ac2971824',
    'src/engine/babylon/circuit-scene.ts':
      'aad71a9e94fbce9c7297ae514f190e1ab9afc912d9de360f0c9fedd9968ec0a4',
    'src/engine/babylon/main.ts':
      'b699584e6b7d39cd0e09313a928b5b0e67f2b12c1144143a89af77e5b6f17ef2',
    'src/rendering/surface-detail.ts':
      '8df708b5a48541371a570c1c3b6e0e65bdfc832539a3bdf686d67a640ebef4d4',
    'src/rendering/circuit-finish.ts':
      '76227e1e3ae98191a3173c20ca44128c71983c51c329e86aff0f946870236fe8',
    'src/rendering/studio/shader-hooks.ts':
      '8ae51033f242d1100a6008975d6f5be3f55fd37e8f3be6399f5f731cc8da0488',
    'node_modules/@babylonjs/core/Shaders/pbr.fragment.js':
      '69a71206c78446b478e5b0b51fc7f81b91036084a1af7c6052b99d5d962ff6fe',
    'node_modules/@babylonjs/core/Shaders/ShadersInclude/lightFragment.js':
      'f8e44f7cc1810a955ee6a2b485b11a8b1dcb100258f00ca48954878d8e399950',
    'node_modules/@babylonjs/core/Shaders/ShadersInclude/pbrBlockFinalLitComponents.js':
      '1a7fdb1c7f2902029561fc2712e507b028fcc643f0da3491ab1ae71a679f24a0',
    'node_modules/@babylonjs/core/Shaders/ShadersInclude/pbrBlockFinalUnlitComponents.js':
      '7d3390f1fe7f491ac5c405e9368a2c21ae599904a737f9dc7ccc9fe5e3cb579b',
    'node_modules/@babylonjs/core/Shaders/ShadersInclude/pbrBlockDirectLighting.js':
      'ddaa97bf361c183e0925dc123e7572b115980b032d741d54a1666deb265b36ac',
    'node_modules/@babylonjs/core/Shaders/ShadersInclude/pbrBlockAmbientOcclusion.js':
      'c6af331657635b26086f536a315853305d2e695d52074db623bcf2f9c7115349',
  };
  for (const [path, expected] of Object.entries(hashes))
    expect(createHash('sha256').update(readFileSync(path)).digest('hex'), path).toBe(expected);
});

it('does not accept an unbound draw wrapper as a stable count-zero effect witness', () => {
  const engine = new NullEngine();
  engines.push(engine);
  const scene = new Scene(engine);
  const meshes = [new Mesh('road', scene), new Mesh('paint', scene)];
  expect(() => groundingEffectIdentity(meshes)).toThrow('not actually bound');
  const source = readFileSync('e2e/fixtures/babylon-grounding-parity.ts', 'utf8');
  expect(source.indexOf('const countEffects = groundingEffectIdentity(meshes)')).toBeGreaterThan(
    source.indexOf('const zeroCandidate = await captureCandidate()'),
  );
});

it('selects every isolated grounding fixture and contract while retaining the existing GPU journey selector', () => {
  const workflow = readFileSync('.github/workflows/babylon-integration.yml', 'utf8');
  const paths = workflow.split('    paths:')[1]?.split('permissions:')[0];
  for (const path of [
    'e2e/fixtures/grounding-reference.ts',
    'e2e/fixtures/grounding-parity-metrics.ts',
    'e2e/fixtures/babylon-grounding-parity.ts',
    'e2e/babylon-surface-parity.spec.ts',
    'tests/babylon-*.test.ts',
  ])
    expect(paths).toContain(`- '${path}'`);
  const contracts = workflow
    .split('name: Engine component and existing asset geometry contracts')[1]
    ?.split('      - ')[0];
  expect(contracts).toContain('run: npx vitest run tests/babylon-*.test.ts');
  const journeys = workflow
    .split('name: Real WebGL engine, model import and mode-switching journeys')[1]
    ?.split('      - ')[0];
  for (const path of [
    'e2e/babylon-engine.spec.ts',
    'e2e/discipline-entry.spec.ts',
    'e2e/babylon-player-lods.spec.ts',
    'e2e/babylon-height-parity.spec.ts',
    'e2e/babylon-surface-parity.spec.ts',
  ])
    expect(journeys).toContain(path);
  expect(contracts + journeys).not.toMatch(
    /continue-on-error|--exclude|--testNamePattern|--passWithNoTests|--grep/,
  );
});
