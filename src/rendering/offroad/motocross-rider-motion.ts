import { clamp, smooth } from '../../core/math.ts';
import { MX_RECOVERY } from '../../simulation/offroad/rider-recovery.ts';

/** Presentation inputs already carried by the motorcycle snapshot. Pitch is
 * the sprung frame's render-space X angle: positive looks down the landing.
 * Compression is the remaining suspension stroke used past the static sag.
 * These are pose signals, not a second physics simulation. */
export interface MotocrossRiderMotionInput {
  standing?: number;
  compression?: number;
  /** Differential wheel stroke. Positive is a fork-first landing. */
  compressionBias?: number;
  chassisPitch?: number;
  /** One at the assigned start slot, fading out through the launch. */
  startBrace?: number;
  /** Interpolated simulation seconds. Pausing or seeking holds this phase. */
  time?: number;
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
  raceNumber = 2,
) {
  const standing = clamp(finite(pose.standing), 0, 1),
    stroke = smooth(0.04, 1, finite(pose.compression)),
    brace = stroke * standing,
    bias = clamp(finite(pose.compressionBias), -1, 1),
    // More load at the hands folds the arms and shifts the hips rearward.
    // A rear-first landing is taken through the pegs and the knees first.
    differential = bias * (0.3 + 0.7 * Math.abs(bias)) * standing,
    pitch = clamp(finite(pose.chassisPitch), -0.85, 0.85);
  // Seated hips remain on the saddle. The standing rider has 17 cm of rise;
  // a maximum 6.5 cm absorption still leaves the hips visibly above it.
  out.pelvisDrop = brace * 0.065 + Math.max(0, -differential) * 0.016;
  out.pelvisBack = brace * 0.012 + differential * 0.026;
  out.torsoPitch = brace * 0.065 - pitch * standing * 0.1 - differential * 0.038;
  out.elbowLift = brace * 0.045 + Math.max(0, differential) * 0.026;
  // Partial stabilization retains the direction of a steep take-off/landing
  // without rigidly rotating the rider's gaze with the steering head.
  // The discrete airborne flag never changes the pose. The interpolated
  // suspension unloads naturally in flight, avoiding a take-off pose pop.
  out.gazePitch = -pitch * 0.78;
  const ready = clamp(finite(pose.startBrace), 0, 1);
  if (ready > 0) {
    // Riders set their weight over the bars before the gate drops. The race
    // number keeps each rider's elbow carriage and breathing phase the same
    // in every LOD and on replay. The hands and boots still use their IK.
    const phase = raceNumber * 2.39996323;
    const carriage = 0.5 + 0.5 * Math.cos(phase);
    const breath = Math.sin(finite(pose.time) * (1.35 + carriage * 0.26) + phase);
    out.pelvisBack -= ready * (0.012 + 0.012 * carriage);
    out.torsoPitch += ready * (0.09 + 0.11 * carriage + 0.012 * breath);
    out.elbowLift += ready * (0.025 + 0.035 * carriage + 0.004 * breath);
    out.gazePitch += ready * (0.018 + 0.025 * carriage);
  }
  return out;
}


/** Fore-aft contact in rider metres. During stance the relative foot travels
 * back exactly as far as the pelvis moves ahead. The return swing has
 * matching endpoint velocities and zero lift speed at heel strike/toe-off. */
export function motocrossRecoveryStep(angle: number, right: boolean, out: { z: number; y: number }) {
  const cycles = angle / (2 * Math.PI) + (right ? 0.5 : 0);
  const u = cycles - Math.floor(cycles);
  const stance = 0.36, length = MX_RECOVERY.strideLength;
  if (u < stance) {
    out.z = (stance / 2 - u) * length;
    out.y = 0;
    return;
  }
  const t = (u - stance) / (1 - stance);
  const smooth = t * t * (3 - 2 * t);
  out.z = length * (stance * (smooth - 0.5) - (1 - stance) * (2 * t * t * t - 3 * t * t + t));
  out.y = 0.14 * Math.sin(t * Math.PI) ** 2;
}
