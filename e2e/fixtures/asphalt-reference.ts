import * as THREE from 'three';
import { surfaceMaterial } from '../../src/rendering/surface-detail.ts';

/** Preregistered before candidate shader evaluation. Reference repeats must be
 * exact; these quantization bounds never depend on candidate error measurements. */
export const ASPHALT_PARITY_LIMITS = Object.freeze({
  referenceMax: 0,
  referenceMean: 0,
  candidateMax: 1,
  candidateMean: 0.1,
  negativeMinChangedPixels: 100,
  negativeMinMaxError: 3,
  minInteriorPixels: 1000,
});
export const ASPHALT_OUTPUTS = ['albedo', 'roughness', 'normal'] as const;
export type AsphaltOutput = (typeof ASPHALT_OUTPUTS)[number];
export type AsphaltControl =
  | 'original'
  | 'wrong-gamma'
  | 'wrong-packed-channel'
  | 'flipped-normal'
  | 'omitted-meso-tone';
export const ASPHALT_VIEWS = Object.freeze([
  { name: 'near-glints', extent: 1, eye: [0, 1.2, 1.4], bank: 0, centre: [0, 0, 0], split: false },
  {
    name: 'micro-transition',
    extent: 8,
    eye: [0, 18, 18],
    bank: 0,
    centre: [0, 0, 0],
    split: false,
  },
  { name: 'far-minified', extent: 32, eye: [0, 60, 60], bank: 0, centre: [0, 0, 0], split: false },
  {
    name: 'banked-world',
    extent: 1,
    eye: [0, 1.2, 1.4],
    bank: 0.17,
    centre: [-125.125, 2, 317.75],
    split: false,
  },
  {
    name: 'grazing-seam',
    extent: 2,
    eye: [0, 0.23, 3],
    bank: 0.05,
    centre: [3.125, 0, -2.75],
    split: true,
  },
] as const);

export function replaceReferenceAnchor(source: string, anchor: string, replacement: string) {
  if (source.split(anchor).length !== 2)
    throw new Error(`Original asphalt reference anchor changed: ${anchor}`);
  return source.replace(anchor, replacement);
}

/** Actual original factory and its actual composed hooks. Controls deliberately
 * damage one original factor; none imports or rewrites the Babylon candidate. */
export function createAsphaltReference(control: AsphaltControl = 'original') {
  const material = surfaceMaterial('asphalt', undefined, false);
  const output = { value: 0 };
  if (control === 'wrong-gamma') material.map!.colorSpace = THREE.NoColorSpace;
  if (control === 'flipped-normal') material.normalScale.y *= -1;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    if (control === 'wrong-packed-channel') {
      shader.fragmentShader = replaceReferenceAnchor(
        shader.fragmentShader,
        '#include <roughnessmap_fragment>',
        replaceReferenceAnchor(
          THREE.ShaderChunk.roughnessmap_fragment,
          'texelRoughness.g',
          'texelRoughness.r',
        ),
      );
      shader.fragmentShader = replaceReferenceAnchor(
        shader.fragmentShader,
        'max(texelRoughness.g, 0.05)',
        'max(texelRoughness.r, 0.05)',
      );
    }
    if (control === 'omitted-meso-tone')
      shader.fragmentShader = replaceReferenceAnchor(
        shader.fragmentShader,
        'diffuseColor.rgb *= 1.0 + (apexMeso - 0.5) * 0.40000;',
        '// Deliberately omitted meso albedo: negative control only.',
      );
    shader.uniforms.asphaltReferenceOutput = output;
    shader.fragmentShader = replaceReferenceAnchor(
      shader.fragmentShader,
      '#include <common>',
      '#include <common>\nuniform float asphaltReferenceOutput;',
    );
    shader.fragmentShader = replaceReferenceAnchor(
      shader.fragmentShader,
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
// Direct prelighting quantities, not radiance/PBR/tone-mapped colour.
vec3 asphaltReferenceValue = asphaltReferenceOutput < .5 ? diffuseColor.rgb * 4.0
  : asphaltReferenceOutput < 1.5 ? vec3(roughnessFactor * .5) : normal * .5 + .5;
gl_FragColor = vec4(asphaltReferenceValue, 1.0);`,
    );
  };
  material.customProgramCacheKey = () => `${previousKey}:asphalt-reference-v1:${control}`;
  let disposed = false;
  return {
    material,
    setOutput(mode: AsphaltOutput) {
      output.value = ASPHALT_OUTPUTS.indexOf(mode);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const texture of new Set([material.map, material.roughnessMap, material.normalMap]))
        texture?.dispose();
      material.dispose();
    },
  };
}
