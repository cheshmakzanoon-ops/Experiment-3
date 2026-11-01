/* Derivative tangent-frame algebra adapted from Three.js r180 normalmap_pars_fragment.
The MIT License

Copyright © 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines.js';
import { bumpFragment } from '@babylonjs/core/Shaders/ShadersInclude/bumpFragment.js';
import { pbrBlockAlbedoOpacity } from '@babylonjs/core/Shaders/ShadersInclude/pbrBlockAlbedoOpacity.js';
import { pbrBlockReflectivity } from '@babylonjs/core/Shaders/ShadersInclude/pbrBlockReflectivity.js';
import { pbrPixelShader } from '@babylonjs/core/Shaders/pbr.fragment.js';
import { pbrVertexShader } from '@babylonjs/core/Shaders/pbr.vertex.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { ASPHALT_DETAIL as D, ASPHALT_TONE, ASPHALT_TEXELS } from '../assets/surface-texel-data.ts';
import { PERIODIC_COVERAGE_GLSL } from '../../rendering/periodic-coverage.ts';
import { CIRCUIT_PAINT_NOISE } from './circuit-paint-finish.ts';

export const ASPHALT_NORMAL_ANCHOR =
  'normalW=perturbNormal(TBN,TEXRD(bumpSampler,vBumpUV+uvOffset).xyz,vBumpInfos.y);';
const replacementPoint = '!' + ASPHALT_NORMAL_ANCHOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shaderSources = () => ({
  bump: bumpFragment.shader,
  albedo: pbrBlockAlbedoOpacity.shader,
  roughness: pbrBlockReflectivity.shader,
  fragment: pbrPixelShader.shader,
  vertex: pbrVertexShader.shader,
});
/** Check pinned source before allocating/installing anything. Never mutate the
 * global ShaderStore or silently compile a material with an absent layer. */
export function assertAsphaltShaderAnchors(source = shaderSources()) {
  for (const include of [bumpFragment, pbrBlockAlbedoOpacity, pbrBlockReflectivity])
    if (ShaderStore.IncludesShadersStore[include.name] !== include.shader)
      throw new Error('Original asphalt: global shader include was replaced');
  for (const shader of [pbrPixelShader, pbrVertexShader])
    if (ShaderStore.ShadersStore[shader.name] !== shader.shader)
      throw new Error('Original asphalt: global shader source was replaced');
  for (const [text, anchor] of [
    [source.bump, ASPHALT_NORMAL_ANCHOR],
    [source.albedo, '#define CUSTOM_FRAGMENT_UPDATE_ALBEDO'],
    [source.roughness, '#define CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS'],
    [source.fragment, '#define CUSTOM_FRAGMENT_MAIN_BEGIN'],
    [source.fragment, '#define CUSTOM_FRAGMENT_DEFINITIONS'],
    [source.vertex, '#define CUSTOM_VERTEX_MAIN_END'],
    [source.vertex, '#define CUSTOM_VERTEX_DEFINITIONS'],
  ])
    if (text.split(anchor).length !== 2)
      throw new Error(`Original asphalt: pinned Babylon shader anchor changed: ${anchor}`);
  if (!source.bump.includes('#elif !defined(DETAIL)\n' + ASPHALT_NORMAL_ANCHOR))
    throw new Error('Original asphalt: tangent normal branch changed');
}

export interface AsphaltSubstrateMeans {
  albedo: readonly [number, number, number];
  roughness: number;
}
const g = (v: number) => v.toFixed(5);

