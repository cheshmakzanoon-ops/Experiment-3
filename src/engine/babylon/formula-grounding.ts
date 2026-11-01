import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { pbrVertexShader } from '@babylonjs/core/Shaders/pbr.vertex.js';
import { pbrPixelShader } from '@babylonjs/core/Shaders/pbr.fragment.js';
import { lightFragment } from '@babylonjs/core/Shaders/ShadersInclude/lightFragment.js';
import { pbrBlockFinalLitComponents } from '@babylonjs/core/Shaders/ShadersInclude/pbrBlockFinalLitComponents.js';
import { pbrBlockFinalUnlitComponents } from '@babylonjs/core/Shaders/ShadersInclude/pbrBlockFinalUnlitComponents.js';
import { pbrBlockAmbientOcclusion } from '@babylonjs/core/Shaders/ShadersInclude/pbrBlockAmbientOcclusion.js';
import {
  CAR_GROUNDING as G,
  CAR_FOOTPRINT,
  CAR_TYRES as T,
  FORMULA_GROUNDING_MAX_CARS as MAX,
} from '../assets/formula-grounding.ts';

/** Candidate-only boundary. Legacy StudioFrame remains deliberately permissive.
 * One caller owns this CPU state; material plugins borrow it. No texture, mesh,
 * timer, GPU buffer or simulation is allocated. Dispose explicitly in the view's
 * finally path too: an unrelated earlier Scene observer may skip our observer. */
export class FormulaGroundingPoses {
  private count = 0;
  private readonly poses = new Array<number>(MAX * 4).fill(0);
  private dead = false;
  private readonly detach: () => void;
  constructor(
    readonly scene: Scene,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (scene.isDisposed || !scene.useRightHandedSystem)
      throw new Error('Formula grounding: live right-handed scene required');
    const engine = scene.getEngine();
    const lost = engine.onContextLostObservable.add(() => this.invalidate());
    const disposed = scene.onDisposeObservable.add(() => this.dispose());
    const cancelled = () => this.invalidate();
    signal?.addEventListener('abort', cancelled, { once: true });
    this.detach = () => {
      engine.onContextLostObservable.remove(lost);
      scene.onDisposeObservable.remove(disposed);
      signal?.removeEventListener('abort', cancelled);
    };
  }
  get isValid() {
    return !this.dead && !this.scene.isDisposed;
  }
  snapshot() {
    return { count: this.count, poses: this.poses.slice(), valid: this.isValid };
  }
  set(count: number, input: ArrayLike<number>) {
    if (!this.isValid) throw new Error('Formula grounding: invalidated pose owner');
    if (
      !Number.isInteger(count) ||
      count < 0 ||
      count > MAX ||
      !input ||
      !Number.isInteger(input.length) ||
      input.length < count * 4
    )
      throw new Error('Formula grounding: malformed active poses');
    const next = new Array<number>(MAX * 4).fill(0);
    for (let i = 0; i < count * 4; i++) {
      const value = input[i];
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        !Number.isFinite(Math.fround(value))
      )
        throw new Error('Formula grounding: nonfinite active GPU pose');
      next[i] = Math.fround(value);
    }
    // Nothing observable is changed until every active scalar has passed.
    if (!this.isValid) throw new Error('Formula grounding: invalidated pose owner');
    for (let i = 0; i < next.length; i++) this.poses[i] = next[i];
    this.count = count;
  }
  clear() {
    this.poses.fill(0);
    this.count = 0;
  }
  invalidate() {
    this.dead = true;
    this.clear();
  }
  bind(buffer: UniformBuffer) {
    if (!this.isValid) throw new Error('Formula grounding: invalidated pose owner');
    if (!buffer.useUbo) throw new Error('Formula grounding: WebGL2 material UBO required');
    buffer.updateInt('formulaGroundingCount', this.count);
    buffer.updateArray('formulaGroundingPose', this.poses);
  }
  dispose() {
    this.invalidate();
    this.detach();
  }
}

const sources = () => ({
  fragment: pbrPixelShader.shader,
  vertex: pbrVertexShader.shader,
  light: lightFragment.shader,
  lit: pbrBlockFinalLitComponents.shader,
  unlit: pbrBlockFinalUnlitComponents.shader,
  ao: pbrBlockAmbientOcclusion.shader,
});
const once = (source: string, anchor: string) => {
  if (source.split(anchor).length !== 2)
    throw new Error(`Formula grounding: pinned native anchor changed: ${anchor}`);
};
/** Construction AND effect-composition checks, never a global ShaderStore edit.
 * The exact consumed operation order is guarded, not just a convenient marker. */
