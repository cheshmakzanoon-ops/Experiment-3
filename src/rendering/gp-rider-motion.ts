import * as T from 'three';
import { trackPoint, type Track } from '../simulation/track.ts';
import type { RiderPose } from './rider.ts';

const X = new T.Vector3(1, 0, 0),
  Z = new T.Vector3(0, 0, 1),
  suspension = new T.Quaternion(),
  chassis = new T.Quaternion(),
  sight = new T.Quaternion(),
  sightAngles = new T.Euler();

function finite(value: number | undefined, fallback = 0) {
  return Number.isFinite(value) ? value! : fallback;
}

/** Helmet attitude relative to the solved torso. REF 002/010 show the head
 * turned into the corner with less bank than the machine; REF 018/065 show
 * the neck extending out of the tuck. These are authored presentation limits,
 * not head-tracking measurements from the images.
 *
 * Work in the road frame before removing chassis roll, suspension pitch and
 * torso rotation. Subtracting their Euler angles independently couples the
 * gaze to the torso's tuck and can turn a braking rider's face into the road.
 * Every input is an interpolated snapshot value: held frames, seeks and LOD
 * changes produce exactly the same pose without render-time spring state. */
export function gpHeadFrame(pose: RiderPose, torso: T.Quaternion, target: T.Quaternion) {
  const lean = T.MathUtils.clamp(finite(pose.lean), -1.3, 1.3),
    offset = T.MathUtils.clamp(finite(pose.offset), -0.35, 0.35),
    tuck = T.MathUtils.clamp(finite(pose.tuck), 0, 1),
    braking = T.MathUtils.clamp(finite(pose.braking), 0, 1),
    speed = Math.abs(finite(pose.speed, 35)),
    // At racing speed the bars can countersteer away from the next apex.
    // Follow hang-off/lean there; retain steering-led sight in slow manoeuvres.
    steerWeight = 0.6 * (1 - T.MathUtils.smoothstep(speed, 6, 28)),
    look = T.MathUtils.clamp(
      lean * 0.27 + offset * 0.72 + finite(pose.steer) * steerWeight,
      -0.5,
      0.5,
    ),
    pitch = 0.075 + tuck * 0.065 - braking * 0.025;
  sightAngles.set(pitch, look, -lean * 0.55, 'YXZ');
  sight.setFromEuler(sightAngles);
  suspension.setFromAxisAngle(X, -finite(pose.suspensionPitch));
  chassis.setFromAxisAngle(Z, lean);
  return target.copy(torso).invert().multiply(suspension).multiply(chassis).multiply(sight);
}

/** The inside knee opens progressively as the hips cross the saddle. A sign
 * branch jumps its pole by 10 cm at zero hang-off, visibly snapping the knee
 * in a chicane even though both the simulation and the foot contact are smooth. */
export function gpKneeOut(lean: number, offset: number, side: -1 | 1) {
  const hang = T.MathUtils.clamp(finite(offset), -0.35, 0.35),
    bank = T.MathUtils.clamp(finite(lean), -1.3, 1.3),
    deployment = T.MathUtils.smoothstep(side * (hang + bank * 0.035), 0.005, 0.07);
  return 0.25 + deployment * (0.1 + Math.abs(hang) * 1.4);
}

export interface GpRiderStance {
  /** Pelvis displacement from the seat anchor in the sprung bike frame (m). */
  x: number;
  y: number;
  z: number;
  /** Torso flexion from vertical, roll into the corner and yaw (rad). */
  pitch: number;
  into: number;
  yaw: number;
}

/** GP body position from presented snapshot values only (no clock, history or
 * springs), so held frames, seeks and LOD switches reproduce the same pose.
 *
 * REF 018/056: in the tuck the back is close to horizontal and the helmet sits
 * behind the screen. REF 052/092: hard braking raises the chest only to about
 * 45 degrees with braced arms; the rider does not sit upright. REF 004/027/030/
 * 060: at full lean the hips leave the seat, the chest drops inside the tank
 * and the helmet moves forward towards the inside grip. REF 046/087: on the
 * exit the rider stays low and forward over the tank against wheelie. These
 * are authored presentation targets, not motion-capture measurements. */
