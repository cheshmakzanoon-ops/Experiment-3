import { clamp, lerp } from '../core/math.ts';

/** Original engineering calibration, not measured CFD. Rows are front clearance,
 * columns rear clearance, in metres; entries are dimensionless floor efficiency.
 * Independent pitch samples give a separable incidence correction. Edge queries
 * clamp to the calibration domain instead of extrapolating negative coefficients.
 */
export const RIDE_AXIS = [0, 0.012, 0.025, 0.044, 0.065, 0.075, 0.11, 0.16, 0.25] as const;
export const PITCH_AXIS = [-0.12, -0.06, 0, 0.06, 0.12] as const;
const PITCH_FRONT = [0.8, 0.92, 1, 1.03, 0.88];
const PITCH_REAR = [0.9, 1.025, 1, 0.93, 0.81];
const PITCH_FLOOR = [0.61, 0.85, 1, 0.89, 0.65];
const PITCH_DRAG = [1.18, 1.055, 1, 1.055, 1.18];
const WING_GROUND = [0.88, 0.94, 0.98, 1, 1, 1, 0.985, 0.96, 0.93];

// Authored samples of the documented choking/clearance envelope. Retaining the
// baseline optimum keeps the calibration change separate from arbitrary grip tuning.
const FLOOR = [
  0.3, 0.3, 0.300507355, 0.462353516, 0.79376297, 0.925087738, 1.0, 0.965605416, 0.70468809, 0.3,
  0.3, 0.374912262, 0.65, 0.945072174, 0.999492645, 1.0, 0.925889854, 0.675704114, 0.300507355,
  0.374912262, 0.552716064, 0.851548004, 1.0, 1.0, 1.0, 0.884705905, 0.645648526, 0.462353516, 0.65,
  0.851548004, 1.0, 1.0, 1.0, 0.986097544, 0.827786507, 0.604109383, 0.79376297, 0.945072174, 1.0,
  1.0, 1.0, 1.0, 0.916218872, 0.769126364, 0.561299864, 0.925087738, 0.999492645, 1.0, 1.0, 1.0,
  1.0, 0.884705905, 0.742672583, 0.541994188, 1.0, 1.0, 1.0, 0.986097544, 0.916218872, 0.884705905,
  0.782704538, 0.65704682, 0.479505459, 0.965605416, 0.925889854, 0.884705905, 0.827786507,
  0.769126364, 0.742672583, 0.65704682, 0.551562566, 0.402524224, 0.70468809, 0.675704114,
  0.645648526, 0.604109383, 0.561299864, 0.541994188, 0.479505459, 0.402524224, 0.2937577,
];
export interface AeroCoefficients {
  front: number;
  rear: number;
  floor: number;
  drag: number;
}
const lower = (axis: readonly number[], x: number) => {
  let i = 0;
  while (i < axis.length - 2 && x > axis[i + 1]) i++;
  return i;
};
function sample1(axis: readonly number[], values: readonly number[], x: number) {
  const i = lower(axis, x);
  return lerp(values[i], values[i + 1], clamp((x - axis[i]) / (axis[i + 1] - axis[i]), 0, 1));
}
export function sampleAeroMap(
  frontM: number,
  rearM: number,
  pitchRad: number,
  out: AeroCoefficients,
) {
  if (!Number.isFinite(frontM) || !Number.isFinite(rearM) || !Number.isFinite(pitchRad))
    throw new Error('Non-finite aero map input');
  const i = lower(RIDE_AXIS, frontM),
    j = lower(RIDE_AXIS, rearM),
    n = RIDE_AXIS.length;
  const u = clamp((frontM - RIDE_AXIS[i]) / (RIDE_AXIS[i + 1] - RIDE_AXIS[i]), 0, 1);
  const v = clamp((rearM - RIDE_AXIS[j]) / (RIDE_AXIS[j + 1] - RIDE_AXIS[j]), 0, 1);
  const floor = lerp(
    lerp(FLOOR[i * n + j], FLOOR[i * n + j + 1], v),
    lerp(FLOOR[(i + 1) * n + j], FLOOR[(i + 1) * n + j + 1], v),
    u,
  );
  out.front = sample1(RIDE_AXIS, WING_GROUND, frontM) * sample1(PITCH_AXIS, PITCH_FRONT, pitchRad);
  out.rear = sample1(RIDE_AXIS, WING_GROUND, rearM) * sample1(PITCH_AXIS, PITCH_REAR, pitchRad);
  out.floor =
    floor *
    sample1(PITCH_AXIS, PITCH_FLOOR, pitchRad) *
    Math.exp(-7 * Math.max(0, (frontM + rearM) * 0.5 - RIDE_AXIS[RIDE_AXIS.length - 1]));
  out.drag = sample1(PITCH_AXIS, PITCH_DRAG, pitchRad);
  return out;
}
