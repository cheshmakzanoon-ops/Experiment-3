import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import { bumpFragment } from '@babylonjs/core/Shaders/ShadersInclude/bumpFragment.js';
import { decodeExistingPlayerBytes } from './existing-player.ts';
import {
  existingPlayerSourcePointer,
  type ExistingPlayerPrimitiveBinding,
} from './existing-player-primitives.ts';

/** Experimental only: NOT installed by the production importer. Source IDs refer
 * to the hash-verified supplied GLB, not mutable imported texture names. */
export const EXISTING_PLAYER_HEIGHT_SOURCES = Object.freeze([
  ...[74, 81, 82, 83, 86, 91, 92, 93].map((material, i) =>
    Object.freeze({
      material,
      texture: [66, 68, 70, 71, 72, 73, 74, 75][i],
      image: 49,
      name: 'carbon_twill_height',
      scale: 0.00015,
    }),
  ),
  ...[94, 99].map((material, i) =>
    Object.freeze({
      material,
      texture: [76, 80][i],
      image: 51,
      name: 'tyre_scrub_height_16bit',
      scale: 0.0004,
    }),
  ),
]);

const NORMAL_EVALUATION =
  'normalW=perturbNormal(TBN,TEXRD(bumpSampler,vBumpUV+uvOffset).xyz,vBumpInfos.y);';
const replacementPoint = '!' + NORMAL_EVALUATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Algebra from Three r180 bumpmap_pars_fragment (MIT). Deliberately keeps its
 * normalized screen-space surface derivatives, NOT an offline tangent-normal
 * conversion or world-unit gradient. No later lookdev relief gain is included.
 * World-space and view-space versions are related by the rigid view rotation.
 */
export const EXISTING_PLAYER_HEIGHT_GLSL = `
vec3 existingPlayerScalarNormal(vec3 position, vec3 surfaceNormal, vec2 uv, float faceDirection) {
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  float base = existingPlayerHeightScale * texture2D(existingPlayerHeightSampler, uv).r;
  vec2 dh = vec2(
    existingPlayerHeightScale * texture2D(existingPlayerHeightSampler, uv + dx).r - base,
    existingPlayerHeightScale * texture2D(existingPlayerHeightSampler, uv + dy).r - base);
  vec3 sx = normalize(dFdx(position)), sy = normalize(dFdy(position));
  vec3 r1 = cross(sy, surfaceNormal), r2 = cross(surfaceNormal, sx);
  float determinant = dot(sx, r1) * faceDirection;
  vec3 gradient = sign(determinant) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(determinant) * surfaceNormal - gradient);
}`;

/** Probe-only API. Caller exclusively owns an idle scene: install before first
 * material preparation, and toggle/dispose only after prior GPU work completes.
 * This class does not acquire the application's presentation/GPU ownership gate. */
export class ScalarHeightPlugin extends MaterialPluginBase {
  enabled = false;
  private dead = false;
  constructor(
    material: PBRMaterial,
    private texture: BaseTexture | null,
    readonly scale: number,
  ) {
    // Babylon 9.33.1 rebuilds automatic class markers when another plugin is
    // added. A persistent explicit define keeps this sampler/UBO/shader layout
    // out of the effect cache used by otherwise identical non-height materials.
    // It remains true when disabled/disposed: those operations change uniforms,
    // not the compiled resource layout. No global shader/cache mutation.
    super(
      material,
      'ExistingPlayerScalarHeightProbe',
      200,
      { EXISTING_PLAYER_SCALAR_HEIGHT_V1: true },
      true,
      true,
    );
    this.doNotSerialize = true;
  }
  getClassName() {
    return 'ExistingPlayerScalarHeightPlugin';
  }
  setEnabled(enabled: boolean) {
    if (this.dead) throw new Error('Scalar height probe disposed');
    this.enabled = enabled;
    this._material.getScene().resetCachedMaterial();
  }
  getUniforms() {
    return {
      ubo: [
        { name: 'existingPlayerHeightScale', size: 1, type: 'float' },
        { name: 'existingPlayerHeightEnabled', size: 1, type: 'float' },
      ],
      fragment:
        'uniform float existingPlayerHeightScale;\nuniform float existingPlayerHeightEnabled;',
    };
  }
  getSamplers(samplers: string[]) {
    samplers.push('existingPlayerHeightSampler');
  }
  bindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat('existingPlayerHeightScale', this.scale);
    buffer.updateFloat('existingPlayerHeightEnabled', !this.dead && this.enabled ? 1 : 0);
    buffer.setTexture('existingPlayerHeightSampler', this.texture);
  }
  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS:
        'uniform sampler2D existingPlayerHeightSampler;\n' + EXISTING_PLAYER_HEIGHT_GLSL,
      [replacementPoint]: `
if (existingPlayerHeightEnabled > 0.5) {
  float existingPlayerFace = gl_FrontFacing ? 1.0 : -1.0;
  // Three flips its double-sided normal before perturbation. Babylon flips
  // afterwards: compensate here, then let its original final stage run.
  normalW = existingPlayerScalarNormal(vPositionW, normalW * existingPlayerFace,
    vBumpUV, existingPlayerFace) * existingPlayerFace;
} else {
  ${NORMAL_EVALUATION}
}`,
    };
  }
  dispose() {
    // Public plugin API has no detach. Remain inert until owning material dies;
    // never dispose the borrowed original texture or any container resource.
    this.enabled = false;
    this.dead = true;
    this.texture = null;
  }
}

