import * as T from 'three';
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
