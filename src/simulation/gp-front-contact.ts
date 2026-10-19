import { clamp } from '../core/math.ts';

/** Authored tolerance for the reduced GP contact model, in metres. This is
 * a short tyre-contact transition, not a measured tyre-deflection curve. */
export const GP_FRONT_TOUCHDOWN_CLEARANCE = 0.002;

/** The existing pitch response settles at 4 /s. Close the final <=0.05 rad
 * at a finite 0.2 rad/s so the tyre can actually touch down instead of
 * approaching the road forever. This is response tuning, not rigid-body
 * pitch dynamics, and introduces no velocity or hidden recovery state. */
export const GP_FRONT_SETTLE_RATE = 0.2;

/** Front-wheel clearance relative to the road from the recorded wheelie
 * pitch. The adapter adds road gradient separately; B.PITCH is not a hill.
 * Roll is around the axle-to-axle direction, so it does not change this gap. */
export function gpFrontWheelClearance(pitch: number, wheelbase: number) {
  return wheelbase * Math.sin(Math.max(0, pitch));
}

/** Geometric steering contact, separate from the solver's quasi-static
 * normal load. In particular, reducing drive can restore that load while
 * the front wheel is still descending. Both steering and its riding cue
 * consume this same deterministic transition from the recorded pitch. */
export function gpFrontSteeringContact(pitch: number, wheelbase: number) {
  return clamp(1 - gpFrontWheelClearance(pitch, wheelbase) / GP_FRONT_TOUCHDOWN_CLEARANCE, 0, 1);
}
