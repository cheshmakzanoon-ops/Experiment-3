import { clamp } from '../core/math.ts';

export type Quality = 'low' | 'medium' | 'high';
export interface GraphicsOptions {
  resolutionScale: number;
  textureSize: 128 | 256 | 512 | 1024;
  shadowSize: 0 | 512 | 1024 | 2048;
  reflections: 'environment' | 'local';
  mirrorQuality: Quality;
  particleDensity: number;
  vegetationDensity: number;
  crowd: boolean;
  bloom: boolean;
  antialias: boolean;
  anisotropy: 1 | 2 | 4 | 8 | 16;
}
export function graphicsPreset(quality: Quality): GraphicsOptions {
  return {
    resolutionScale: quality === 'high' ? 1.25 : quality === 'low' ? 0.75 : 1,
    textureSize: quality === 'low' ? 256 : quality === 'high' ? 1024 : 512,
    shadowSize: quality === 'low' ? 0 : quality === 'high' ? 2048 : 1024,
    reflections: quality === 'high' ? 'local' : 'environment',
    mirrorQuality: quality,
    particleDensity: quality === 'low' ? 0 : quality === 'high' ? 1 : 0.65,
    vegetationDensity: quality === 'low' ? 0.5 : 1,
    crowd: quality !== 'low',
    bloom: quality === 'high',
    antialias: true,
    anisotropy: quality === 'low' ? 2 : quality === 'high' ? 16 : 8,
  };
}
export function validateGraphics(value: unknown, quality: Quality): GraphicsOptions {
  const fallback = graphicsPreset(quality);
  if (!value || typeof value !== 'object') return fallback;
  const p = value as Partial<GraphicsOptions>;
  const number = (v: unknown, f: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : f;
  const choice = <T extends string | number>(v: unknown, options: readonly T[], f: T): T =>
    options.includes(v as T) ? (v as T) : f;
  return {
    resolutionScale: number(p.resolutionScale, fallback.resolutionScale, 0.5, 1.5),
    textureSize: choice(p.textureSize, [128, 256, 512, 1024], fallback.textureSize),
    shadowSize: choice(p.shadowSize, [0, 512, 1024, 2048], fallback.shadowSize),
    reflections: choice(p.reflections, ['environment', 'local'], fallback.reflections),
    mirrorQuality: choice(p.mirrorQuality, ['low', 'medium', 'high'], fallback.mirrorQuality),
    particleDensity: number(p.particleDensity, fallback.particleDensity, 0, 1),
    vegetationDensity: number(p.vegetationDensity, fallback.vegetationDensity, 0, 1),
    crowd: typeof p.crowd === 'boolean' ? p.crowd : fallback.crowd,
    bloom: typeof p.bloom === 'boolean' ? p.bloom : fallback.bloom,
    antialias: typeof p.antialias === 'boolean' ? p.antialias : fallback.antialias,
    anisotropy: choice(p.anisotropy, [1, 2, 4, 8, 16], fallback.anisotropy),
  };
}
/** Render and post-processing use the same physical-pixel budget. */
export function bufferSize(width: number, height: number, ratio: number, maximum: number) {
  if (![width, height, ratio, maximum].every(Number.isFinite) || maximum < 1)
    throw new Error('Invalid render dimensions');
  width = Math.max(1, width);
  height = Math.max(1, height);
  const scale = Math.min(Math.max(0.1, ratio), maximum / width, maximum / height);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
