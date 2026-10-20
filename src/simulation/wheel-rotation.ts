import { TAU } from '../core/math.ts';
import { M, WHEEL_MOTION_BASE } from './protocol.ts';

export interface WheelRotation {
  /** Bounded phase in radians. */
  rotation: number;
  /** Signed whole turns belonging to the bounded phase. */
  turns: number;
}

/** Integrate the measured solver increment without discarding complete turns.
 * Keep the phase small in double precision before serializing it as Float32.
 * This works across forward/reverse crossings and several turns in one step. */
export function advanceWheelRotation(wheel: WheelRotation, radians: number) {
  const phase = wheel.rotation + radians,
    winding = Math.floor(phase / TAU);
  wheel.rotation = phase - winding * TAU;
  wheel.turns += winding;
}

/** Float32 integers are exact up to 2^24. A session exceeding this very large
 * winding falls back to angular-speed inference instead of publishing a rounded
 * turn count as measured data. The bounded phase still retains its precision. */
export function writeWheelRotation(
  out: Float32Array,
  car: number,
  wheels: readonly WheelRotation[],
) {
  const base = car + WHEEL_MOTION_BASE;
  let mask = 0;
  for (let i = 0; i < 4; i++) {
    const wheel = wheels[i],
      valid =
        Number.isInteger(wheel.turns) &&
        Math.abs(wheel.turns) <= 0xffffff &&
        Number.isFinite(wheel.rotation);
    out[base + M.TURNS_FR + i] = valid ? wheel.turns : 0;
    if (valid) mask |= 1 << i;
  }
  out[base + M.VALID] = mask;
}
