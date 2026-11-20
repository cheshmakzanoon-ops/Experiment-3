/** Circular crown used by the road tyre mesh, its support point and GP wheel
 * kinematics. A contact that reaches the tread shoulder stays on that edge. */
export const ROAD_TYRE_HALF_WIDTH = Object.freeze({ front: 0.06, rear: 0.1 });
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
