import { clamp } from '../core/math.ts';

/** The GP tow applies to tyre-level longitudinal dynamics, not only the
 * display of drag in a race snapshot. wakeFields() has already bounded the
 * leading machine's speed, heading, separation and lateral overlap. Keep the
 * rider's tuck and another bike's wake multiplicative: both reduce the same
 * drag force, and neither changes tyre grip or brake authority.
 *
 * 18% is the full-overlap upper bound, not a constant race-wide boost.
 * REF 003/006/019/053/058/079/080/089/090/094/099: closing in a pack,
 * then leaving the narrow drafting lane to pass. */
export const GP_MAX_TOW_DRAG_REDUCTION = 0.18;

export function bikeSlipstreamDragScale(tuck: number, tuckDrag: number, tow: number): number {
  const finite = (n: number) => (Number.isFinite(n) ? n : 0);
  const rider = 1 - clamp(finite(tuck), 0, 1) * clamp(finite(tuckDrag), 0, 0.4);
  const following = 1 - GP_MAX_TOW_DRAG_REDUCTION * clamp(finite(tow), 0, 1);
  return rider * following;
}

/** Fraction of the prototype's clean-air wing load in the leader's wake.
 * This is the existing GP approach-planner calibration. Apply it to the same
 * force that loads the fork and rear shock, independently of drag reduction. */
export function gpWingAirflow(wake: number) {
  return 1 - 0.3 * (Number.isFinite(wake) ? clamp(wake, 0, 1) : 0);
}

/** Remaining prototype downforce after bodywork damage and disturbed air.
 * Both the approach planner and the axle loads use the same calibration. */
export function gpWingEfficiency(wake: number, frontHealth: number, floorHealth: number) {
  const front = Number.isFinite(frontHealth) ? clamp(frontHealth, 0, 1) : 1;
  const floor = Number.isFinite(floorHealth) ? clamp(floorHealth, 0, 1) : 1;
  return (0.45 + 0.55 * Math.min(front, floor)) * gpWingAirflow(wake);
}
