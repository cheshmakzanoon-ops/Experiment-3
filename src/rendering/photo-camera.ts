import { clamp } from '../core/math.ts';
import type { GradeProfile } from './broadcast-grade.ts';
export type PhotoView = 'orbit' | 'cockpit' | 'pod' | 'chase' | 'trackside';
export interface PhotoSettings {
  view: PhotoView;
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
  /** Photo-only look (D30): a filter plus vignette, grain and saturation. */
  filter: PhotoFilter;
  vignette: number;
  grain: number;
  saturation: number;
}
export const PHOTO_FILTERS = ['neutral', 'vivid', 'cinematic', 'mono', 'warm', 'cool'] as const;
export type PhotoFilter = (typeof PHOTO_FILTERS)[number];
export const DEFAULT_PHOTO: Readonly<PhotoSettings> = Object.freeze({
  view: 'orbit',
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
  filter: 'neutral',
  vignette: 0.12,
  grain: 0,
  saturation: 1,
});
export function validatePhoto(value: unknown, cars = 1): PhotoSettings {
  const p = value && typeof value === 'object' ? (value as Partial<PhotoSettings>) : {};
  const finite = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
  const count = Number.isFinite(cars) ? clamp(Math.floor(cars), 1, 12) : 1;
  return {
    view:
      p.backdrop !== 'studio' &&
      p.backdrop !== 'headquarters' &&
      (p.view === 'cockpit' || p.view === 'pod' || p.view === 'chase' || p.view === 'trackside')
        ? p.view
        : 'orbit',
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
    filter: PHOTO_FILTERS.includes(p.filter as PhotoFilter) ? (p.filter as PhotoFilter) : 'neutral',
    vignette: finite(p.vignette, 0.12, 0, 0.6),
    grain: finite(p.grain, 0, 0, 0.12),
    saturation: finite(p.saturation, 1, 0, 2),
  };
}

/** Each filter's change to the gameplay grade (contrast and saturation are
 * added and multiplied; tints multiply the profile's own). */
export const PHOTO_FILTER_LOOKS: Readonly<
  Record<
    PhotoFilter,
    {
      contrast: number;
      saturation: number;
      vibrance: number;
      shadow: readonly [number, number, number];
      highlight: readonly [number, number, number];
    }
  >
> = Object.freeze({
  neutral: { contrast: 0, saturation: 1, vibrance: 0, shadow: [1, 1, 1], highlight: [1, 1, 1] },
  vivid: {
    contrast: 0.08,
    saturation: 1.18,
    vibrance: 0.12,
    shadow: [1, 1, 1],
    highlight: [1, 1, 1],
  },
  cinematic: {
    contrast: 0.1,
    saturation: 0.86,
    vibrance: 0,
    shadow: [0.94, 1.0, 1.08],
    highlight: [1.06, 1.0, 0.92],
  },
  mono: { contrast: 0.12, saturation: 0, vibrance: 0, shadow: [1, 1, 1], highlight: [1, 1, 1] },
  warm: {
    contrast: 0.02,
    saturation: 1.02,
    vibrance: 0,
    shadow: [1.03, 1, 0.95],
    highlight: [1.07, 1.01, 0.9],
  },
  cool: {
    contrast: 0.02,
    saturation: 0.98,
    vibrance: 0,
    shadow: [0.95, 1, 1.07],
    highlight: [0.95, 1, 1.07],
  },
});

/** The photo-only grade: the gameplay profile with the chosen look. Gameplay
 * profiles (GRADE_PROFILES) are never changed; grain exists only here. */
export function photoGrade(base: Readonly<GradeProfile>, settings: PhotoSettings): GradeProfile {
  const look = PHOTO_FILTER_LOOKS[settings.filter] ?? PHOTO_FILTER_LOOKS.neutral;
  const times = (a: readonly number[], b: readonly number[]) =>
    [a[0] * b[0], a[1] * b[1], a[2] * b[2]] as const;
  return {
    ...base,
    contrast: base.contrast + look.contrast,
    saturation: base.saturation * look.saturation * settings.saturation,
    vibrance: look.saturation === 0 ? 0 : base.vibrance + look.vibrance,
    shadowTint: times(base.shadowTint, look.shadow),
    highlightTint: times(base.highlightTint, look.highlight),
    vignette: settings.vignette,
    grain: settings.grain,
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
