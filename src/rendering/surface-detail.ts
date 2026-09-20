import { installCircuitFinish, type CircuitFinish } from './circuit-finish.ts';
import * as T from 'three';
import { installStableSurfaceBump } from './materials.ts';
import { Random, clamp } from '../core/math.ts';
import { canvasTexture } from './geometry.ts';

export type SurfaceKind = 'asphalt' | 'grass' | 'gravel' | 'concrete';
const palette: Record<SurfaceKind, readonly [number, number, number]> = {
  asphalt: [79, 81, 83],
  grass: [89, 101, 53],
  gravel: [150, 138, 114],
  concrete: [172, 172, 162],
};
/** Original repeatable texels, not photographs or commercial-game assets.
 * A single seeded height field drives correlated albedo and roughness; the
 * material still receives actual scene illumination rather than baked shading. */
export function surfacePixels(kind: SurfaceKind, size = 512, seed = 1887) {
  if (!Number.isInteger(size) || size < 8 || size > 1024) throw new Error('Invalid surface size');
  const random = new Random(seed),
    height = new Uint8Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4),
    roughness = new Uint8ClampedArray(albedo.length);
  const base = palette[kind];
  const noise = new Float32Array(64 * 64);
  for (let i = 0; i < noise.length; i++) noise[i] = random.next();
  const field = (x: number, y: number, period: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    const u = x - ix,
      v = y - iy;
    const a = u * u * (3 - 2 * u),
      b = v * v * (3 - 2 * v);
    const at = (dx: number, dy: number) => noise[((iy + dy) % period) * 64 + ((ix + dx) % period)];
    return (at(0, 0) * (1 - a) + at(1, 0) * a) * (1 - b) + (at(0, 1) * (1 - a) + at(1, 1) * a) * b;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = y * size + x;
      const grain = random.next();
      // Wrapped stochastic fields tile without the visibly rectangular bumps
      // produced by multiplying horizontal and vertical sine waves.
      const broad =
        field((x / size) * 5, (y / size) * 5, 5) * 0.55 +
        field((x / size) * 17, (y / size) * 17, 17) * 0.3 +
        field((x / size) * 53, (y / size) * 53, 53) * 0.15 -
        0.5;
      const h = clamp(0.4 + grain * 0.4 + broad * 0.08, 0, 1);
      height[at] = Math.round(h * 255);
      const variation =
        kind === 'grass'
          ? (grain - 0.5) * 44 + broad * 10
          : kind === 'gravel'
            ? (grain - 0.5) * 57 + broad * 9
            : (grain - 0.5) * 26 + broad * 4;
      const r = kind === 'asphalt' ? 188 + grain * 43 : 224 + grain * 24;
      for (let c = 0; c < 3; c++) {
        albedo[at * 4 + c] = base[c] + variation;
        roughness[at * 4 + c] = r;
      }
      albedo[at * 4 + 3] = roughness[at * 4 + 3] = 255;
    }
  return { albedo, height, roughness };
}
export function surfaceMaterial(
  kind: SurfaceKind,
  finish?: CircuitFinish,
  waterFilm = false,
): T.MeshStandardMaterial {
  const size = 512,
    data = surfacePixels(kind),
    metres = kind === 'asphalt' ? 0.64 : kind === 'grass' ? 2.5 : kind === 'gravel' ? 0.9 : 3;
  const imageTexture = (bytes: Uint8ClampedArray, color: boolean) => {
    const texture = canvasTexture(size, size, (context) => {
      const image = context.createImageData(size, size);
      image.data.set(bytes);
      context.putImageData(image, 0, 0);
    });
    texture.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    // Circuit ribbons encode five metres per UV unit.
    texture.repeat.setScalar(5 / metres);
    texture.name = `Original ${kind} ${color ? 'albedo' : 'linear data'} (${metres}m tile)`;
    return texture;
  };
  const heights = new Uint8ClampedArray(data.albedo.length);
  for (let i = 0; i < data.height.length; i++) {
    heights[i * 4] = heights[i * 4 + 1] = heights[i * 4 + 2] = data.height[i];
    heights[i * 4 + 3] = 255;
  }
  const parameters: T.MeshStandardMaterialParameters = {
    map: imageTexture(data.albedo, true),
    bumpMap: imageTexture(heights, false),
    roughnessMap: imageTexture(data.roughness, false),
    roughness: 1,
    metalness: 0,
    bumpScale: kind === 'asphalt' ? 0.00045 : kind === 'gravel' ? 0.009 : 0.002,
  };
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
  installStableSurfaceBump(material);
  if (finish || kind !== 'gravel')
    installCircuitFinish(material, finish ?? (kind as CircuitFinish));
  return material;
}
