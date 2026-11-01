import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import {
  ASPHALT_OUTPUTS,
  ASPHALT_PARITY_LIMITS,
  ASPHALT_VIEWS,
  createAsphaltReference,
  replaceReferenceAnchor,
  type AsphaltControl,
} from '../e2e/fixtures/asphalt-reference.ts';

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
afterEach(() => vi.unstubAllGlobals());
it('fixes independent reference/negative-control bounds before candidate evaluation', () => {
  expect(ASPHALT_PARITY_LIMITS).toEqual({
    referenceMax: 0,
    referenceMean: 0,
    candidateMax: 1,
    candidateMean: 0.1,
    negativeMinChangedPixels: 100,
    negativeMinMaxError: 3,
    minInteriorPixels: 1000,
  });
  expect(ASPHALT_OUTPUTS).toEqual(['albedo', 'roughness', 'normal']);
  expect(ASPHALT_VIEWS.map((v) => v.name)).toEqual([
    'near-glints',
    'micro-transition',
    'far-minified',
    'banked-world',
    'grazing-seam',
  ]);
  const source = readFileSync('e2e/fixtures/asphalt-reference.ts', 'utf8');
  expect(source).toContain("surfaceMaterial('asphalt', undefined, false)");
  expect(source).not.toMatch(/from ['"][^'"]*(?:babylon|asphalt-substrate)/);
});
it('rejects missing and ambiguous reference anchors rather than silently omitting controls', () => {
  expect(() => replaceReferenceAnchor('abc', 'missing', 'x')).toThrow();
  expect(() => replaceReferenceAnchor('aa', 'a', 'x')).toThrow();
  expect(replaceReferenceAnchor('abc', 'b', 'x')).toBe('axc');
});
for (const control of [
  'original',
  'wrong-gamma',
  'wrong-packed-channel',
  'flipped-normal',
  'omitted-meso-tone',
] as const)
  it(`composes the actual original factory with ${control} independently`, () => {
    canvas();
    const reference = createAsphaltReference(control as AsphaltControl);
    try {
      const { material } = reference;
      const shader = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.physical.vertexShader,
        fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      } as unknown as THREE.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(material.customProgramCacheKey()).toContain(`asphalt-reference-v1:${control}`);
      expect(material.customProgramCacheKey()).toContain('asphalt-detail-v2');
      expect(material.map!.colorSpace).toBe(
        control === 'wrong-gamma' ? THREE.NoColorSpace : THREE.SRGBColorSpace,
      );
      expect(material.normalScale.y).toBe(control === 'flipped-normal' ? -0.75 : 0.75);
      expect(
        shader.fragmentShader.includes('diffuseColor.rgb *= 1.0 + (apexMeso - 0.5) * 0.40000;'),
      ).toBe(control !== 'omitted-meso-tone');
      expect(shader.fragmentShader.includes('max(texelRoughness.r, 0.05)')).toBe(
        control === 'wrong-packed-channel',
      );
      for (const [i, mode] of ASPHALT_OUTPUTS.entries()) {
        reference.setOutput(mode);
        expect(shader.uniforms.asphaltReferenceOutput.value).toBe(i);
      }
      expect(shader.fragmentShader).toContain('normal * .5 + .5');
      expect(shader.fragmentShader).toContain('roughnessFactor * .5');
      expect(shader.fragmentShader).toContain('diffuseColor.rgb * 4.0');
    } finally {
      reference.dispose();
      reference.dispose();
    }
  });
