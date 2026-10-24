import * as T from 'three';
import type { RiderPose } from './rider.ts';

/** Smoothed body state supplied by `GpRiderBody` (gp-rider-dynamics.ts). When
 * absent, the posture uses the same quantities at equilibrium, so a direct
 * `Rider.ride()` call (studio, tests, held frames) remains a pure function. */
export interface GpRiderBodyState {
  /** 0 riding position .. 1 sat up out of the bubble under braking. */
  sitUp: number;
  /** Inertial fore/aft displacement of the upper body, metres (+ forward). */
  surge: number;
  /** Hip hang-off across the seat, metres (+ left), including flick lead. */
  sway: number;
  /** 0 seated with feet on the pegs .. 1 stopped with both boots down. */
  plant: number;
}

const finite = (value: number | undefined, fallback = 0) =>
  Number.isFinite(value) ? value! : fallback;
const clamp01 = (value: number) => T.MathUtils.clamp(value, 0, 1);

/** Riding speed assumed when a pose omits it (matches gpHeadFrame). */
export const GP_POSTURE_DEFAULT_SPEED = 35;
/** Hang-off normaliser: the GP prototypes' simulated riderOffsetMax. */
const HANG_FULL = 0.28;

/** Equilibrium targets of the spring-damped body, from one snapshot alone.
 * REF_016/052/089: sit up under braking; REF_014/052: boots down at a stop. */
export function gpBodyTargets(pose: RiderPose, out: GpRiderBodyState): GpRiderBodyState {
  const speed = Math.abs(finite(pose.speed, GP_POSTURE_DEFAULT_SPEED)),
    braking = clamp01(finite(pose.braking)),
    gLong = T.MathUtils.clamp(finite(pose.gLong), -2, 2),
    offset = T.MathUtils.clamp(finite(pose.offset), -0.35, 0.35),
    leanRate = T.MathUtils.clamp(finite(pose.leanRate), -3, 3);
  // Feet leave the pegs below a walking pace; a crawl keeps them up.
  out.plant = 1 - T.MathUtils.smoothstep(speed, 0.45, 2.2);
  // Braking at speed lifts the chest into the airflow; at a crawl it does not.
  out.sitUp = Math.sqrt(braking) * T.MathUtils.smoothstep(speed, 3, 12) * (1 - out.plant);
  // Deceleration throws the upper body forward against braced arms; drive
  // pushes it back until the rider loads the tank (handled by `drive`).
  out.surge = T.MathUtils.clamp(-gLong * 0.028, -0.03, 0.045);
  // The hips lead a flick: they cross the seat while the chassis still rolls.
  out.sway = T.MathUtils.clamp(offset + leanRate * 0.035, -0.34, 0.34);
  return out;
}

/** A complete, bounded riding posture in the bike's sprung frame. All angles
 * are radians; the Euler order is the rider's existing 'ZYX' (pitch forward
 * about X first, then yaw about the bike's vertical, then roll about its
 * length). Every value is a pure function of the pose and body state. */
export class GpRiderPosture {
  readonly pelvis = new T.Vector3();
  readonly pelvisAngles = new T.Euler(0, 0, 0, 'ZYX');
  readonly chestAngles = new T.Euler(0, 0, 0, 'ZYX');
  /** Neck direction from the seventh vertebra, bike frame. */
  readonly neck = new T.Vector3();
  /** IK pole offsets from each shoulder/hip, bike frame. Index 0 left. */
  readonly elbowPoles = [new T.Vector3(), new T.Vector3()];
  readonly kneePoles = [new T.Vector3(), new T.Vector3()];
  /** Shoulder protraction in the chest frame, metres. */
  readonly reach = new T.Vector3();
  /** 0 boot on the peg .. 1 boot planted on the road. */
  readonly plant = [0, 0];
  /** Normalised drivers, retained for diagnostics and tests. */
  tuck = 0;
  sitUp = 0;
  hang = 0;
  drive = 0;
  /** 0 open chest .. 1 rounded upper back (lowers the neck base). */
  hunch = 0;
  inside = [0, 0];
  private readonly targets: GpRiderBodyState = { sitUp: 0, surge: 0, sway: 0, plant: 0 };

