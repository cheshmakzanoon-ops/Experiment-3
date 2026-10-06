import * as T from 'three';
import type { LightingMode } from './daylight.ts';
import { clamp } from '../core/math.ts';

// Hex inputs are decoded once into Three's linear working colour space.
const direct = {
  // 5600-5800 K midday key: sunlit asphalt reads warm-neutral (B/R 0.88-0.95).
  day: new T.Color(0xfff0dc),
  // Golden hour key (ART_BIBLE_A §1.2: #ffb26b-#ffc58e).
  sunset: new T.Color(0xffb26b),
  // Metal-halide floodlight white, only slightly cool.
  night: new T.Color(0xe2e9f6),
};
// The hemisphere is the minor, art-directed part of the fill; the sky IBL
// (environment) carries most of it, so shadows take the colour of the sky.
const diffuse = {
  day: new T.Color(0x8fb6ea),
  // Violet-blue dusk skylight (P2: shaded asphalt #2e3550-#3a4660). Green stays
  // above red: added to the orange key, a magenta fill turns lit asphalt mauve.
  sunset: new T.Color(0xa4b4ee),
  night: new T.Color(0x9eaec8),
};
// Warm bounce from asphalt and verges.
const ground = {
  day: new T.Color(0x4a4237),
  sunset: new T.Color(0x3b3027),
  night: new T.Color(0x242a33),
};
const cloudDirect = new T.Color(0xdce3eb),
  cloudSky = new T.Color(0xbfcbd5);

// A type-only import of daylight.ts keeps this palette importable by daylight's
// PMREM ground capture without a module cycle.
function checkedMode(mode: LightingMode) {
  if (mode !== 'day' && mode !== 'sunset' && mode !== 'night')
    throw new Error('Invalid circuit lighting mode');
  return mode;
}

/** The key (sun), hemisphere sky and hemisphere ground colours of `mode` under
 * `cloud` cover, written into `out` (linear working space). */
export function circuitLightColors(
  cloud: number,
  value: LightingMode,
  out = { sun: new T.Color(), sky: new T.Color(), ground: new T.Color() },
) {
  if (!Number.isFinite(cloud)) throw new Error('Invalid lighting coverage');
  const mode = checkedMode(value);
  const cover = clamp(cloud, 0, 1);
  out.sun.copy(direct[mode]).lerp(cloudDirect, mode === 'night' ? cover * 0.12 : cover * 0.88);
  out.sky.copy(diffuse[mode]).lerp(cloudSky, mode === 'night' ? cover * 0.08 : cover * 0.64);
  out.ground.copy(ground[mode]);
  return out;
}

/** Every car/person/environment shader receives the same actual lights. Heavy
 * overcast attenuates sunset warmth instead of retaining an orange key light
 * below grey clouds. This is an authored palette, not calibrated photometry. */
export function applyCircuitLightPalette(
  sun: T.DirectionalLight,
  hemisphere: T.HemisphereLight,
  cloud: number,
  mode: LightingMode,
) {
  circuitLightColors(cloud, mode, {
    sun: sun.color,
    sky: hemisphere.color,
    ground: hemisphere.groundColor,
  });
  // The lower solar elevation otherwise offsets contact shadows away from thin
  // aero/kerb geometry. Keep the original light-space texel-snapped projection.
  sun.shadow.normalBias = mode === 'sunset' ? 0.004 : 0.008;
}