export interface ExistingPlayerHeightAdapter {
  readonly materials: readonly PBRMaterial[];
  readonly scales: readonly number[];
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/** Install disabled on ten validated source-bound materials only. Caller must
 * explicitly enable for an A/B probe. No texture/UV/property is rewritten.
 * GLSL-only and fail-closed against the pinned normal-evaluation hook.
 * Caller must retain exclusive idle-scene ownership across this async install,
 * before first material preparation. Toggle/dispose only with prior GPU work
 * completed and no pending scene draw; this adapter does not acquire that gate. */
export async function createExistingPlayerHeightAdapter(
  raw: Uint8Array<ArrayBuffer>,
  bindings: readonly ExistingPlayerPrimitiveBinding[],
): Promise<ExistingPlayerHeightAdapter> {
  const verified = await decodeExistingPlayerBytes(raw, new AbortController().signal);
  const size = new DataView(verified.buffer, verified.byteOffset).getUint32(12, true);
  const source = JSON.parse(new TextDecoder().decode(verified.subarray(20, 20 + size)));
  if (bumpFragment.shader.split(NORMAL_EVALUATION).length !== 2)
    throw new Error('Scalar height probe: pinned Babylon shader hook changed');
  const selected = EXISTING_PLAYER_HEIGHT_SOURCES.map((entry) => {
    const gltf = source.materials[entry.material];
    const image = source.images[entry.image];
    const matches = bindings.filter(
      ({ source: primitive }) => primitive.material === entry.material,
    );
    const material = matches[0]?.mesh.material;
    if (
      gltf?.normalTexture?.index !== entry.texture ||
      source.textures[entry.texture]?.source !== entry.image ||
      image?.name !== entry.name ||
      image.mimeType !== 'image/png' ||
      gltf.doubleSided !== true ||
      gltf.normalTexture.texCoord ||
      gltf.normalTexture.extensions ||
      !(material instanceof PBRMaterial) ||
      matches.some(({ mesh }) => mesh.material !== material || mesh.isDisposed()) ||
      existingPlayerSourcePointer(material, new RegExp(`^/materials/${entry.material}$`)) !==
        `/materials/${entry.material}` ||
      material._uniformBufferLayoutBuilt ||
      material.shaderLanguage !== 0 ||
      !material.getScene().useRightHandedSystem ||
      !material.twoSidedLighting ||
      material.backFaceCulling ||
      material.forceNormalForward ||
      material.useParallax ||
      material.useParallaxOcclusion ||
      material.detailMap.isEnabled ||
      material.pluginManager?.getPlugin('ExistingPlayerScalarHeightProbe')
    )
      throw new Error('Scalar height probe: source/material contract');
    const texture = material.bumpTexture;
    // Pinned glTF loader marks normals nonColorData and allocates a linear GPU
    // buffer. gammaSpace metadata alone is NOT that allocation: Babylon leaves
    // it true on these textures, while its normal sampler performs no decode.
    if (
      !texture ||
      texture.getInternalTexture()?._useSRGBBuffer !== false ||
      texture.coordinatesIndex !== 0 ||
      existingPlayerSourcePointer(
        texture,
        new RegExp(`^/materials/${entry.material}/normalTexture$`),
      ) !== `/materials/${entry.material}/normalTexture`
    )
      throw new Error('Scalar height probe: linear source texture contract');
    return { material, texture, scale: entry.scale };
  });
  const plugins = selected.map(
    ({ material, texture, scale }) => new ScalarHeightPlugin(material, texture, scale),
  );
  let disposed = false;
  return {
    materials: Object.freeze(selected.map(({ material }) => material)),
    scales: Object.freeze(selected.map(({ scale }) => scale)),
    setEnabled(enabled) {
      if (disposed) throw new Error('Scalar height probe disposed');
      plugins.forEach((plugin) => {
        plugin.enabled = enabled;
      });
      // Caller holds idle GPU ownership; refresh bindings for its next draw.
      selected.forEach(({ material }) => material.getScene().resetCachedMaterial());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      plugins.forEach((plugin) => plugin.dispose());
      selected.forEach(({ material }) => material.getScene().resetCachedMaterial());
    },
  };
}