  /** REF_018/055/085 (tuck), REF_016/052/089 (braking and grid), REF_003/004/
   * 030/031/056/060 (hang-off). Proportions are authored metres and radians,
   * not measurements from those stills. */
  solve(pose: RiderPose, seat: T.Vector3) {
    const body = pose.gpBody ?? gpBodyTargets(pose, this.targets),
      tuck = clamp01(finite(pose.tuck)),
      lean = T.MathUtils.clamp(finite(pose.lean), -1.3, 1.3),
      speed = Math.abs(finite(pose.speed, GP_POSTURE_DEFAULT_SPEED)),
      throttle = clamp01(finite(pose.throttle)),
      braking = clamp01(finite(pose.braking)),
      plant = clamp01(body.plant),
      sitUp = clamp01(body.sitUp) * (1 - plant),
      sway = T.MathUtils.clamp(body.sway, -0.35, 0.35),
      hang = T.MathUtils.clamp(sway / HANG_FULL, -1.2, 1.2),
      bank = Math.abs(lean),
      // Corner intensity combines measured lean and actual hang-off.
      corner = clamp01(Math.max(Math.abs(hang), bank / 0.95)),
      // Exit drive (REF_046/060): weight forward over the tank as the throttle
      // opens with the bike still leaned, and under hard acceleration.
      drive =
        clamp01(throttle * (1 - braking) * T.MathUtils.smoothstep(speed, 3, 10)) *
        clamp01(0.35 + finite(pose.gLong) * 0.9) *
        (1 - tuck * 0.7),
      surge = T.MathUtils.clamp(body.surge, -0.05, 0.06) * (1 - plant);
    this.tuck = tuck;
    this.sitUp = sitUp;
    this.hang = hang;
    this.drive = drive;
    const hangAbs = Math.min(1, Math.abs(hang));
    // Pelvis: back against the seat hump in a tuck, slid back and lifted
    // slightly onto the pegs under braking, forward at the tank on exit and at
    // a stop, and one cheek off the saddle (lower) in a hang-off.
    this.pelvis.copy(seat);
    this.pelvis.x += sway * 0.58;
    this.pelvis.y += -tuck * 0.025 - hangAbs * 0.045 + sitUp * 0.015 - plant * 0.02;
    this.pelvis.z +=
      -tuck * 0.055 * (1 - sitUp) - sitUp * 0.03 + drive * 0.05 + plant * 0.09 + surge * 0.3;
    // Chest pitch from vertical. A GP rider crouches over the tank at any
    // riding speed (the simulated aero tuck only engages above 25 m/s):
    // rolling, crouched, flat tucked back, corner crouch, braking, grid.
    const crouch = T.MathUtils.smoothstep(speed, 2, 12);
    let chestPitch = T.MathUtils.lerp(T.MathUtils.lerp(0.92, 1.22, crouch), 1.42, tuck);
    chestPitch = T.MathUtils.lerp(chestPitch, 1.24, corner * (1 - tuck));
    chestPitch += drive * 0.12 + surge * 1.6;
    chestPitch = T.MathUtils.lerp(chestPitch, 0.94, sitUp);
    chestPitch = T.MathUtils.lerp(chestPitch, 1.08, plant);
    // Body into the corner (REF_056): the chest yaws to the inside, which
    // carries a pitched spine laterally, and rolls the inside shoulder down.
    const into = T.MathUtils.clamp(hang * 0.48 + lean * 0.1, -0.48, 0.48) * (1 - plant),
      chestYaw = into * 0.2 + finite(pose.steer) * 0.25 * (1 - corner),
      chestRoll = -into * 0.12;
    this.chestAngles.set(chestPitch, chestYaw, chestRoll, 'ZYX');
    // The pelvis bends less than the chest and turns its inside knee out.
    const flex = 0.07 + tuck * 0.19 + corner * 0.04 - sitUp * 0.05;
    this.pelvisAngles.set(
      chestPitch - flex,
      chestYaw * 0.35 + hang * 0.22,
      chestRoll * 0.3 - hang * 0.08,
      'ZYX',
    );
    // Neck: continues nearly in line with a tucked, hunched back (chin to the
    // tank; the head itself tips up to look ahead), rises over an upright
    // braking chest, leans to the inside in a turn.
    const neckPitch = T.MathUtils.clamp(chestPitch - 0.16 - sitUp * 0.18 - plant * 0.2, 0.2, 1.32),
      neckRoll = -into * 0.75;
    this.hunch = tuck * (1 - sitUp) + corner * 0.5 * (1 - tuck);
    this.neck.set(0, 1, 0).applyEuler(neckAngles.set(neckPitch, chestYaw * 0.5, neckRoll, 'ZYX'));
    this.reach.set(0, -0.012 * tuck, 0.02 * tuck + 0.015 * drive);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1,
        // Continuous inside/outside weights: no pole jump at zero hang-off.
        inside = T.MathUtils.smoothstep(side * (hang + lean * 0.12), 0.03, 0.6),
        outside = T.MathUtils.smoothstep(-side * (hang + lean * 0.12), 0.03, 0.6);
      this.inside[i] = inside;
      this.plant[i] = plant;
      // Elbows: tucked low beside the tank, braced and a little wide under
      // braking, the inside one out and down, the outside one over the tank.
      const elbow = this.elbowPoles[i]
        .set(side * 0.2, -0.36, -0.03)
        .lerp(tmp.set(side * 0.13, -0.42, 0.04), tuck);
      elbow.lerp(tmp.set(side * 0.34, -0.12, -0.16), sitUp);
      elbow.lerp(tmp.set(side * 0.62, -0.32, 0.02), inside * (1 - tuck));
      elbow.lerp(tmp.set(side * 0.14, -0.1, -0.16), outside * (1 - tuck));
      elbow.lerp(tmp.set(side * 0.55, -0.12, -0.04), plant);
      // Knees: gripping the tank in a tuck and on the outside of a turn,
      // inside knee opened out and down toward the kerb, splayed at a stop.
      const knee = this.kneePoles[i]
        .set(side * 0.24, 0.12, 0.55)
        .lerp(tmp.set(side * 0.09, 0.14, 0.6), tuck);
      knee.lerp(tmp.set(side * 0.06, 0.16, 0.6), outside * (1 - tuck));
      knee.lerp(tmp.set(side * 0.82, -0.3, 0.3), inside * (1 - tuck));
      knee.lerp(tmp.set(side * 0.45, 0.05, 0.55), plant);
    }
    return this;
  }
}
const tmp = new T.Vector3(),
  neckAngles = new T.Euler(0, 0, 0, 'ZYX');