export function assertFormulaGroundingAnchors(source = sources()) {
  for (const include of [
    lightFragment,
    pbrBlockFinalLitComponents,
    pbrBlockFinalUnlitComponents,
    pbrBlockAmbientOcclusion,
  ])
    if (ShaderStore.IncludesShadersStore[include.name] !== include.shader)
      throw new Error('Formula grounding: global native include replaced');
  if (
    ShaderStore.ShadersStore[pbrPixelShader.name] !== pbrPixelShader.shader ||
    ShaderStore.ShadersStore[pbrVertexShader.name] !== pbrVertexShader.shader
  )
    throw new Error('Formula grounding: global native shader replaced');
  for (const [text, anchor] of [
    [
      source.vertex,
      'vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);vPositionW=vec3(worldPos);',
    ],
    [source.fragment, '#define CUSTOM_FRAGMENT_DEFINITIONS'],
    [source.fragment, '#define CUSTOM_FRAGMENT_MAIN_BEGIN'],
    [
      source.fragment,
      '#include<pbrBlockFinalUnlitComponents>\n#define CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION\n#include<pbrBlockFinalColorComposition>',
    ],
    [source.light, '#define CUSTOM_LIGHT{X}_COLOR'],
    [source.light, 'aggShadow+=shadow;numLights+=1.0;'],
    [source.light, 'diffuseBase+=info.diffuse*shadow;'],
    [source.light, 'specularBase+=info.specular*shadow;'],
    [
      source.lit,
      'vec3 finalSpecular=specularBase;finalSpecular=max(finalSpecular,0.0);vec3 finalSpecularScaled=finalSpecular*vLightingIntensity.x*vLightingIntensity.w;',
    ],
    [
      source.lit,
      '#if defined(ENVIRONMENTBRDF) && defined(MS_BRDF_ENERGY_CONSERVATION)\nfinalSpecularScaled*=coloredEnergyConservationFactor;',
    ],
    [source.unlit, 'vec3 finalDiffuse=diffuseBase;finalDiffuse*=surfaceAlbedo;'],
    [source.unlit, 'finalDiffuse=max(finalDiffuse,0.0);finalDiffuse*=vLightingIntensity.x;'],
    [
      source.unlit,
      'vec3 ambientOcclusionForDirectDiffuse=mix(vec3(1.),aoOut.ambientOcclusionColor,vAmbientInfos.w);',
    ],
    [source.unlit, 'vec3 ambientOcclusionForDirectDiffuse=aoOut.ambientOcclusionColor;'],
    [
      source.unlit,
      'finalAmbient*=aoOut.ambientOcclusionColor;finalDiffuse*=ambientOcclusionForDirectDiffuse;',
    ],
  ])
    once(text, anchor);
  if (
    source.light.indexOf('aggShadow+=shadow;numLights+=1.0;') >
    source.light.indexOf('diffuseBase+=info.diffuse*shadow;')
  )
    throw new Error('Formula grounding: native light accumulation order changed');
}
const f = (v: number) => v.toFixed(3);
/** Formula branch only, with original formatted constants and operation order.
 * No GP wheel projection or replacement ground-plane fit is implied. */
