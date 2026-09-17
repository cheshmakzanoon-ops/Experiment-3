import { Quat, Vec3 } from '../core/math.ts';
/** World velocities, body-diagonal inertia; renderer-independent state. */
export class RigidBody {
  position = new Vec3();
  orientation = new Quat();
  velocity = new Vec3();
  omega = new Vec3();
  force = new Vec3();
  torque = new Vec3();
  acceleration = new Vec3();
  angularAcceleration = new Vec3();
  inertia = new Vec3(510, 1220, 1080);
  mass = 790;
  private r = new Vec3();
  private torqueScratch = new Vec3();
  private localOmega = new Vec3();
  private localTorque = new Vec3();
  private gyro = new Vec3();
  private iw = new Vec3();
  clear() {
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }
  apply(force: Vec3, point: Vec3) {
    this.force.add(force);
    this.r.copy(point).sub(this.position);
    this.torqueScratch.cross(this.r, force);
    this.torque.add(this.torqueScratch);
  }
  pointVelocity(point: Vec3, out: Vec3) {
    this.r.copy(point).sub(this.position);
    return out.cross(this.omega, this.r).add(this.velocity);
  }
  inverseInertia(v: Vec3, out: Vec3) {
    this.orientation.inverseRotate(v, out);
    out.set(out.x / this.inertia.x, out.y / this.inertia.y, out.z / this.inertia.z);
    return this.orientation.rotate(out, out);
  }
  integrate(dt: number) {
    this.acceleration.copy(this.force).scale(1 / this.mass);
    this.velocity.addScaled(this.acceleration, dt);
    this.position.addScaled(this.velocity, dt);
    this.orientation.inverseRotate(this.omega, this.localOmega);
    this.orientation.inverseRotate(this.torque, this.localTorque);
    this.iw.set(
      this.localOmega.x * this.inertia.x,
      this.localOmega.y * this.inertia.y,
      this.localOmega.z * this.inertia.z,
    );
    this.gyro.cross(this.localOmega, this.iw);
    this.localTorque.sub(this.gyro);
    this.localTorque.set(
      this.localTorque.x / this.inertia.x,
      this.localTorque.y / this.inertia.y,
      this.localTorque.z / this.inertia.z,
    );
    this.orientation.rotate(this.localTorque, this.angularAcceleration);
    this.omega.addScaled(this.angularAcceleration, dt);
    this.orientation.integrateWorld(this.omega, dt);
    if (
      !this.position.finite() ||
      !this.velocity.finite() ||
      !this.omega.finite() ||
      !Number.isFinite(this.orientation.w)
    )
      throw new Error('Non-finite rigid body');
  }
}