/** Road plane in the rider's (sprung bike) frame for a chassis leaned by
 * `lean` (+ left) rolling on a crown of radius `crown`, with the frame origin
 * `height` above the road when upright. Returns the signed clearance of `p`. */
export function gpRoadClearance(p: T.Vector3, lean: number, height: number, crown: number) {
  const s = Math.sin(lean),
    c = Math.cos(lean);
  return -p.x * s + p.y * c + (height - crown) * c + crown;
}

/** Fold a solved knee/elbow back about its hip–ankle (shoulder–wrist) axis
 * until it clears the road by `margin`. The limb lengths and both end joints
 * are unchanged: `joint` and the IK `pole` turn together about that axis, so
 * re-solving with the returned pole reproduces the folded joint and the bone
 * roll stays continuous as the clamp engages. Returns whether they moved. */
export function gpClearJoint(
  root: T.Vector3,
  end: T.Vector3,
  joint: T.Vector3,
  pole: T.Vector3,
  lean: number,
  height: number,
  crown: number,
  margin: number,
) {
  if (gpRoadClearance(joint, lean, height, crown) >= margin) return false;
  axis.subVectors(end, root);
  const length = axis.length();
  if (length < 1e-6) return false;
  axis.multiplyScalar(1 / length);
  centre.copy(root).addScaledVector(axis, u.subVectors(joint, root).dot(axis));
  u.subVectors(joint, centre);
  const radius = u.length();
  if (radius < 1e-6) return false;
  u.multiplyScalar(1 / radius);
  v.crossVectors(axis, u);
  // Clearance along the circle is A + B cos θ + C sin θ; take the smallest
  // rotation |θ| that reaches the margin (the joint then just touches it).
  const A = gpRoadClearance(centre, lean, height, crown),
    nx = -Math.sin(lean),
    ny = Math.cos(lean),
    B = radius * (u.x * nx + u.y * ny),
    C = radius * (v.x * nx + v.y * ny),
    R = Math.hypot(B, C);
  if (R < 1e-9) return false;
  const phase = Math.atan2(C, B),
    spread = Math.acos(T.MathUtils.clamp((margin - A) / R, -1, 1)),
    wrap = (t: number) => Math.atan2(Math.sin(t), Math.cos(t)),
    low = wrap(phase - spread),
    high = wrap(phase + spread),
    theta = Math.abs(low) < Math.abs(high) ? low : high;
  turn.setFromAxisAngle(axis, theta);
  joint.sub(root).applyQuaternion(turn).add(root);
  pole.sub(root).applyQuaternion(turn).add(root);
  return true;
}
const axis = new T.Vector3(),
  centre = new T.Vector3(),
  u = new T.Vector3(),
  v = new T.Vector3(),
  turn = new T.Quaternion();