function declarations(means: AsphaltSubstrateMeans) {
  return `
varying vec2 vAsphaltSubstrateMetres;
varying vec3 vAsphaltSubstrateViewPosition;
uniform sampler2D asphaltSubstrateData;
float asphaltSubstrateMicro;
float asphaltSubstrateMeso;
float asphaltSubstrateGlint;
float asphaltSubstrateRoughness;
vec2 asphaltSubstrateMesoUv;
vec2 asphaltSubstrateChipId;
${PERIODIC_COVERAGE_GLSL}
${CIRCUIT_PAINT_NOISE.replaceAll('finish', 'asphaltFinish')}
float asphaltSubstrateHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Same derivative frame as Three r180, evaluated in its view-space convention.
mat3 asphaltSubstrateFrame(vec3 eyePosition, vec3 N, vec2 uv) {
  vec3 q0 = dFdx(eyePosition.xyz), q1 = dFdy(eyePosition.xyz);
  vec2 st0 = dFdx(uv.st), st1 = dFdy(uv.st);
  vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * scale, B * scale, N);
}
void asphaltSubstrateFields() {
  float distanceToEye = length(vAsphaltSubstrateViewPosition);
  asphaltSubstrateMicro = 1.0 - smoothstep(${g(D.microFade[0])}, ${g(D.microFade[1])}, distanceToEye);
  asphaltSubstrateMesoUv = vPositionW.xz * ${g(1 / D.mesoTile)};
  asphaltSubstrateMeso = texture2D(asphaltSubstrateData, asphaltSubstrateMesoUv).r;
  vec4 roughnessTexel = texture2D(asphaltSubstrateData, vBumpUV);
  asphaltSubstrateRoughness = roughnessTexel.g;
  asphaltSubstrateRoughness *= mix(${g(means.roughness)} / max(roughnessTexel.g, 0.05), 1.0, asphaltSubstrateMicro);
  asphaltSubstrateRoughness *= 1.0 + (asphaltSubstrateMeso - 0.5) * ${g(D.mesoRoughness)};
  float normalLength = clamp(length(texture2D(bumpSampler, vBumpUV).xyz * 2.0 - 1.0), 0.2, 1.0);
  float reliefScale = ${g(ASPHALT_TEXELS.normalScale)} * asphaltSubstrateMicro;
  float spread = (1.0 - normalLength) / normalLength * reliefScale * reliefScale;
  asphaltSubstrateRoughness = sqrt(asphaltSubstrateRoughness * asphaltSubstrateRoughness + min(spread, 0.25));
  vec2 chipCell = vPositionW.xz * ${g(1 / D.glintCell)};
  asphaltSubstrateChipId = floor(chipCell);
  float footprint = max(length(fwidth(chipCell)), 1e-4);
  vec2 centre = vec2(asphaltSubstrateHash(asphaltSubstrateChipId + 3.0), asphaltSubstrateHash(asphaltSubstrateChipId + 9.0)) * 0.4 + 0.3;
  float disc = clamp((${g(D.glintRadius)} - length(fract(chipCell) - centre)) / footprint + 0.5, 0.0, 1.0);
  asphaltSubstrateGlint = step(asphaltSubstrateHash(asphaltSubstrateChipId), ${g(D.glintShare)}) * disc *
    (1.0 - smoothstep(${g(D.glintRange * 0.65)}, ${g(D.glintRange)}, distanceToEye)) *
    (1.0 - smoothstep(0.6, 1.4, footprint));
  asphaltSubstrateRoughness = mix(asphaltSubstrateRoughness, ${g(D.glintRoughness)}, asphaltSubstrateGlint);
}
vec3 asphaltSubstrateNormal() {
  vec3 N = normalize(mat3(asphaltSubstrateView) * vNormalW);
  mat3 tbn = asphaltSubstrateFrame(vAsphaltSubstrateViewPosition, N, vBumpUV);
  float mesoStep = 1.5 / 512.0;
  vec2 slope = vec2(
    texture2D(asphaltSubstrateData, asphaltSubstrateMesoUv + vec2(mesoStep, 0.0)).r - asphaltSubstrateMeso,
    texture2D(asphaltSubstrateData, asphaltSubstrateMesoUv + vec2(0.0, mesoStep)).r - asphaltSubstrateMeso) * ${g(D.mesoRelief / ((1.5 / 512) * D.mesoTile))};
  vec3 tilt = vec3(-slope.x, 0.0, -slope.y);
  vec2 facetHash = vec2(asphaltSubstrateHash(asphaltSubstrateChipId + 17.0), asphaltSubstrateHash(asphaltSubstrateChipId + 41.0));
  float angle = facetHash.x * 6.2831853;
  tilt += vec3(cos(angle), 0.0, sin(angle)) * (0.12 + 0.3 * facetHash.y) * asphaltSubstrateGlint;
  vec3 tilted = tbn[2] + mat3(asphaltSubstrateView) * tilt;
  float tiltedLength = length(tilted);
  if (tiltedLength > 1e-4) tbn[2] = tilted / tiltedLength;
  tbn[0] *= asphaltSubstrateMicro;
  tbn[1] *= asphaltSubstrateMicro;
  vec3 mapN = texture2D(bumpSampler, vBumpUV).xyz * 2.0 - 1.0;
  mapN.xy *= ${g(ASPHALT_TEXELS.normalScale)};
  vec3 viewNormal = normalize(tbn * mapN);
  // Inverse of a rigid camera rotation. No changed tangent handedness or
  // Babylon normal-map renormalization inserted into the original algebra.
  return vec3(dot(asphaltSubstrateView[0].xyz, viewNormal),
    dot(asphaltSubstrateView[1].xyz, viewNormal), dot(asphaltSubstrateView[2].xyz, viewNormal));
}
`;
}

