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
  private midpoint = new Vec3();
  private oldOmega = new Vec3();
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
    const { x: ix, y: iy, z: iz } = this.inertia;
    const q = this.orientation;
    if (
      !Number.isFinite(dt) ||
      dt <= 0 ||
      !Number.isFinite(this.mass) ||
      this.mass <= 0 ||
      !this.inertia.finite() ||
      Math.min(ix, iy, iz) <= 0 ||
      !this.force.finite() ||
      !this.torque.finite() ||
      !this.omega.finite() ||
      !Number.isFinite(q.x + q.y + q.z + q.w) ||
      Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 1e-5
    )
      throw new Error('Invalid rigid-body integration state');
    this.acceleration.copy(this.force).scale(1 / this.mass);
    this.velocity.addScaled(this.acceleration, dt);
    this.position.addScaled(this.velocity, dt);
    this.oldOmega.copy(this.omega);
    this.orientation.inverseRotate(this.omega, this.localOmega);
    this.orientation.inverseRotate(this.torque, this.localTorque);

    // Kick / torque-free drift / kick: external world torque changes angular
    // momentum by exactly torque * dt. The drift solves Euler's equations at
    // the body midpoint, conserving free-spin energy and momentum magnitude.
    const x0 = this.localOmega.x + (this.localTorque.x * dt) / (2 * ix);
    const y0 = this.localOmega.y + (this.localTorque.y * dt) / (2 * iy);
    const z0 = this.localOmega.z + (this.localTorque.z * dt) / (2 * iz);
    const kx = (iy - iz) / ix,
      ky = (iz - ix) / iy,
      kz = (ix - iy) / iz;
    let x = x0,
      y = y0,
      z = z0;
    const tolerance = 2e-12 * Math.max(1, Math.abs(x0), Math.abs(y0), Math.abs(z0));
    let converged = false;
    for (let iteration = 0; iteration < 12; iteration++) {
      const mx = (x0 + x) * 0.5,
        my = (y0 + y) * 0.5,
        mz = (z0 + z) * 0.5;
      const fx = x - x0 - dt * kx * my * mz;
      const fy = y - y0 - dt * ky * mz * mx;
      const fz = z - z0 - dt * kz * mx * my;
      if (Math.max(Math.abs(fx), Math.abs(fy), Math.abs(fz)) < tolerance) {
        converged = true;
        break;
      }
      // Analytic inverse of the 3x3 midpoint Jacobian (diagonal entries = 1).
      const a = -0.5 * dt * kx * mz,
        b = -0.5 * dt * kx * my;
      const c = -0.5 * dt * ky * mz,
        d = -0.5 * dt * ky * mx;
      const e = -0.5 * dt * kz * my,
        f = -0.5 * dt * kz * mx;
      const determinant = 1 - d * f - a * (c - d * e) + b * (c * f - e);
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
        throw new Error('Singular rigid-body midpoint solve');
      x -= ((1 - d * f) * fx + (b * f - a) * fy + (a * d - b) * fz) / determinant;
      y -= ((d * e - c) * fx + (1 - b * e) * fy + (b * c - d) * fz) / determinant;
      z -= ((c * f - e) * fx + (a * e - f) * fy + (1 - a * c) * fz) / determinant;
    }
    if (!converged) throw new Error('Rigid-body midpoint solve did not converge');
    this.midpoint.set((x0 + x) * 0.5, (y0 + y) * 0.5, (z0 + z) * 0.5);
    this.orientation.rotate(this.midpoint, this.midpoint);
    // integrateWorld's normalized quaternion increment is a Cayley rotation.
    // Paired with the midpoint drift, it preserves the WORLD momentum vector,
    // not just its magnitude. Never substitute the endpoint angular velocity.
    this.orientation.integrateWorld(this.midpoint, dt);
    this.orientation.rotate(this.localOmega.set(x, y, z), this.omega);
    this.inverseInertia(this.torque, this.localTorque);
    this.omega.addScaled(this.localTorque, dt * 0.5);
    this.angularAcceleration
      .copy(this.omega)
      .sub(this.oldOmega)
      .scale(1 / dt);
    if (
      !this.position.finite() ||
      !this.velocity.finite() ||
      !this.omega.finite() ||
      !Number.isFinite(q.x + q.y + q.z + q.w)
    )
      throw new Error('Non-finite rigid body');
  }
}
