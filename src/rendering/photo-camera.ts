import { clamp } from '../core/math.ts';
export interface PhotoSettings {
  azimuth: number;
  elevation: number;
  distance: number;
  focalLength: number;
  exposure: number;
  roll: number;
  target: number;
  /** 0 whole car, 1 helmet, 2 controls, 3 front wheel, 4 front wing, 5 rear aero, 6 HQ arrival. */
  focusSubject: number;
  backdrop: 'circuit' | 'studio' | 'headquarters';
  depthOfField: boolean;
  focusMode: 'subject' | 'manual';
  focusDistance: number;
  fStop: number;
  survey: 'off' | 'split' | 'points';
  split: number;
}
export const DEFAULT_PHOTO: Readonly<PhotoSettings> = Object.freeze({
  azimuth: 38,
  elevation: 12,
  distance: 8.5,
  focalLength: 38,
  exposure: 0,
  roll: 0,
  target: 0,
  focusSubject: 0,
  backdrop: 'circuit',
  depthOfField: false,
  focusMode: 'subject',
  focusDistance: 8.5,
  fStop: 4,
  survey: 'off',
  split: 0.5,
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
    focusSubject: Math.round(finite(p.focusSubject, 0, 0, 6)),
    backdrop: p.backdrop === 'studio' || p.backdrop === 'headquarters' ? p.backdrop : 'circuit',
    depthOfField: p.depthOfField === true,
    focusMode: p.focusMode === 'manual' ? 'manual' : 'subject',
    focusDistance: finite(p.focusDistance, 8.5, 0.5, 250),
    fStop: finite(p.fStop, 4, 1.4, 22),
    survey:
      p.backdrop !== 'studio' &&
      p.backdrop !== 'headquarters' &&
      (p.survey === 'split' || p.survey === 'points')
        ? p.survey
        : 'off',
    split: finite(p.split, 0.5, 0.1, 0.9),
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

/** A bounded artistic screen-space lens. Focus is real camera-space depth;
 * aperture is an approximate BokehPass response, not a calibrated lens model. */
export function photoLens(settings: PhotoSettings, subjectDepth: number) {
  const focus =
    settings.focusMode === 'subject' && Number.isFinite(subjectDepth)
      ? clamp(subjectDepth, 0.5, 250)
      : settings.focusDistance;
  return {
    focus,
    aperture: clamp((0.0016 * (settings.focalLength / 50)) / settings.fStop, 0, 0.004),
    maxblur: 0.016,
  };
}
