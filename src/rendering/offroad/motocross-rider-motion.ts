import { clamp, smooth } from '../../core/math.ts';
import { MX_RECOVERY } from '../../simulation/offroad/rider-recovery.ts';
import type { MotocrossSightSample } from './motocross-rider-sight.ts';

/** Presentation inputs already carried by the motorcycle snapshot. Pitch is
 * the sprung frame's render-space X angle: positive looks down the landing.
 * Compression is the remaining suspension stroke used past the static sag.
 * These are pose signals, not a second physics simulation. */
export interface MotocrossRiderMotionInput {
  /** The same dirt rig also dresses supermoto entrants. */
  motocrossRace?: boolean;
  /** Recorded intensity of a suspension bottom-out; releases after the hit. */
  mxBottoming?: number;
  /** Seconds since takeoff, zero on the ground. Older inspection poses omit it. */
  mxFlightTime?: number;
  sight?: MotocrossSightSample;
  standing?: number;
  lean?: number;
  speed?: number;
  /** Recorded acceleration in g, positive forward, and chassis roll rate in rad/s. */
  gLong?: number;
  leanRate?: number;
  compression?: number;
  /** Differential wheel stroke. Positive is a fork-first landing. */
  compressionBias?: number;
  /** Total tyre support in multiples of static weight, from the same snapshot. */
  supportG?: number;
  chassisPitch?: number;
  /** Horizontal path direction relative to the actual steered chassis (radians). */
  travelYaw?: number;
  /** One at the assigned start slot, fading out through the launch. */
  startBrace?: number;
  /** Interpolated simulation seconds. Pausing or seeking holds this phase. */
  time?: number;
}

export interface MotocrossRiderMotion {
  hipStance: number;
  chestStance: number;
  chestYaw: number;
  cockpitFold: number;
  cockpitTurn: number;
  pelvisDrop: number;
  pelvisBack: number;
  pelvisSide: number;
  counterRoll: number;
  torsoPitch: number;
  elbowLift: number;
  gazePitch: number;
}

const finite = (value: number | undefined) => (Number.isFinite(value) ? value! : 0);

/** While a whip rotates the wheels across the flight path, the rider keeps
 * sight of the downslope. Resolve the velocity against the projected bike
 * nose. A stopped, reversing or nearly vertical bike has no useful heading. */
