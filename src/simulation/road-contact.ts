import { Quat, Vec3 } from '../core/math.ts';

/** Road-tangent force and velocity frame. +Z rolls forward and +X is driver
 * left, matching the chassis convention. Normal heave cannot become tire slip.
 * The same basis must resolve contact velocity AND reconstitute tire force.
 * The rolling direction is the intersection of the wheel plane with the road
 * plane: projecting the chassis heading onto the road leaves a component along
 * the wheel axle when steering, camber, pitch and banking act together.
 */
export class RoadContactFrame {
  readonly forward = new Vec3();
  readonly lateral = new Vec3();
  readonly normal = new Vec3();
  /** World-space positive spin axis, shared with the rendered wheel pose and
   * wheelAngularMomentum: Ry(steering) Rz(-camber), +X for forward spin. */
  readonly axle = new Vec3();
  /** Road-relative inclination (rad), positive toward road-lateral. */
  inclination = 0;

  set(orientation: Quat, steering: number, normal: Vec3, camber = 0): boolean {
    if (
      !normal.finite() ||
      !Number.isFinite(steering) ||
      !Number.isFinite(camber) ||
      normal.length() < 1e-8
    )
      throw new Error('Invalid road-contact frame');
    this.normal.copy(normal).normalize();
    const c = Math.cos(camber);
    orientation.rotate(
      this.axle.set(c * Math.cos(steering), -Math.sin(camber), -c * Math.sin(steering)),
      this.axle,
    );
    const axleLength = this.axle.length();
    if (!Number.isFinite(axleLength) || axleLength < 1e-8)
      throw new Error('Invalid road-contact orientation');
    this.axle.scale(1 / axleLength);
    this.forward.cross(this.axle, this.normal);
    const length = this.forward.length();
    // atan2 remains well-conditioned near a wheel lying flat; it is equivalent
    // to -asin(axle·normal) for unit axes. Steering is already included, so a
    // bank or a slope produces the same inclination in force and wheel pose.
    this.inclination = Math.atan2(-this.axle.dot(this.normal), length);
    // An axle normal to the road has no unique rolling tangent. Do not
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
