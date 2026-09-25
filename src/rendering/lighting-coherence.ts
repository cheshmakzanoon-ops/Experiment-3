import * as T from 'three';
import { lightingMode, type LightingMode } from './daylight.ts';
import { clamp } from '../core/math.ts';

// Hex inputs are decoded once into Three's linear working colour space.
const direct = {
  day: new T.Color(0xffead0),
  sunset: new T.Color(0xffb76d),
  night: new T.Color(0xc5d4ee),
};
const diffuse = {
  day: new T.Color(0xc3d8f3),
  sunset: new T.Color(0xd5bdad),
  night: new T.Color(0x9eaec8),
};
const ground = {
  day: new T.Color(0x33372e),
  sunset: new T.Color(0x3b3027),
  night: new T.Color(0x242a33),
};
const cloudDirect = new T.Color(0xdce3eb),
  cloudSky = new T.Color(0xbfcbd5);

/** Every car/person/environment shader receives the same actual lights. Heavy
 * overcast attenuates sunset warmth instead of retaining an orange key light
 * below grey clouds. This is an authored palette, not calibrated photometry. */
export function applyCircuitLightPalette(
  sun: T.DirectionalLight,
  hemisphere: T.HemisphereLight,
  cloud: number,
  mode: LightingMode,
) {
  if (!Number.isFinite(cloud)) throw new Error('Invalid lighting coverage');
  lightingMode(mode);
  const cover = clamp(cloud, 0, 1);
  sun.color.copy(direct[mode]).lerp(cloudDirect, mode === 'night' ? cover * 0.12 : cover * 0.88);
  hemisphere.color
    .copy(diffuse[mode])
    .lerp(cloudSky, mode === 'night' ? cover * 0.08 : cover * 0.64);
  hemisphere.groundColor.copy(ground[mode]);
  // The lower solar elevation otherwise offsets contact shadows away from thin
  // aero/kerb geometry. Keep the original light-space texel-snapped projection.
  sun.shadow.normalBias = mode === 'sunset' ? 0.004 : 0.008;
}
