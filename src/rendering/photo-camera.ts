import { clamp } from '../core/math.ts';
export interface PhotoSettings {
  azimuth: number;
  elevation: number;
  distance: number;
  focalLength: number;
  exposure: number;
  roll: number;
  target: number;
  backdrop: 'circuit' | 'studio';
}
export const DEFAULT_PHOTO: Readonly<PhotoSettings> = Object.freeze({
  azimuth: 38,
  elevation: 12,
  distance: 8.5,
  focalLength: 38,
  exposure: 0,
  roll: 0,
  target: 0,
  backdrop: 'circuit',
});
export function validatePhoto(value: unknown, cars = 1): PhotoSettings {
  const p = value && typeof value === 'object' ? (value as Partial<PhotoSettings>) : {};
  const finite = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
  const count = Number.isFinite(cars) ? clamp(Math.floor(cars), 1, 12) : 1;
  return {
    azimuth: finite(p.azimuth, 38, -180, 180),
    elevation: finite(p.elevation, 12, 0, 75),
    distance: finite(p.distance, 8.5, 2, 45),
    focalLength: finite(p.focalLength, 38, 18, 150),
    exposure: finite(p.exposure, 0, -2, 2),
    roll: finite(p.roll, 0, -45, 45),
    target: Math.round(finite(p.target, 0, 0, count - 1)),
    backdrop: p.backdrop === 'studio' ? 'studio' : 'circuit',
  };
}
/** Vertical field of view for a 24 mm-high full-frame sensor; units are degrees. */
export function photoFov(focalLength: number) {
  if (!Number.isFinite(focalLength) || focalLength <= 0) throw new Error('Invalid focal length');
  return (2 * Math.atan(12 / focalLength) * 180) / Math.PI;
}
export function photoOffset(settings: PhotoSettings): readonly [number, number, number] {
  const a = (settings.azimuth * Math.PI) / 180,
    e = (settings.elevation * Math.PI) / 180;
  return [
    Math.sin(a) * Math.cos(e) * settings.distance,
    0.15 + Math.sin(e) * settings.distance,
    Math.cos(a) * Math.cos(e) * settings.distance,
  ];
}
