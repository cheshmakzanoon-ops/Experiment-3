import * as THREE from 'three';
import { surfaceMaterial } from '../../src/rendering/surface-detail.ts';
import { installCircuitFinish } from '../../src/rendering/circuit-finish.ts';
import { installCarGrounding } from '../../src/rendering/studio/car-grounding.ts';
import { StudioFrame, studioUniforms } from '../../src/rendering/studio/studio-frame.ts';

/** Independent immutable subset of the pre-edit original pose oracle, not
 * regenerated from either renderer's candidate shader or new adapter. */
export const GROUNDING_POSE_ORACLE_SHA256 =
  '6156be159c6826b87dda551ee6dd0b564ff571a4fbd5695cb87a7d5b91fde7fe';
export const GROUNDING_LAYOUTS = Object.freeze([
  {
    name: 'flat-one',
    oracleScenario: 'ordinary-held-advance-reset-and-shrink',
    oracleObservation: 5,
    bank: 0,
    snapshotBase64:
      'mpkhQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAPwAAAAAAAMA/mpkZPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABUQc3MLEAAAJTBAAAAAE2Qrz4AAAAAu3pwPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfhas+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB+Fqz4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAgD4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4WrPgAAAAAAAAAAAAAAAAAAAAAAAAAAAACAPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfhas+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    snapshotLength: 355,
    posesBase64:
      'AAAAAACAKkAAAAAAAIAywHtCeV9mZuY/ZmZmiutRAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    count: 1,
  },
  {
    name: 'overlap-two',
    oracleScenario: 'overlapping-identical-poses',
    oracleObservation: 0,
    bank: 0,
    snapshotBase64:
      'AAAgQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAMA/mpkZPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABUQc3MLEAAAJTBAAAAAE2Qrz4AAAAAu3pwPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfhas+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB+Fqz4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAgD4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4WrPgAAAAAAAAAAAAAAAAAAAAAAAAAAAACAPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfhas+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVEHNzCxAAACUwQAAAABNkK8+AAAAALt6cD8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4WrPgAAAAAAAAAAAAAAAAAAAAAAAAAAAACAPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfhas+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB+Fqz4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAgD4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4WrPgAAAAAAAAAAAAAAAAAAAAAAAAAAAACAPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    snapshotLength: 686,
    posesBase64:
      'AAAAAACAKkAAAAAAAIAywHtCeV9mZuY/ZmZmiutRAUAAAAAAAIAqQAAAAAAAgDLAe0J5X2Zm5j9mZmaK61EBQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    count: 2,
  },
  {
    name: 'banked-height',
    oracleScenario: 'banked-pitched-unequal-contacts',
    oracleObservation: 0,
    bank: 0.17,
    snapshotBase64:
      'AAAgQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAPwAAAAAAAMA/mpkZPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABUQc3MLEAAAJTBi9e2OznjEL8gCto9DEhRPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSuJ4+AAAAAAAAAAAAAAAAAAAAAAAAAADNzMw9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAArXoz4AAAAAAAAAAAAAAAAAAAAAAAAAAM3MTD4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAexSuPgAAAAAAAAAAAAAAAAAAAAAAAAAAmpmZPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACkcL0+AAAAAAAAAAAAAAAAAAAAAAAAAADNzMw+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    snapshotLength: 355,
    posesBase64:
      'AAAAAACAKkAAAAAAAIAywNw0Ey8zM/O/eCdGFkdQAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    count: 1,
  },
] as const);

/** Registered before candidate construction/evaluation. One RGBA8 ratio LSB
 * is the cross-renderer quantization allowance, not a fitted candidate error.
 * Native before/after values are independently quantized into two 16-bit words;
 * each renderer must close its own sky+sun native sum, after all native steps. */
