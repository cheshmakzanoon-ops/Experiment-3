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

/** Isolated, unscanned dry surfaceMaterial('asphalt', undefined, false) boundary.
 * NO game entry/live scene imports this factory. Caller owns an exclusive idle
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
  let material: PBRMaterial | undefined;
  let disposed = false;
  let released = false;
  // Base constructors register resources before derived construction finishes.
  // Observe only this exclusive allocation interval so a throwing constructor
  // cannot leave an inaccessible partial RawTexture/material in the scene.
  const textureAdded = scene.onNewTextureAddedObservable.add((texture) => {
    if (texture instanceof RawTexture) textures.push(texture);
  });
  const materialAdded = scene.onNewMaterialAddedObservable.add((value) => {
    if (value instanceof PBRMaterial) material = value;
  });
  const releaseTextures = () => {
    if (released) return;
    released = true;
    let failure: unknown;
    for (const texture of textures) {
      try {
        texture.dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  };
  try {
    material = new PBRMaterial(
      'Isolated original asphalt substrate — road/wet/scan layers unported',
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
      if (!textures.includes(texture)) textures.push(texture);
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
        let failure: unknown;
        try {
          material!.dispose(false, false);
        } catch (error) {
          failure = error;
        }
        try {
          releaseTextures();
        } catch (error) {
          failure ??= error;
        }
        engine.onContextLostObservable.remove(loss);
        if (failure !== undefined) throw failure;
      },
    };
  } catch (error) {
    // Preserve the original construction failure even if cleanup also fails.
    try {
      material?.dispose(false, false);
    } catch {
      /* original failure retained */
    }
    try {
      releaseTextures();
    } catch {
      /* original failure retained */
    }
    throw error;
  } finally {
    scene.onNewTextureAddedObservable.remove(textureAdded);
    scene.onNewMaterialAddedObservable.remove(materialAdded);
  }
}
