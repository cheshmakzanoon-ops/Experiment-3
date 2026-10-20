/** Express signed tyre slip in the wheel's direction of road travel. The
 * tyre solver keeps a fixed wheel-forward sign: a reverse lockup is positive
 * slip, whereas reverse wheelspin is negative. ABS/TC need the same meaning
 * in either direction: positive for wheelspin, negative for braking slip.
 *
 * Contact velocity must be projected onto that wheel's road-tangent frame,
 * including steering and chassis angular motion. Near rest, use a spinning
 * wheel's direction, then the requested drive direction; no slip magnitude
 * is clamped and a genuinely locked rolling wheel remains a full lockup. */
export function drivingSlip(
  slip: number,
  contactSpeed: number,
  wheelSpeed: number,
  driveDirection: number,
) {
  const direction =
    Math.abs(contactSpeed) > 0.1
      ? contactSpeed
      : Math.abs(wheelSpeed) > 0.1
        ? wheelSpeed
        : driveDirection;
  return slip * (direction < 0 ? -1 : 1);
}