export const FORMULA_GROUNDING_GLSL = `
float formulaGroundBox( vec2 q, vec2 centre, vec2 extent, float falloff ) {
  vec2 d = abs( q - centre ) - extent;
  float sdf = length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 );
  return 1.0 - smoothstep( - falloff, falloff, sdf );
}
vec3 formulaGroundLocal( vec4 pose, vec3 p ) {
  float s = sin( pose.z ), c = cos( pose.z );
  vec2 d = p.xz - pose.xy;
  return vec3( d.x * c - d.y * s, p.y - pose.w, d.x * s + d.y * c );
}
float formulaGrounding( vec3 p ) {
  float total = 0.0;
  for ( int i = 0; i < ${MAX}; i ++ ) {
    if ( i >= formulaGroundingCount ) break;
    vec4 pose = formulaGroundingPose[ i ];
    vec2 d = p.xz - pose.xy;
    if ( dot( d, d ) > ${f(G.reach * G.reach)} ) continue;
    vec3 l = formulaGroundLocal( pose, p );
    float gate = 1.0 - smoothstep( ${f(G.height * 0.4)}, ${f(G.height)}, abs( l.y ) );
    if ( gate <= 0.0 ) continue;
    vec2 q = l.xz;
    float occ = 0.0;
    ${CAR_FOOTPRINT.map((part) => `occ = max( occ, ${f(part.strength)} * formulaGroundBox( q, vec2( ${f(part.centre[0])}, ${f(part.centre[1])} ), vec2( ${f(part.half[0])}, ${f(part.half[1])} ), ${f(G.falloff)} ) );`).join('\n    ')}
    vec2 w = vec2( abs( q.x ), q.y );
    occ = max( occ, formulaGroundBox( w, vec2( ${f(T.across)}, ${f(T.front)} ), vec2( ${f(T.half[0])}, ${f(T.half[1])} ), ${f(G.tyreFalloff)} ) );
    occ = max( occ, formulaGroundBox( w, vec2( ${f(T.across)}, ${f(T.rear)} ), vec2( ${f(T.half[0])}, ${f(T.half[1])} ), ${f(G.tyreFalloff)} ) );
    total = max( total, occ * gate );
  }
  return total;
}
`;
const application = `
// Native final terms already include albedo, nonnegative clamp, intensities,
// direct AO and (when defined) the renderer's specular energy conservation.
float formulaGround= formulaGrounding(vPositionW);
if(formulaGround>0.0) {
  float formulaIndirect=1.0-${f(G.indirect)}*formulaGround;
  float formulaDirect=1.0-${f(G.direct)}*formulaGround*formulaGround;
  vec3 formulaSkyDiffuse=formulaSkyDiffuseBase;
  formulaSkyDiffuse*=surfaceAlbedo;
  formulaSkyDiffuse=max(formulaSkyDiffuse,0.0);
  formulaSkyDiffuse*=vLightingIntensity.x;
  formulaSkyDiffuse*=ambientOcclusionForDirectDiffuse;
  // Positive native operations commute with the HEMI/DIR split in this
  // asserted opaque, nonnegative scope. Zero occupancy is bitwise untouched.
  finalDiffuse=finalDiffuse*formulaDirect+formulaSkyDiffuse*(formulaIndirect-formulaDirect);
#ifdef SPECULARTERM
  vec3 formulaSkySpecular=formulaSkySpecularBase;
  formulaSkySpecular=max(formulaSkySpecular,0.0);
  formulaSkySpecular=formulaSkySpecular*vLightingIntensity.x*vLightingIntensity.w;
#if defined(ENVIRONMENTBRDF) && defined(MS_BRDF_ENERGY_CONSERVATION)
  formulaSkySpecular*=coloredEnergyConservationFactor;
#endif
  finalSpecularScaled=finalSpecularScaled*formulaDirect+formulaSkySpecular*(formulaIndirect-formulaDirect);
#endif
  finalAmbient*=formulaIndirect;
}
`;
const forbiddenDefines = [
  'UNLIT',
  'CUSTOMUSERLIGHTING',
  'REFLECTION',
  'LIGHTMAP',
  'AMBIENT',
  'ALPHABLEND',
  'ALPHATEST',
  'PREMULTIPLYALPHA',
  'CLEARCOAT',
  'SHEEN',
  'ANISOTROPIC',
  'IRIDESCENCE',
  'SUBSURFACE',
  'SS_REFRACTION',
  'SS_TRANSLUCENCY',
  'SS_SCATTERING',
  'DETAIL',
  'DECAL',
  'INSTANCES',
  'THIN_INSTANCES',
  'MORPHTARGETS',
  'VERTEXCOLOR',
  'VERTEXALPHA',
  'BONES_VELOCITY_ENABLED',
  'PREPASS',
  'ORDER_INDEPENDENT_TRANSPARENCY',
  'GEOMETRY_RENDERING',
  'DEBUGMODE',
  'SHADOWONLY',
];
const nonnegative = (v: number) => Number.isFinite(v) && Number.isFinite(Math.fround(v)) && v >= 0;
const color = (c: { r: number; g: number; b: number }) => [c.r, c.g, c.b].every(nonnegative);
function assertScope(m: PBRMaterial, scene: Scene, mesh: AbstractMesh) {
  const road = m.pluginManager?.getPlugin('OriginalAsphaltSubstrate');
  const paint = m.pluginManager?.getPlugin('OriginalCircuitPaintFinish');
  // Nonnegative public colours alone do not imply nonnegative native diffuse:
  // unbounded F0/F90 can make (1-Fresnel) or legacy albedo conservation negative.
  // Support the actual authored factory BRDF only, not arbitrary PBR inputs.
  if (
    m.indexOfRefraction !== 1.5 ||
    m.metallicF0Factor !== 1 ||
    !m.metallicReflectanceColor.equalsFloats(1, 1, 1) ||
    m.metallicReflectanceTexture ||
    m.reflectanceTexture ||
    m.reflectivityTexture ||
    m.metallicTexture ||
    m.microSurfaceTexture ||
    m.environmentBRDFTexture !== scene.environmentBRDFTexture ||
    !m.brdf.useEnergyConservation ||
    !m.brdf.useSmithVisibilityHeightCorrelated ||
    !m.brdf.useSphericalHarmonics ||
    !m.brdf.useSpecularGlossinessInputEnergyConservation ||
    !m.brdf.mixIblRadianceWithIrradiance ||
    !m.brdf.useLegacySpecularEnergyConservation ||
    m.brdf.baseDiffuseModel !== 0 ||
    m.brdf.dielectricSpecularModel !== 0 ||
    m.brdf.conductorSpecularModel !== 0 ||
    (paint && (m.albedoTexture || m.bumpTexture))
  )
    throw new Error('Formula grounding: original receiver BRDF/F0/IOR contract');
  if (
    Boolean(road) === Boolean(paint) ||
    scene.isDisposed ||
    !scene.useRightHandedSystem ||
    m.shaderLanguage !== 0 ||
    m.unlit ||
    m.disableLighting ||
    m.alpha !== 1 ||
    m.needAlphaBlendingForMesh(mesh) ||
    m.needAlphaTestingForMesh(mesh) ||
    m.metallic !== 0 ||
    m.roughness !== (road ? 1 : 0.55) ||
    !color(m.albedoColor) ||
    !color(m.metallicReflectanceColor) ||
    ![m.directIntensity, m.specularIntensity, m.emissiveIntensity, m.metallicF0Factor].every(
      nonnegative,
    ) ||
    m.baseWeight !== 1 ||
    m.baseDiffuseRoughness !== null ||
    m.baseWeightTexture ||
    m.baseDiffuseRoughnessTexture ||
    !m.ambientColor.equalsFloats(0, 0, 0) ||
    !scene.ambientColor.equalsFloats(0, 0, 0) ||
    !m.emissiveColor.equalsFloats(0, 0, 0) ||
    scene.environmentTexture ||
    m.reflectionTexture ||
    m.lightmapTexture ||
    m.ambientTexture ||
    m.emissiveTexture ||
    m.opacityTexture ||
    m.clearCoat.isEnabled ||
    m.sheen.isEnabled ||
    m.anisotropy.isEnabled ||
    m.iridescence.isEnabled ||
    m.subSurface.isRefractionEnabled ||
    m.subSurface.isTranslucencyEnabled ||
    m.subSurface.isScatteringEnabled ||
    m.detailMap.isEnabled ||
    m.twoSidedLighting ||
    !m.backFaceCulling ||
    m.forceNormalForward ||
    m.pointsCloud ||
    m.wireframe ||
    m.debugMode !== 0 ||
    Boolean(m.customShaderNameResolve) ||
    m.useVertexPulling ||
    !mesh.isVerticesDataPresent('normal') ||
    (mesh.useVertexColors && mesh.isVerticesDataPresent('color')) ||
    mesh.skeleton ||
    mesh.morphTargetManager ||
    mesh.hasThinInstances ||
    mesh.getClassName() !== 'Mesh'
  )
    throw new Error('Formula grounding: unsupported opaque dry receiver variant');
  const lights = mesh.lightSources.filter((l) => l.isEnabled());
  if (lights.length === 0 || lights.length > m.maxSimultaneousLights)
    throw new Error('Formula grounding: actual light set must be prepared');
  for (const light of lights) {
    if (
      !(light instanceof HemisphericLight || light instanceof DirectionalLight) ||
      !color(light.diffuse) ||
      !color(light.specular) ||
      !nonnegative(light.intensity) ||
      light.lightmapMode !== 0 ||
      light.getShadowGenerator() ||
      ![light.direction.x, light.direction.y, light.direction.z].every(Number.isFinite) ||
      light.direction.lengthSquared() === 0 ||
      (light instanceof HemisphericLight && !color(light.groundColor))
    )
      throw new Error(
        'Formula grounding: only finite nonnegative HEMILIGHT/DIRLIGHT without shadows are supported',
      );
  }
}

