import * as T from 'three';
import { MX_BOOT_ANKLE, MX_BOOT_PEG } from './motocross-rider-contact.ts';

export interface MxDabSurface {
  /** World-space triangle actually visible at this position, when on the soil ribbon. */
  planeAtWorld(point: T.Vector3, plane: T.Plane): boolean;
}

// The underside spans from the heel to the raised toe. These support points
// include the outer traction blocks and the front/rear edge of the sole.
const SUPPORT = [
  [-0.026, -0.081],
  [0.026, -0.081],
  [-0.047, -0.035],
  [0.047, -0.035],
  [-0.05, 0.085],
  [0.05, 0.085],
  [-0.034, 0.152],
  [0.034, 0.152],
  [0, 0.175],
] as const;
const ankle = new T.Vector3().fromArray(MX_BOOT_ANKLE).sub(new T.Vector3().fromArray(MX_BOOT_PEG));

/** Adapt a free boot to the displayed berm. The support foot can only reach
 * as far as its unscaled leg, and the ankle retains its forward heading.
 * All scratch state is overwritten per pose; a camera cut has no history. */
export class MotocrossDab {
  private readonly plane = new T.Plane();
  private readonly inverse = new T.Matrix4();
  private readonly sample = new T.Vector3();
  private readonly normal = new T.Vector3();
  private readonly turn = new T.Quaternion();
  private readonly partial = new T.Quaternion();

  place(
    ground: MxDabSurface,
    rider: T.Object3D,
    hip: T.Vector3,
    legReach: number,
    down: number,
    contact: T.Vector3,
    boot: T.Quaternion,
  ) {
    if (down <= 0) return;
    rider.updateWorldMatrix(true, false);
    this.sample.copy(contact).applyMatrix4(rider.matrixWorld);
    if (!ground.planeAtWorld(this.sample, this.plane)) return;
    this.plane.applyMatrix4(this.inverse.copy(rider.matrixWorld).invert());
    const n = this.plane.normal;
    const gap = this.plane.distanceToPoint(contact);
    // A foot carried above a crest keeps its rider-authored attitude.
    const weight =
      T.MathUtils.smoothstep(down, 0, 1) * (1 - T.MathUtils.smoothstep(gap, 0.3, 0.48));
    if (weight <= 0) return;
    this.normal.set(0, -1, 0).applyQuaternion(boot);
    this.turn.setFromUnitVectors(this.normal, n);
    const angle = 2 * Math.acos(T.MathUtils.clamp(this.turn.w, -1, 1));
    if (angle > 1e-5)
      boot.premultiply(
        this.partial.identity().slerp(this.turn, weight * Math.min(1, 0.52 / angle)),
      );
    // Distance to the lowest part in this pose; levelling only the middle
    // lets the toe or the outside of a boot disappear through a bank.
    this.normal.copy(n).applyQuaternion(this.turn.copy(boot).invert());
    let lowest = Infinity;
    for (const [x, z] of SUPPORT)
      lowest = Math.min(
        lowest,
        this.normal.x * x +
          this.normal.y * (0.034 - MX_BOOT_PEG[1]) +
          this.normal.z * (z - MX_BOOT_PEG[2]),
      );
    const separation = gap + lowest - 0.004;
    // Intersection of the ankle's path down the terrain normal with a
    // sphere about the hip. The two-bone solver retains a little knee bend.
    this.sample.copy(ankle).applyQuaternion(boot).add(contact).sub(hip);
    const projection = this.sample.dot(n);
    const radial = legReach * legReach - this.sample.lengthSq() + projection * projection;
    const reach = Math.max(0, projection + Math.sqrt(Math.max(0, radial)));
    const travel = T.MathUtils.clamp(separation, -0.24, Math.min(0.24, reach)) * weight;
    contact.addScaledVector(n, -travel);
  }
}