export function motocrossTravelYaw(forwardX: number, forwardZ: number, vx = 0, vz = 0) {
  const speed = Math.hypot(vx, vz), nose = Math.hypot(forwardX, forwardZ);
  if (!(speed > 2 && nose > 0.12)) return 0;
  const along = forwardX * vx + forwardZ * vz;
  const forwardShare = along / (speed * nose);
  if (forwardShare <= 0.15) return 0;
  const across = forwardZ * vx - forwardX * vz;
  return clamp(Math.atan2(across, along), -0.65, 0.65) * smooth(2, 8, speed) * smooth(0.15, 0.72, forwardShare);
}

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
    // A short sharp impact loads the arms before the fork reaches full stroke;
    // a slowly compressed fork still moves the hips through its full range.
    load = smooth(1.25, 3.8, finite(pose.supportG)),
    brace = (stroke + 0.32 * load * (1 - stroke)) * standing,
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
  // The visual rider braces against actual traction. A revving engine at
  // the gate or a locked brake in flight carries no fore/aft tyre force.
  const supported = pose.supportG === undefined ? 1 : smooth(0.05, 0.75, finite(pose.supportG));
  const effort = supported * (1 - ready);
  const acceleration = clamp(finite(pose.gLong), -1.15, 0.95) * effort;
  const drive = Math.max(0, acceleration), braking = Math.max(0, -acceleration);
  const mobility = 0.5 + 0.5 * standing;
  out.pelvisBack += (0.052 * braking - 0.033 * drive) * mobility;
  out.torsoPitch += 0.13 * drive - 0.095 * braking;
  out.elbowLift += 0.032 * braking + 0.015 * drive;
  // While the wheels are carrying load the outside peg takes more weight.
  // The hips stay nearer the saddle centre standing, when both knees grip it.
  // A separate transient lets the chassis roll under the torso in a reversal.
  const corner = Math.sin(clamp(finite(pose.lean), -1.1, 1.1))
    * smooth(2.5, 10, Math.abs(finite(pose.speed))) * effort;
  const roll = Math.tanh(finite(pose.leanRate) * 0.7) * effort;
  out.pelvisSide = -0.027 * roll * mobility - corner * (0.055 - 0.022 * standing);
  out.counterRoll = 0.11 * roll * mobility + corner * (0.105 - 0.04 * standing);
  out.hipStance = out.chestStance = standing;
  out.chestYaw = out.cockpitFold = out.cockpitTurn = 0;
  if (pose.motocrossRace) {
    // Knees lift the hips before the chest hinges over the bar. On the
    // way back to the seat the chest opens first; neither end hits a stop.
    out.hipStance = smooth(0, 0.96, standing);
    out.chestStance = smooth(0.08, 1, standing);
    const speed = Math.abs(finite(pose.speed));
    const attention = clamp(finite(pose.sight?.weight), 0, 1) * (1 - ready);
    const terrain = attention * smooth(6, 12, speed);
    const hips = terrain * clamp(finite(pose.sight?.hipPreload), 0, 1);
    const shoulders = terrain * clamp(finite(pose.sight?.shoulderPreload), 0, 1);
    // A short hop barely gathers the legs. A clear jump draws the bike
    // back underneath the rider, then opens the knees as the ground rises.
    const lift = smooth(0.12, 0.85, finite(pose.sight?.clearance));
    const gather = pose.mxFlightTime === undefined
      ? 1
      : smooth(0.025, 0.27, finite(pose.mxFlightTime));
    const flight = terrain * (1 - supported) * Math.min(lift, gather);
    // Let compressed joints take the first hit. The recorded bottoming
    // tail holds some flex as the chassis springs away from the ground.
    const settle = smooth(0.02, 0.90, finite(pose.mxBottoming)) * (1 - ready);
    out.pelvisDrop += out.hipStance * (
      0.052 * hips * (1 - 0.6 * stroke) + 0.035 * flight + 0.036 * settle * (1 - 0.65 * stroke)
    );
    out.pelvisBack += out.hipStance * (0.019 * hips - 0.012 * flight + 0.022 * settle);
    out.torsoPitch += out.chestStance * (0.105 * shoulders + 0.058 * flight + 0.083 * settle);
    out.elbowLift += 0.034 * shoulders + 0.013 * flight + 0.028 * settle;
    out.gazePitch += 0.012 * shoulders + 0.021 * settle;
    // The eyes lead the shoulders into a berm; the hips stay over the
    // pegs. Leave the existing landing sight in charge during a broad whip.
    const previewYaw = clamp(finite(pose.sight?.yaw), -0.62, 0.62) * attention;
    const whip = smooth(0.08, 0.42, Math.abs(finite(pose.travelYaw)));
    out.chestYaw = 0.22 * previewYaw * (1 - 0.65 * whip);
    out.cockpitTurn = clamp(corner + 0.22 * roll + 0.48 * previewYaw, -1, 1);
    out.cockpitFold = clamp(
      0.20 * out.chestStance + 0.32 * brace + 0.19 * load +
      0.20 * braking - 0.10 * drive + 0.22 * shoulders + 0.10 * flight + 0.16 * settle,
      -0.12, 1,
    );
    if (Number.isFinite(pose.time)) {
      const phase = raceNumber * 2.39996323;
      const breath = Math.sin(pose.time! * (1.58 + 0.12 * Math.cos(phase)) + phase) *
        (1 - ready) * (1 - 0.82 * smooth(2, 17, speed));
      // A relaxed chest opens on the inhale; the seated hips stay planted.
      out.torsoPitch -= 0.013 * breath;
      out.elbowLift += 0.006 * breath;
      out.cockpitFold += 0.032 * breath;
    }
  }
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


/** Fraction of a complete stride that one boot spends on the dirt. */
export const MX_RUN_STANCE = 0.36;
export const MX_PUSH_STANCE = 0.53;

export interface MxPushGait {
  phase: number;
  /** Rider-frame travel in metres per full stride. */
  x: number;
  z: number;
  weight: number;
}

/** Fore-aft contact in rider metres. During stance the relative foot travels
 * back exactly as far as the pelvis moves ahead. The return swing has
 * matching endpoint velocities and zero lift speed at heel strike/toe-off.
 * Returns boot pitch in radians, relative to its planted sole. */
export function motocrossRecoveryStep(angle: number, right: boolean, out: { z: number; y: number }, push = false) {
  const cycles = angle / (2 * Math.PI) + (right ? 0.5 : 0);
  const u = cycles - Math.floor(cycles);
  const stance = push ? MX_PUSH_STANCE : MX_RUN_STANCE, length = push ? 1 : MX_RECOVERY.strideLength;
  if (u < stance) {
    out.z = (stance / 2 - u) * length;
    out.y = 0;
    return 0;
  }
  const t = (u - stance) / (1 - stance);
  const smooth = t * t * (3 - 2 * t);
  out.z = length * (stance * (smooth - 0.5) - (1 - stance) * (2 * t * t * t - 3 * t * t + t));
  const lift = Math.sin(t * Math.PI) ** 2;
  out.y = (push ? 0.085 : 0.14) * lift;
  // The stiff MX boot trails toe-down, then lifts its toe for the next plant.
  // Using the lift envelope keeps both angle and angular speed zero at contact.
  return 0.31 * lift * Math.sin(2 * Math.PI * t);
}
