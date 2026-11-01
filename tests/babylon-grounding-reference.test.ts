import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import {
  groundingOracle,
  arrayBytes,
  GROUNDING_ORACLE_SHA256,
} from './fixtures/formula-grounding-oracle.ts';
import { studioUniforms, StudioFrame } from '../src/rendering/studio/studio-frame.ts';
import {
  GROUNDING_LAYOUTS,
  GROUNDING_LIMITS,
  GROUNDING_LIGHTS,
  GROUNDING_OUTPUTS,
  GROUNDING_OBSERVER_GLSL,
  GROUNDING_POSE_ORACLE_SHA256,
  createGroundingReference,
  frozenGroundingInput,
  frozenGroundingPoses,
  originalGroundingAnchor,
  setOriginalGroundingPose,
} from '../e2e/fixtures/grounding-reference.ts';
import {
  groundingReferenceMask,
  groundingPresence,
  compareGroundingChannels,
  compareGroundingCoverage,
  groundingNativeStats,
  groundingNativeClosure,
  groundingClosureBound,
} from '../e2e/fixtures/grounding-parity-metrics.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  new StudioFrame(studioUniforms).reset();
});
function canvas() {
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {},
      }),
    }),
  });
}
it('preregisters the original-only poses, reference/control bounds and absent-channel treatment', () => {
  expect(GROUNDING_POSE_ORACLE_SHA256).toBe(GROUNDING_ORACLE_SHA256);
  expect(GROUNDING_LIMITS).toEqual({
    referenceMax: 0,
    referenceMean: 0,
    candidateMax: 1,
    candidateMean: 0.1,
    nativeRange: 16,
    referenceClosureMaxUnits: 2,
    closureQuantizationAllowance: 2,
    negativeMinChangedPixels: 100,
    negativeMinMaxError: 3,
    minInteriorPixelsPerReceiver: 1000,
  });
  expect(GROUNDING_LIGHTS).toEqual(['sky', 'sun', 'mixed']);
  const source = readFileSync('e2e/fixtures/grounding-reference.ts', 'utf8');
  expect(source).toContain("surfaceMaterial('asphalt', undefined, false)");
  expect(source).toContain('installCarGrounding(material)');
  expect(source).not.toMatch(/from ['"][^'"]*(?:babylon|engine\/assets\/formula-grounding)/);
  expect(GROUNDING_OBSERVER_GLSL).toContain('before > 0.0 ? after / before : 0.0');
  expect(GROUNDING_OBSERVER_GLSL).not.toMatch(/epsilon|max\(before/);
  expect(GROUNDING_OBSERVER_GLSL).toContain('before > 0.0 || after == 0.0');
});
for (const layout of GROUNDING_LAYOUTS)
  it(`uses exact pre-edit original bytes and actual StudioFrame: ${layout.name}`, () => {
    const saved = groundingOracle.cases.find((x) => x.name === layout.oracleScenario)!.observations[
      layout.oracleObservation
    ];
    expect(arrayBytes(frozenGroundingInput(layout))).toEqual(
      Buffer.from(saved.input!.bytes, 'base64'),
    );
    expect(arrayBytes(frozenGroundingPoses(layout))).toEqual(
      Buffer.from(saved.result.poses.bytes, 'base64'),
    );
    const camera = new THREE.PerspectiveCamera(),
      sun = new THREE.DirectionalLight();
    setOriginalGroundingPose(layout, camera, sun);
    expect(studioUniforms.studioCarCount.value).toBe(layout.count);
    const before = studioUniforms.studioCarPose.value.map((x) => x.clone());
    setOriginalGroundingPose(layout, camera, sun, 'wrong-yaw');
    for (let i = 0; i < layout.count; i++)
      expect(studioUniforms.studioCarPose.value[i].z).toBe(before[i].z + 0.8);
    setOriginalGroundingPose(layout, camera, sun, 'wrong-height');
    for (let i = 0; i < layout.count; i++)
      expect(studioUniforms.studioCarPose.value[i].w).toBe(before[i].w + 0.7);
    setOriginalGroundingPose(layout, camera, sun, 'original', true);
    expect(studioUniforms.studioCarCount.value).toBe(0);
  });
for (const receiver of ['road', 'paint'] as const)
  for (const control of [
    'original',
    'omitted',
    'wrong-yaw',
    'wrong-height',
    'swapped-factors',
  ] as const)
    it(`observes actual post-AO native terms from ${receiver}/${control}, not duplicated factors`, () => {
      canvas();
      const ref = createGroundingReference(receiver, control);
      try {
        const shader = {
          uniforms: {},
          vertexShader: THREE.ShaderLib.physical.vertexShader,
          fragmentShader: THREE.ShaderLib.physical.fragmentShader,
        } as unknown as THREE.WebGLProgramParametersWithUniforms;
        ref.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
        const source = shader.fragmentShader;
        expect(ref.material.customProgramCacheKey()).toContain('car-grounding-v2');
        expect(source.indexOf('groundingReferenceBefore=vec4(')).toBeGreaterThan(
          source.indexOf('#include <aomap_fragment>'),
        );
        expect(source).toContain('groundingProbeSum(reflectedLight.directSpecular)');
        expect(source).toContain('groundingProbeSum(reflectedLight.indirectDiffuse)');
        expect(source).toContain('groundingProbeSum(reflectedLight.indirectSpecular)');
        expect(source).toContain('groundingReferenceAfter=vec4(');
        expect(source.includes('reflectedLight.indirectDiffuse *= apexIndirect;')).toBe(
          control !== 'omitted' && control !== 'swapped-factors',
        );
        expect(source.includes('reflectedLight.indirectDiffuse *= apexDirect;')).toBe(
          control === 'swapped-factors',
        );
        expect(source.includes('reflectedLight.directSpecular *= apexIndirect;')).toBe(
          control === 'swapped-factors',
        );
        expect(shader.uniforms.studioCarPose).toBe(studioUniforms.studioCarPose);
        for (const [i, output] of GROUNDING_OUTPUTS.entries()) {
          ref.setOutput(output);
          expect(shader.uniforms.groundingReferenceOutput.value).toBe(i);
        }
      } finally {
        ref.dispose();
        ref.dispose();
      }
    });
it('refuses missing/ambiguous native hook anchors', () => {
  expect(() => originalGroundingAnchor('abc', 'x', 'y')).toThrow();
  expect(() => originalGroundingAnchor('aa', 'a', 'y')).toThrow();
  expect(originalGroundingAnchor('abc', 'b', 'y')).toBe('ayc');
});
function maskFixture() {
  const size = 24,
    ids = new Uint8Array(size * size * 4);
  for (let y = 3; y < 21; y++)
    for (let x = 3; x < 21; x++) {
      const i = (y * size + x) * 4;
      ids[i + (x < 12 ? 0 : 1)] = 255;
      ids[i + 3] = 255;
    }
  return { ids, mask: groundingReferenceMask(ids, size) };
}
function fill(mask: ReturnType<typeof groundingReferenceMask>, v: number[]) {
  const result = new Uint8Array(mask.size * mask.size * 4);
  for (const i of mask.indices) result.set(v, i);
  return result;
}
it('uses original-only eroded support and catches candidate holes, wrong receivers and excess coverage', () => {
  const { ids, mask } = maskFixture();
  expect(mask.counts).toEqual({ road: 70, paint: 70 });
  const actual = ids.slice();
  actual[mask.indices[0] + 3] = 0;
  actual[mask.indices[1]] = 0;
  actual[mask.indices[1] + 1] = 255;
  actual[3] = 255;
  expect(compareGroundingCoverage(actual, ids, mask)).toEqual({
    missingInterior: 1,
    wrongReceiver: 1,
    excessCoverage: 1,
  });
  expect(compareGroundingChannels(actual, ids, mask).road.missingPixels).toBe(1);
  expect(mask.indices).toHaveLength(140);
  const bad = ids.slice();
  bad[mask.indices[0] + 2] = 1;
  expect(() => groundingReferenceMask(bad, 24)).toThrow('receiver ID');
});
it('distinguishes deliberately absent native sky-specular from an invalid required denominator', () => {
  const { mask } = maskFixture();
  const sky = fill(mask, [4 * 17, 4 * 17, 0, 255]);
  for (const row of Object.values(groundingPresence(sky, mask, 4))) {
    expect(row.missingRequired).toBe(0);
    expect(row.absentBoth).toEqual([70, 70, 0, 70]);
  }
  const failed = sky.slice();
  failed.set([0, 0, 0, 255], mask.indices[0]);
  expect(groundingPresence(failed, mask, 4).road.missingRequired).toBe(1);
  const bad = sky.slice();
  bad.set([7 * 17, 7 * 17, 17, 255], mask.indices[0]);
  const row = groundingPresence(bad, mask, 4).road;
  expect(row.unexpectedlyActive).toBe(1);
  expect(row.invalidNative).toBe(1);
  expect(() => groundingPresence(sky, mask, 16)).toThrow();
});
it('measures each renderer own native after-application closure, including packed alpha, without epsilon division', () => {
  const { mask } = maskFixture();
  const sky = fill(mask, [1, 1, 0, 100]),
    sun = fill(mask, [2, 2, 0, 200]),
    mixed = fill(mask, [3, 3, 1, 44]);
  expect(
    compareGroundingChannels(
      sky,
      sky,
      mask,
      [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      false,
    ).road.missingPixels,
  ).toBe(0);
  expect(groundingNativeStats(sky, mask).road).toEqual({
    pixels: 70,
    maxBeforeUnits: 257,
    maxAfterUnits: 100,
    nonzeroBefore: 70,
    nonzeroAfter: 70,
  });
  expect(groundingNativeClosure(mixed, sky, sun, mask).road).toEqual({
    pixels: 70,
    maxBeforeUnits: 0,
    maxAfterUnits: 0,
  });
  mixed[mask.indices[0] + 3]++;
  expect(groundingNativeClosure(mixed, sky, sun, mask).road.maxAfterUnits).toBe(1);
  expect(groundingClosureBound(0)).toBe(2);
  expect(groundingClosureBound(2)).toBe(4);
  for (const invalid of [-1, 3, NaN, Infinity, 0.5])
    expect(() => groundingClosureBound(invalid)).toThrow();
});
