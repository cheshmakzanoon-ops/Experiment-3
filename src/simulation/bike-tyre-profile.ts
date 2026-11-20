import type { VehicleClass } from './vehicles.ts';

/** Circular crown used by the road tyre mesh, its support point and GP wheel
 * kinematics. A contact that reaches the tread shoulder stays on that edge. */
export interface RoadTyreSection {
  readonly frontHalfWidth: number;
  readonly rearHalfWidth: number;
  readonly rearCrown: number;
}

const raceSection: RoadTyreSection = Object.freeze({
  frontHalfWidth: 0.06,
  rearHalfWidth: 0.1,
  rearCrown: 0.11,
});
const sportSection: RoadTyreSection = Object.freeze({
  frontHalfWidth: 0.06,
  rearHalfWidth: 0.09,
  rearCrown: 0.103,
});
const classicSection: RoadTyreSection = Object.freeze({
  frontHalfWidth: 0.05,
  rearHalfWidth: 0.065,
  rearCrown: 0.08,
});

/** Unloaded tread sections in metres. Wheel radii and the front crown come
 * from the bike definition. Meshes, contact projection and wheel kinematics
 * all need the same shoulder limit. */
export function roadTyreSection(classId: VehicleClass): RoadTyreSection {
  if (classId === 'classic-bike') return classicSection;
  if (classId === 'supersport' || classId === 'road-bike') return sportSection;
  return raceSection;
}
const MAX_TREAD_SINE = Math.sin(1.25);

export function tyreShoulderSine(halfWidth: number, crown: number) {
  return Math.min(MAX_TREAD_SINE, halfWidth / crown);
}

/** Distance from the spin axis to the support point, measured in the wheel
 * plane. axleNormal is the dot product of the spin axis and road normal. */
export function tyreRollingRadius(
  radius: number,
  crown: number,
  shoulderSine: number,
  axleNormal: number,
) {
  const sine = Math.min(shoulderSine, Math.abs(axleNormal));
  return radius - crown * (1 - Math.sqrt(1 - sine * sine));
}