export const GROUNDING_LIMITS = Object.freeze({
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
export const GROUNDING_LIGHTS = ['sky', 'sun', 'mixed'] as const;
export type GroundingLight = (typeof GROUNDING_LIGHTS)[number];
export type GroundingReceiver = 'road' | 'paint';
export const GROUNDING_OUTPUTS = [
  'ratios',
  'presence',
  'native-diffuse',
  'native-specular',
  'receiver',
  'albedo',
  'roughness',
  'normal',
  'emissive',
] as const;
export type GroundingOutput = (typeof GROUNDING_OUTPUTS)[number];
export type GroundingControl =
  | 'original'
  | 'omitted'
  | 'wrong-yaw'
  | 'wrong-height'
  | 'swapped-factors';
export type GroundingLayout = (typeof GROUNDING_LAYOUTS)[number];

export function originalGroundingAnchor(source: string, anchor: string, replacement: string) {
  if (source.split(anchor).length !== 2)
    throw new Error(`Original grounding reference anchor changed: ${anchor}`);
  return source.replace(anchor, replacement);
}
function decodedBytes(base64: string) {
  const binary = atob(base64),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function frozenGroundingInput(layout: GroundingLayout) {
  const result = new Float32Array(layout.snapshotLength);
  new Uint8Array(result.buffer).set(decodedBytes(layout.snapshotBase64));
  return result;
}
export function frozenGroundingPoses(layout: GroundingLayout) {
  const result = new Float64Array(48);
  new Uint8Array(result.buffer).set(decodedBytes(layout.posesBase64));
  return result;
}

/** Exercise the actual legacy owner before the GPU reference. No extra solver,
 * ground query, replacement wheel projection or new validation policy is used. */
export function setOriginalGroundingPose(
  layout: GroundingLayout,
  camera: THREE.Camera,
  sun: THREE.DirectionalLight,
  control: GroundingControl = 'original',
  zero = false,
) {
  const frame = new StudioFrame(studioUniforms);
  frame.update(frozenGroundingInput(layout), camera, sun, 'isolated-grounding-oracle');
  const expected = frozenGroundingPoses(layout);
  if (studioUniforms.studioCarCount.value !== layout.count)
    throw new Error('Original grounding oracle count changed');
  for (let i = 0; i < 12; i++) {
    const actual = studioUniforms.studioCarPose.value[i].toArray();
    if (!actual.every((value, component) => Object.is(value, expected[i * 4 + component])))
      throw new Error(`Original grounding pose oracle changed at slot ${i}`);
    if (!studioUniforms.studioGpShape.value[i].equals(new THREE.Vector4(0, 0, 0, 0)))
      throw new Error('Formula grounding reference unexpectedly entered GP projection');
  }
  if (zero) studioUniforms.studioCarCount.value = 0;
  for (let i = 0; i < studioUniforms.studioCarCount.value; i++) {
    const pose = studioUniforms.studioCarPose.value[i];
    if (control === 'wrong-yaw') pose.z += 0.8;
    if (control === 'wrong-height') pose.w += 0.7;
  }
}

/** The probe observes native terms, not a duplicate of the grounding formula.
 * A missing denominator is encoded as absent, never divided by epsilon. */
export const GROUNDING_OBSERVER_GLSL = `
float groundingProbeSum(vec3 v) { return v.x + v.y + v.z; }
float groundingProbeRatio(float before, float after) {
  return before > 0.0 ? after / before : 0.0;
}
float groundingProbeBits(vec4 values) {
  return (values.x > 0.0 ? 1.0 : 0.0) + (values.y > 0.0 ? 2.0 : 0.0)
    + (values.z > 0.0 ? 4.0 : 0.0) + (values.w > 0.0 ? 8.0 : 0.0);
}
bool groundingProbeValid(float before, float after) {
  return before >= 0.0 && before < 16.0 && after >= 0.0 && after < 16.0
    && after <= before && (before > 0.0 || after == 0.0);
}
float groundingProbeInvalid(vec4 before, vec4 after) {
  if (!groundingProbeValid(before.x+before.z,after.x+after.z)
      || !groundingProbeValid(before.y+before.w,after.y+after.w)) return 15.0;
  return (groundingProbeValid(before.x, after.x) ? 0.0 : 1.0)
    + (groundingProbeValid(before.y, after.y) ? 0.0 : 2.0)
    + (groundingProbeValid(before.z, after.z) ? 0.0 : 4.0)
    + (groundingProbeValid(before.w, after.w) ? 0.0 : 8.0);
}
vec2 groundingProbeWord(float value) {
  float word=floor(value*(65535.0/16.0)+0.5);
  return vec2(floor(word/256.0),mod(word,256.0))/255.0;
}
vec4 groundingProbeNative(float before, float after) {
  return vec4(groundingProbeWord(before),groundingProbeWord(after));
}
`;
const originalTerms = `vec4(
  groundingProbeSum(reflectedLight.directDiffuse),
  groundingProbeSum(reflectedLight.directSpecular),
  groundingProbeSum(reflectedLight.indirectDiffuse),
  groundingProbeSum(reflectedLight.indirectSpecular))`;

/** Actual unchanged original factories and actual installed grounding hook.
 * Controls damage only that original application/pose. No candidate import. */
export function createGroundingReference(
  receiver: GroundingReceiver,
  control: GroundingControl = 'original',
) {
  const material =
    receiver === 'road'
      ? surfaceMaterial('asphalt', undefined, false)
      : new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55 });
  if (receiver === 'paint') installCircuitFinish(material, 'paint');
  installCarGrounding(material);
  const output = { value: 0 };
  const previous = material.onBeforeCompile,
    previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.groundingReferenceOutput = output;
    shader.fragmentShader = originalGroundingAnchor(
      shader.fragmentShader,
      '#include <common>',
      `#include <common>
uniform float groundingReferenceOutput;
vec4 groundingReferenceBefore;
float groundingReferenceOcclusion;
${GROUNDING_OBSERVER_GLSL}`,
    );
    shader.fragmentShader = originalGroundingAnchor(
      shader.fragmentShader,
      'float apexGround = apexCarGrounding( vApexGroundWorld );',
      `groundingReferenceBefore=${originalTerms};
float apexGround = apexCarGrounding( vApexGroundWorld );
groundingReferenceOcclusion=apexGround;`,
    );
    for (const [term, factor, other] of [
      ['indirectDiffuse', 'apexIndirect', 'apexDirect'],
      ['indirectSpecular', 'apexIndirect', 'apexDirect'],
      ['directDiffuse', 'apexDirect', 'apexIndirect'],
      ['directSpecular', 'apexDirect', 'apexIndirect'],
    ]) {
      const anchor = `reflectedLight.${term} *= ${factor};`;
      if (control === 'omitted')
        shader.fragmentShader = originalGroundingAnchor(
          shader.fragmentShader,
          anchor,
          '// Deliberately omitted native attenuation.',
        );
      if (control === 'swapped-factors')
        shader.fragmentShader = originalGroundingAnchor(
          shader.fragmentShader,
          anchor,
          `reflectedLight.${term} *= ${other};`,
        );
    }
    shader.fragmentShader = originalGroundingAnchor(
      shader.fragmentShader,
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
vec4 groundingReferenceAfter=${originalTerms};
float groundingBeforeDiffuse=groundingReferenceBefore.x+groundingReferenceBefore.z;
float groundingAfterDiffuse=groundingReferenceAfter.x+groundingReferenceAfter.z;
float groundingBeforeSpecular=groundingReferenceBefore.y+groundingReferenceBefore.w;
float groundingAfterSpecular=groundingReferenceAfter.y+groundingReferenceAfter.w;
vec4 groundingOutput=vec4(
  groundingProbeRatio(groundingBeforeDiffuse,groundingAfterDiffuse),
  groundingProbeRatio(groundingBeforeSpecular,groundingAfterSpecular),groundingReferenceOcclusion,1.0);
if(groundingReferenceOutput>0.5 && groundingReferenceOutput<1.5)
  groundingOutput=vec4(groundingProbeBits(groundingReferenceBefore)/15.0,
    groundingProbeBits(groundingReferenceAfter)/15.0,
    groundingProbeInvalid(groundingReferenceBefore,groundingReferenceAfter)/15.0,1.0);
else if(groundingReferenceOutput>1.5 && groundingReferenceOutput<2.5)
  groundingOutput=groundingProbeNative(groundingBeforeDiffuse,groundingAfterDiffuse);
else if(groundingReferenceOutput>2.5 && groundingReferenceOutput<3.5)
  groundingOutput=groundingProbeNative(groundingBeforeSpecular,groundingAfterSpecular);
else if(groundingReferenceOutput>3.5 && groundingReferenceOutput<4.5)
  groundingOutput=vec4(${receiver === 'road' ? '1.0,0.0' : '0.0,1.0'},0.0,1.0);
else if(groundingReferenceOutput>4.5 && groundingReferenceOutput<5.5)
  groundingOutput=vec4(diffuseColor.rgb*0.5,1.0);
else if(groundingReferenceOutput>5.5 && groundingReferenceOutput<6.5)
  groundingOutput=vec4(vec3(roughnessFactor*0.5),1.0);
else if(groundingReferenceOutput>6.5 && groundingReferenceOutput<7.5)
  groundingOutput=vec4(normal*0.5+0.5,1.0);
else if(groundingReferenceOutput>7.5)
  groundingOutput=vec4(totalEmissiveRadiance,1.0);
gl_FragColor=groundingOutput;`,
    );
  };
  material.customProgramCacheKey = () =>
    `${previousKey}:grounding-reference-v1:${receiver}:${control}`;
  let disposed = false;
  return {
    material,
    setOutput(mode: GroundingOutput) {
      output.value = GROUNDING_OUTPUTS.indexOf(mode);
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