/** Isolated mapping, not live activation or PBR/environment parity. HEMILIGHT's
 * native diffuse AND its additional native specular receive the original sky
 * attenuation; Three has no positive sky-specular in the no-environment oracle.
 * That latter term is a documented semantic mapping policy, independently
 * observed by the probe, not a fabricated cross-renderer specular reference. */
export class FormulaGroundingPlugin extends MaterialPluginBase {
  private dead = false;
  constructor(
    material: PBRMaterial,
    private readonly poses: FormulaGroundingPoses,
  ) {
    assertFormulaGroundingAnchors();
    if (
      !poses.isValid ||
      poses.scene !== material.getScene() ||
      material._uniformBufferLayoutBuilt ||
      material.shaderLanguage !== 0 ||
      !material.getScene().getEngine().supportsUniformBuffers ||
      material.pluginManager?.getPlugin('OriginalFormulaGrounding')
    )
      throw new Error(
        'Formula grounding: install once before preparation on a live WebGL2 material',
      );
    super(
      material,
      'OriginalFormulaGrounding',
      250,
      { ORIGINAL_FORMULA_GROUNDING_V1: true },
      true,
      false,
    );
    this.doNotSerialize = true;
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getClassName() {
    return 'OriginalFormulaGroundingPlugin';
  }
  get isValid() {
    return !this.dead && this.poses.isValid;
  }
  getUniforms() {
    return {
      ubo: [
        { name: 'formulaGroundingCount', size: 1, type: 'int' },
        { name: 'formulaGroundingPose', size: 4, type: 'vec4', arraySize: MAX },
      ],
      fragment: `uniform int formulaGroundingCount; uniform vec4 formulaGroundingPose[${MAX}];`,
    };
  }
  isReadyForSubMesh(
    _defines: MaterialDefines,
    scene: Scene,
    _engine: AbstractEngine,
    subMesh: SubMesh,
  ) {
    if (!this.isValid) return false;
    assertScope(this._material as PBRMaterial, scene, subMesh.getMesh());
    return true;
  }
  prepareDefines(defines: MaterialDefines, scene: Scene, mesh: AbstractMesh) {
    if (!this.isValid) throw new Error('Formula grounding: invalidated material');
    assertScope(this._material as PBRMaterial, scene, mesh);
    const values = defines as unknown as Record<string, unknown>;
    for (const key of forbiddenDefines)
      if (values[key]) throw new Error(`Formula grounding: unsupported native define ${key}`);
    for (const [key, value] of Object.entries(values))
      if (
        value &&
        (/^(?:SHADOW\d|SHADOWCSM|POINTLIGHT\d|SPOTLIGHT\d|AREALIGHT\d|CLUSTLIGHT\d|LIGHTMAPEXCLUDED\d)/.test(
          key,
        ) ||
          key === 'NUM_BONE_INFLUENCERS')
      )
        throw new Error(`Formula grounding: unsupported native define ${key}`);
  }
  hardBindForSubMesh(
    buffer: UniformBuffer,
    scene: Scene,
    _engine: AbstractEngine,
    subMesh: SubMesh,
  ) {
    if (!this.isValid) throw new Error('Formula grounding: invalidated material');
    assertScope(this._material as PBRMaterial, scene, subMesh.getMesh());
    this.poses.bind(buffer);
  }
  getCustomCode(type: string): Record<string, string> | null {
    if (type === 'vertex' || type === 'fragment') assertFormulaGroundingAnchors();
    if (type !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: FORMULA_GROUNDING_GLSL,
      CUSTOM_FRAGMENT_MAIN_BEGIN:
        'vec3 formulaSkyDiffuseBase=vec3(0.0); vec3 formulaSkySpecularBase=vec3(0.0); bool formulaHemi=false;',
      '!#define CUSTOM_LIGHT([0-9]+)_COLOR': `#define CUSTOM_LIGHT$1_COLOR
#ifdef HEMILIGHT$1
formulaHemi=true;
#else
formulaHemi=false;
#endif`,
      '!aggShadow\\+=shadow;numLights\\+=1\\.0;': `if(formulaHemi) {
  formulaSkyDiffuseBase+=info.diffuse*shadow;
#ifdef SPECULARTERM
  formulaSkySpecularBase+=info.specular*shadow;
#endif
}
aggShadow+=shadow;numLights+=1.0;`,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: application,
    };
  }
  dispose() {
    this.dead = true;
  }
}
