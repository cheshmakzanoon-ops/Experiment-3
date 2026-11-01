import {
  ASPHALT_TEXELS,
  asphaltTexelMeans,
  surfaceNormalPixels,
  surfacePixels,
  type SurfaceKind,
} from '../engine/assets/surface-texel-data.ts';
export {
  ASPHALT_TEXELS,
  asphaltMesoPixels,
  asphaltTexelMeans,
  surfaceNormalPixels,
  surfacePixels,
  type SurfaceKind,
} from '../engine/assets/surface-texel-data.ts';
import { installCircuitFinish, type CircuitFinish } from './circuit-finish.ts';
import * as T from 'three';
import { installStableSurfaceBump } from './materials.ts';
import { canvasTexture } from './geometry.ts';
import { ASPHALT_DETAIL, installAsphaltDetail } from './studio/road-detail.ts';

export function surfaceMaterial(
  kind: SurfaceKind,
  finish?: CircuitFinish,
  waterFilm = false,
): T.MeshStandardMaterial {
  const size = 512,
    data = surfacePixels(kind),
    asphalt = kind === 'asphalt',
    metres = asphalt
      ? ASPHALT_TEXELS.microTile
      : kind === 'grass'
        ? 2.5
        : kind === 'gravel'
          ? 0.9
          : 3;
  const imageTexture = (bytes: Uint8ClampedArray, color: boolean, role = '') => {
    const texture = canvasTexture(size, size, (context) => {
      const image = context.createImageData(size, size);
      image.data.set(bytes);
      context.putImageData(image, 0, 0);
    });
    texture.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    // Circuit ribbons encode five metres per UV unit.
    texture.repeat.setScalar(5 / metres);
    texture.name = `Original ${kind} ${role || (color ? 'albedo' : 'linear data')} (${metres}m tile)`;
    return texture;
  };
  const parameters: T.MeshStandardMaterialParameters = {
    map: imageTexture(data.albedo, true),
    roughnessMap: imageTexture(data.roughness, false),
    roughness: 1,
    metalness: 0,
  };
  if (asphalt) {
    // Chip relief as a mip-filtered normal map. The former 0.00045 bump map
    // was flat in every view and, being derivative-based, could only shimmer.
    parameters.normalMap = imageTexture(
      surfaceNormalPixels(data.height, size),
      false,
      'normal (linear data)',
    );
    parameters.normalScale = new T.Vector2(ASPHALT_TEXELS.normalScale, ASPHALT_TEXELS.normalScale);
  } else {
    const heights = new Uint8ClampedArray(data.albedo.length);
    for (let i = 0; i < data.height.length; i++) {
      heights[i * 4] = heights[i * 4 + 1] = heights[i * 4 + 2] = data.height[i];
      heights[i * 4 + 3] = 255;
    }
    parameters.bumpMap = imageTexture(heights, false);
    parameters.bumpScale = kind === 'gravel' ? 0.009 : 0.002;
  }
  // A physical clearcoat lobe is compiled only for water-film surfaces. The wet-road
  // shader drives it back to zero on dry cells, so dry asphalt does not become lacquered.
  const material: T.MeshStandardMaterial = waterFilm
    ? new T.MeshPhysicalMaterial({
        ...parameters,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        ior: 1.333,
      })
    : new T.MeshStandardMaterial(parameters);
  material.userData.weatherSurface = asphalt ? 'paving' : kind;
  installStableSurfaceBump(material);
  if (finish || kind !== 'gravel')
    installCircuitFinish(material, finish ?? (kind as CircuitFinish));
  if (asphalt) {
    const means = asphaltTexelMeans(data);
    installAsphaltDetail(material, means);
    // The scanned asphalt (ground/scanned-ground.ts) cancels this chip tile.
    material.userData.asphaltMeans = { ...means, contrast: ASPHALT_DETAIL.microContrast };
  }
  return material;
}
