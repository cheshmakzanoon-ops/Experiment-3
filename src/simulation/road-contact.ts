import { Quat, Vec3 } from '../core/math.ts';

/** Road-tangent force and velocity frame. +Z rolls forward and +X is driver
 * left, matching the chassis convention. Normal heave cannot become tire slip.
 * The same basis must resolve contact velocity AND reconstitute tire force.
 */
export class RoadContactFrame {
  readonly forward = new Vec3();
  readonly lateral = new Vec3();
  readonly normal = new Vec3();

  set(orientation: Quat, steering: number, normal: Vec3): boolean {
    if (!normal.finite() || !Number.isFinite(steering) || normal.length() < 1e-8)
      throw new Error('Invalid road-contact frame');
    this.normal.copy(normal).normalize();
    orientation.rotate(this.forward.set(Math.sin(steering), 0, Math.cos(steering)), this.forward);
    this.forward.addScaled(this.normal, -this.forward.dot(this.normal));
    const length = this.forward.length();
    if (!Number.isFinite(length)) throw new Error('Invalid road-contact orientation');
    // A wheel pointing straight into the road has no rolling tangent. Do not
    // substitute Vec3.normalize's arbitrary up-vector as a traction direction.
    if (length < 1e-8) {
      this.forward.set(0, 0, 0);
      this.lateral.set(0, 0, 0);
      return false;
    }
    this.forward.scale(1 / length);
    this.lateral.cross(this.normal, this.forward).normalize();
    return true;
  }
}
