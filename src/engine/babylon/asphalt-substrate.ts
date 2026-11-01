import type { Scene } from '@babylonjs/core/scene.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import {
  ASPHALT_TEXELS,
  asphaltTexelMeans,
  surfaceNormalPixels,
  surfacePixels,
} from '../assets/surface-texel-data.ts';
import { AsphaltSubstratePlugin, assertAsphaltShaderAnchors } from './asphalt-substrate-plugin.ts';

/** Unscanned dry surfaceMaterial('asphalt', undefined, false) boundary, qualified
 * independently before canonical Formula activation. Caller owns an exclusive idle
 * preparation lease across allocation, compilation, drawing and disposal.
 * One material and exactly three original 512² textures may serve many chunks;
 * no scene-global texture cache, asset replacement or automatic quality policy.
 */
export function createAsphaltSubstrate(scene: Scene) {
  const engine = scene.getEngine();
  if (
    scene.isDisposed ||
    !scene.useRightHandedSystem ||
    engine.isWebGPU ||
    !('webGLVersion' in engine) ||
    engine.webGLVersion !== 2 ||
    !engine.getCaps().standardDerivatives ||
    !engine.getCaps().supportSRGBBuffers
  )
    throw new Error('Original asphalt requires a live right-handed WebGL2/sRGB scene');
  assertAsphaltShaderAnchors();
  const source = surfacePixels('asphalt');
  const means = asphaltTexelMeans(source);
  const textures: RawTexture[] = [];
  const textureDisposalNotified = new Set<RawTexture>();
  const ownTexture = (texture: RawTexture) => {
    if (textures.includes(texture)) return;
    textures.push(texture);
    texture.onDisposeObservable.addOnce(() => textureDisposalNotified.add(texture));
  };
  let material: PBRMaterial | undefined;
  let disposed = false;
  let released = false;
  // Texture notifications are synchronous; material notifications are deferred.
  // Capture this exclusive allocation interval without depending on a later
  // task to discover a base material whose derived constructor throws.
  const previousMaterials = new Set(scene.materials);
  const textureAdded = scene.onNewTextureAddedObservable.add((texture) => {
    if (texture instanceof RawTexture) ownTexture(texture);
  });
  const releaseTextures = () => {
    if (released) return;
    released = true;
    let failure: unknown,
      failed = false;
    for (const texture of textures) {
      // BaseTexture notifies before ThinTexture releases the actual allocation.
      // A notification alone is not proof of release if a listener throws.
      if (textureDisposalNotified.has(texture) && texture.getInternalTexture() === null) continue;
      try {
        texture.dispose();
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
    if (failed) throw failure;
  };
  try {
    material = new PBRMaterial(
      'Original dry asphalt substrate — road-state/wet/scan layers unported',
      scene,
    );
    const make = (name: string, bytes: Uint8ClampedArray, srgb: boolean) => {
      // Original canvas upload flips Y. WebGL's 2D client-memory upload also
      // honors UNPACK_FLIP_Y_WEBGL; do not additionally flip UVs or normal Y.
      const texture = RawTexture.CreateRGBATexture(
        bytes,
        512,
        512,
        scene,
        true,
        true,
        Texture.TRILINEAR_SAMPLINGMODE,
        0,
        0,
        srgb,
      );
      ownTexture(texture);
      texture.name = name;
      texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
      texture.uScale = texture.vScale = 5 / ASPHALT_TEXELS.microTile;
      texture.anisotropicFilteringLevel = 8;
      texture.gammaSpace = srgb;
      if (texture.getInternalTexture()?._useSRGBBuffer !== srgb)
        throw new Error('Original asphalt: actual texture allocation colour space mismatch');
      return texture;
    };
    const albedo = make('Original asphalt albedo (0.64m tile, hardware sRGB)', source.albedo, true);
    const data = make(
      'Original asphalt R meso / G roughness / B coverage (linear)',
      source.roughness,
      false,
    );
    const normal = make(
      'Original asphalt Sobel tangent normal (linear)',
      surfaceNormalPixels(source.height, 512),
      false,
    );
    material.albedoColor = Color3.White();
    material.albedoTexture = albedo;
    material.bumpTexture = normal;
    normal.level = ASPHALT_TEXELS.normalScale;
    material.roughness = 1;
    material.metallic = 0;
    material.sideOrientation = Material.CounterClockWiseSideOrientation;
    material.backFaceCulling = true;
    material.twoSidedLighting = false;
    material.forceNormalForward = false;
    const plugin = new AsphaltSubstratePlugin(material, data, means);
    const loss = engine.onContextLostObservable.add(() => plugin.invalidate());
    material.onDisposeObservable.addOnce(() => {
      disposed = true;
      engine.onContextLostObservable.remove(loss);
      releaseTextures();
    });
    return {
      material,
      plugin,
      textures: Object.freeze({ albedo, data, normal }),
      get isValid() {
        return !disposed && !scene.isDisposed && plugin.isValid;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        // Material disposal owns its plugin and releases these three textures.
        // The engine-managed BRDF LUT is never among them and stays scene-owned.
        let failure: unknown,
          failed = false;
        try {
          material!.dispose(false, false);
        } catch (error) {
          failure = error;
          failed = true;
        }
        try {
          releaseTextures();
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
        engine.onContextLostObservable.remove(loss);
        if (failed) throw failure;
      },
    };
  } catch (error) {
    // Preserve the original construction failure even if cleanup also fails.
    const ownedMaterials = material
      ? [material]
      : scene.materials.filter((value) => !previousMaterials.has(value));
    for (const value of ownedMaterials) {
      try {
        value.dispose(false, false);
      } catch {
        try {
          // A PBR constructor can fail before its derived disposer fields exist.
          // Its already-registered Material base still owns a UBO/draw wrapper.
          if (!material && scene.materials.includes(value))
            Material.prototype.dispose.call(value, false, false);
        } catch {
          /* original failure retained */
        }
      }
    }
    try {
      releaseTextures();
    } catch {
      /* original failure retained */
    }
    throw error;
  } finally {
    scene.onNewTextureAddedObservable.remove(textureAdded);
  }
}
