import * as T from 'three';

/** Contact landmarks in the existing procedural glove/boot, in metres.
 * The wrist and ankle are distinct from the cylinder/sole contact: aiming a
 * limb endpoint at the grip or peg makes its hand/foot rotate through it.
 * REF 018/065 show the wrapped grip; REF 018/071 show the forward forefoot. */
export const GP_GLOVE_GRIP = Object.freeze([0, -0.008, 0.058] as const);
export const GP_GLOVE_WRIST = Object.freeze([0, 0, -0.025] as const);
// The cuff's existing distal opening meets the forefoot here. Pivoting higher
// up its tube lets the lower opening swing away from the shoe during crouch.
export const GP_BOOT_ANKLE = Object.freeze([0, -0.014, -0.018] as const);
export const GP_BOOT_PEG = Object.freeze([0, 0.033, 0.09] as const);
/** Radius of the existing rearset cylinder, whose anchor marks its centre. */
export const GP_FOOTPEG_RADIUS = 0.012;

const x = new T.Vector3(),
  y = new T.Vector3(),
  z = new T.Vector3(),
  basis = new T.Matrix4();
// Boot +Y points into the sole, +Z to the toe. A modest toe-down angle leaves
// the ball of the foot on the rearset and the heel raised. The separate cuff
// follows the shin, so this ankle bend never rotates the sleeve off the leg.
const bootFrame = new T.Quaternion().setFromEuler(new T.Euler(0.16, 0, Math.PI));

/** +X spans the actual grip; the knuckles face up in the bike's sprung frame.
 * The axis already includes clip-on cant, steering-axis rake and live steer. */
export function gpGripFrame(axis: T.Vector3, target: T.Quaternion) {
  x.copy(axis).normalize();
  z.set(-x.z, 0, x.x).normalize();
  y.crossVectors(z, x).normalize();
  basis.makeBasis(x, y, z);
  return target.setFromRotationMatrix(basis);
}

export function gpBootFrame(target: T.Quaternion) {
  return target.copy(bootFrame);
}

/** Place the anatomical joint behind the held point, without moving the
 * machine's contact or changing the rider's limb lengths. */
export function gpContactJoint(
  contact: T.Vector3,
  frame: T.Quaternion,
  point: readonly [number, number, number],
  joint: readonly [number, number, number],
  target: T.Vector3,
) {
  return target
    .set(joint[0] - point[0], joint[1] - point[1], joint[2] - point[2])
    .applyQuaternion(frame)
    .add(contact);
}

/** A solved limb owns the joint; its child owns the contact orientation. */
export function gpAttachAtJoint(
  part: T.Group,
  parentFrame: T.Quaternion,
  length: number,
  frame: T.Quaternion,
  joint: readonly [number, number, number],
) {
  part.quaternion.copy(parentFrame).invert().multiply(frame);
  part.position.fromArray(joint).applyQuaternion(part.quaternion).negate();
  part.position.y += length;
}