/** Isolated dry factory boundary only. Install before any preparation while the
 * caller owns an idle GPU lane; shared textures belong to its surface owner.
 * Loss/disposal permanently invalidates this instance; restoration is no rearm. */
export class AsphaltSubstratePlugin extends MaterialPluginBase {
  private dead = false;
  private readonly code: string;
  private readonly meansLiteral: string;
  constructor(
    material: PBRMaterial,
    private data: BaseTexture | null,
    means: AsphaltSubstrateMeans,
  ) {
    assertAsphaltShaderAnchors();
    if (![...means.albedo, means.roughness].every((v) => Number.isFinite(v) && v > 0 && v <= 1))
      throw new Error('Original asphalt: invalid texel means');
    if (
      material._uniformBufferLayoutBuilt ||
      material.shaderLanguage !== 0 ||
      !material.getScene().useRightHandedSystem ||
      material.pluginManager?.getPlugin('OriginalAsphaltSubstrate')
    )
      throw new Error('Original asphalt: material installation contract');
    // Baked rounded means affect shader source; include them in persistent cache
    // identity even when later diagnostic plugins rebuild automatic markers.
    const meanKey =
      'ORIGINAL_ASPHALT_MEANS_' +
      [...means.albedo, means.roughness].map(g).join('_').replaceAll('.', '_');
    super(
      material,
      'OriginalAsphaltSubstrate',
      200,
      { ORIGINAL_ASPHALT_SUBSTRATE_V1: true, [meanKey]: true },
      true,
      false,
    );
    this.code = declarations(means);
    this.meansLiteral = means.albedo.map(g).join(', ');
    this.registerForExtraEvents = true;
    this.doNotSerialize = true;
    this._enable(true);
  }
  getClassName() {
    return 'OriginalAsphaltSubstratePlugin';
  }
  get isValid() {
    return !this.dead;
  }
  invalidate() {
    this.dead = true;
  }
  getUniforms() {
    return {
      ubo: [{ name: 'asphaltSubstrateView', size: 16, type: 'mat4' }],
      vertex: 'uniform mat4 asphaltSubstrateView;',
      fragment: 'uniform mat4 asphaltSubstrateView;',
    };
  }
  getSamplers(samplers: string[]) {
    samplers.push('asphaltSubstrateData');
  }
  getActiveTextures(textures: BaseTexture[]) {
    if (this.data && !textures.includes(this.data)) textures.push(this.data);
  }
  hasTexture(texture: BaseTexture) {
    return this.data === texture;
  }
  isReadyForSubMesh(
    _defines: MaterialDefines,
    _scene: Scene,
    _engine: AbstractEngine,
    subMesh: SubMesh,
  ) {
    if (this.dead || !this.data) return false;
    const mesh = subMesh.getMesh();
    if (
      !mesh.isVerticesDataPresent('uv') ||
      !mesh.isVerticesDataPresent('normal') ||
      mesh.isVerticesDataPresent('tangent') ||
      // Original MeshStandardMaterial.vertexColors is false. Babylon enables
      // this extra albedo multiplier from the mesh; never silently add it.
      (mesh.useVertexColors && mesh.isVerticesDataPresent('color'))
    )
      throw new Error('Original asphalt: derivative-frame geometry contract');
    const m = this._material as PBRMaterial;
    const textures = [m.albedoTexture, m.bumpTexture, this.data];
    if (
      textures.some(
        (texture) =>
          !(texture instanceof Texture) ||
          texture.coordinatesIndex !== 0 ||
          texture.uScale !== 5 / ASPHALT_TEXELS.microTile ||
          texture.vScale !== 5 / ASPHALT_TEXELS.microTile ||
          texture.uOffset !== 0 ||
          texture.vOffset !== 0 ||
          texture.uAng !== 0 ||
          texture.vAng !== 0 ||
          texture.wAng !== 0 ||
          texture.wrapU !== Texture.WRAP_ADDRESSMODE ||
          texture.wrapV !== Texture.WRAP_ADDRESSMODE ||
          texture.samplingMode !== Texture.TRILINEAR_SAMPLINGMODE ||
          texture.anisotropicFilteringLevel !== 8 ||
          texture.getSize().width !== 512 ||
          texture.getSize().height !== 512 ||
          texture.getInternalTexture()?.generateMipMaps !== true ||
          texture.getInternalTexture()?.invertY !== true,
      ) ||
      m.albedoTexture?.level !== 1 ||
      m.bumpTexture?.level !== ASPHALT_TEXELS.normalScale ||
      !m.albedoColor.equalsFloats(1, 1, 1)
    )
      throw new Error('Original asphalt: original texture transform/level contract');
    if (
      m.useParallax ||
      m.useParallaxOcclusion ||
      m.detailMap.isEnabled ||
      m.twoSidedLighting ||
      !m.backFaceCulling ||
      m.forceNormalForward ||
      m.useObjectSpaceNormalMap ||
      m.metallic !== 0 ||
      m.roughness !== 1 ||
      m.metallicTexture ||
      m.albedoTexture?.gammaSpace ||
      m.albedoTexture?.getInternalTexture()?._useSRGBBuffer !== true ||
      m.bumpTexture?.getInternalTexture()?._useSRGBBuffer !== false ||
      this.data.getInternalTexture()?._useSRGBBuffer !== false
    )
      throw new Error('Original asphalt: material/linear sampling contract');
    return this.data.isReady();
  }
  hardBindForSubMesh(buffer: UniformBuffer, scene: Scene) {
    if (this.dead) throw new Error('Original asphalt: invalidated material');
    buffer.updateMatrix('asphaltSubstrateView', scene.getViewMatrix());
    buffer.setTexture('asphaltSubstrateData', this.data);
  }
  getCustomCode(shaderType: string): Record<string, string> | null {
    // Revalidate at effect composition too: another owner could replace a global
    // include after installation. This is compile-time work, not a frame hook.
    if (shaderType === 'vertex' || shaderType === 'fragment') assertAsphaltShaderAnchors();
    if (shaderType === 'vertex')
      return {
        CUSTOM_VERTEX_DEFINITIONS:
          'varying vec2 vAsphaltSubstrateMetres; varying vec3 vAsphaltSubstrateViewPosition;',
        CUSTOM_VERTEX_MAIN_END:
          'vAsphaltSubstrateMetres=uv*5.0; vAsphaltSubstrateViewPosition=(asphaltSubstrateView*worldPos).xyz;',
      };
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: this.code ?? '',
      CUSTOM_FRAGMENT_MAIN_BEGIN: 'asphaltSubstrateFields();',
      [replacementPoint]: 'normalW=asphaltSubstrateNormal();',
      CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: 'metallicRoughness.g=asphaltSubstrateRoughness;',
      CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
// Preserve actual original emitted order: micro, meso, then construction finish.
surfaceAlbedo.rgb *= pow(max(albedoTexture.rgb, vec3(0.003)) / vec3(${this.meansLiteral ?? '0.0, 0.0, 0.0'}),
  vec3(asphaltSubstrateMicro * ${g(D.microContrast)} - 1.0));
surfaceAlbedo.rgb *= 1.0 + (asphaltSubstrateMeso - 0.5) * ${g(D.mesoTone)};
float broad=asphaltFinishFilteredNoise(vPositionW.xz*.11);
float medium=asphaltFinishFilteredNoise(vPositionW.xz*1.7);
float repair=asphaltFinishFilteredNoise(vPositionW.xz*.035+vec2(3.1,7.9));
surfaceAlbedo.rgb *= vec3(${ASPHALT_TONE.map((v) => v.toFixed(3)).join(',')}) * (.92 + broad*.08 + medium*.07) * mix(1.0,.93,smoothstep(.58,.82,repair));
float joinPhase=(vAsphaltSubstrateMetres.x-.1)/3.6;
float join=apexStripeCoverage(joinPhase,fwidth(joinPhase),.014/3.6);
surfaceAlbedo.rgb *= 1.0-.17*join;`,
    };
  }
  dispose() {
    this.dead = true;
    this.data = null;
  }
}
