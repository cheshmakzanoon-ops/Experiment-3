import { clamp, smooth } from '../../core/math.ts';

/** Presentation inputs already carried by the motorcycle snapshot. Pitch is
 * the sprung frame's render-space X angle: positive looks down the landing.
 * Compression is the remaining suspension stroke used past the static sag.
 * These are pose signals, not a second physics simulation. */
export interface MotocrossRiderMotionInput {
  standing?: number;
  compression?: number;
  chassisPitch?: number;
}

export interface MotocrossRiderMotion {
  pelvisDrop: number;
  pelvisBack: number;
  torsoPitch: number;
  elbowLift: number;
  gazePitch: number;
}

const finite = (value: number | undefined) => (Number.isFinite(value) ? value! : 0);

/** Re-evaluated from the presented sample, with no frame clock or spring
 * history. A held/replayed pose therefore has identical joints at every LOD.
 * Reference poses 006/009/011 keep knee reserve in flight; 004/018 show a
 * distinct standing hip hinge. Compression uses that reserve on touchdown
 * while the helmet keeps looking toward the next section. */
export function sampleMotocrossRiderMotion(
  pose: MotocrossRiderMotionInput,
  out: MotocrossRiderMotion,
) {
  const standing = clamp(finite(pose.standing), 0, 1),
    stroke = smooth(0.04, 1, finite(pose.compression)),
    brace = stroke * standing,
    pitch = clamp(finite(pose.chassisPitch), -0.85, 0.85);
  // Seated hips remain on the saddle. The standing rider has 17 cm of rise;
  // a maximum 6.5 cm absorption still leaves the hips visibly above it.
  out.pelvisDrop = brace * 0.065;
  out.pelvisBack = brace * 0.012;
  out.torsoPitch = brace * 0.065 - pitch * standing * 0.1;
  out.elbowLift = brace * 0.045;
  // Partial stabilization retains the direction of a steep take-off/landing
  // without rigidly rotating the rider's gaze with the steering head.
  // The discrete airborne flag never changes the pose. The interpolated
  // suspension unloads naturally in flight, avoiding a take-off pose pop.
  out.gazePitch = -pitch * 0.78;
  return out;
}