export function gpRiderStance(pose: RiderPose, out: GpRiderStance): GpRiderStance {
  const lean = T.MathUtils.clamp(finite(pose.lean), -1.3, 1.3),
    offset = T.MathUtils.clamp(finite(pose.offset), -0.35, 0.35),
    tuck = T.MathUtils.clamp(finite(pose.tuck), 0, 1),
    braking = T.MathUtils.clamp(finite(pose.braking), 0, 1),
    throttle = T.MathUtils.clamp(finite(pose.throttle), 0, 1),
    bank = Math.abs(lean),
    // Hips stay committed while the bike is still leaned on the exit.
    commit = T.MathUtils.smoothstep(bank, 0.12, 0.85),
    // Drive out of a turn: open throttle with lean still on.
    drive = throttle * T.MathUtils.smoothstep(bank, 0.08, 0.45) * (1 - braking),
    // Braking is braced only once out of the tuck; a trail-braking rider
    // already leaned in keeps the chest low towards the apex.
    brace = braking * (1 - tuck) * (1 - commit * 0.65);
  out.x = offset * 0.74;
  out.y = -Math.abs(offset) * 0.2 - tuck * 0.035 - commit * 0.012;
  out.z = braking * 0.055 - tuck * 0.065 + commit * 0.035 + drive * 0.025;
  out.pitch = Math.min(
    1.5,
    T.MathUtils.lerp(1.16, 1.48, tuck) - brace * 0.1 + commit * 0.15 + drive * 0.05,
  );
  out.into = T.MathUtils.clamp(lean * 0.3 + offset * 0.78, -0.48, 0.48);
  out.yaw = T.MathUtils.clamp(offset * 1.15, -0.34, 0.34) + finite(pose.steer) * 0.3;
  return out;
}

/** The inside leg leaves its peg in the last part of a hard straight-line
 * stop (REF 052/092) and returns as the bike rolls in. `turn` is the signed
 * direction of the road ahead (+ left); the result is signed the same way. */
export function gpLegDangle(pose: RiderPose, turn: number) {
  const braking = T.MathUtils.clamp(finite(pose.braking), 0, 1),
    bank = Math.abs(T.MathUtils.clamp(finite(pose.lean), -1.3, 1.3)),
    speed = Math.abs(finite(pose.speed)),
    direction = T.MathUtils.clamp(finite(turn), -1, 1);
  return (
    Math.sign(direction) *
    T.MathUtils.smoothstep(Math.abs(direction), 0.15, 0.5) *
    T.MathUtils.smoothstep(braking, 0.3, 0.75) *
    (1 - T.MathUtils.smoothstep(bank, 0.18, 0.42)) *
    T.MathUtils.smoothstep(speed, 16, 30)
  );
}

/** Small helmet buffeting in the wind blast at very high speed, driven by the
 * recorded front-wheel phase so a held or rewound frame is identical. */
export function gpHelmetBuffet(pose: RiderPose) {
  const speed = Math.abs(finite(pose.speed)),
    phase = finite(pose.phase),
    amount = T.MathUtils.smoothstep(speed, 58, 85) * (1 - finite(pose.tuck) * 0.4);
  return amount === 0
    ? 0
    : amount * (Math.sin(phase * 0.071) * 0.009 + Math.sin(phase * 0.173 + 1.3) * 0.005);
}

const ahead = trackPoint();
/** Signed bend of the road over the next stopping distance (+ left), from the
 * presented station. A pure function of the snapshot: no planner, no history. */
export function gpTurnAhead(track: Track, station: number, speed: number) {
  if (!Number.isFinite(station) || !Number.isFinite(speed)) return 0;
  const reach = T.MathUtils.clamp(Math.abs(speed) * 2.2, 40, 160);
  let turn = 0;
  for (let i = 1; i <= 8; i++) turn += track.at(station + (reach * i) / 8, ahead).curvature;
  // Integrated heading change over the window, saturating near 45 degrees.
  return T.MathUtils.clamp(((turn * reach) / 8) * 1.3, -1, 1);
}
