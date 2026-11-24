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
  private nextOmega = new Vec3();
  private nextOrientation = new Quat();
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
  /** Internal rotor momentum endpoints are expressed in body coordinates.
   * Their change exchanges angular impulse with the chassis symmetrically;
   * fixed rotor momentum contributes gyroscopic torque during the drift. */
  integrate(dt: number, spinStart?: Vec3, spinEnd: Vec3 | undefined = spinStart) {
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
      !this.position.finite() ||
      !this.velocity.finite() ||
      !this.omega.finite() ||
      (spinStart !== undefined && !spinStart.finite()) ||
      (spinEnd !== undefined && !spinEnd.finite()) ||
      !Number.isFinite(q.x + q.y + q.z + q.w) ||
      Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 1e-5
    )
      throw new Error('Invalid rigid-body integration state');
    // Stage the complete step: a failed solve or non-finite candidate must
    // leave the caller's last accepted state and vector identities intact.
    // Scalar candidates keep the same multiply/add order without copying
    // temporary vectors. Public state remains untouched until every candidate
    // has passed the existing finite checks below.
    const inverseMass = 1 / this.mass,
      ax = this.force.x * inverseMass,
      ay = this.force.y * inverseMass,
      az = this.force.z * inverseMass,
      vx = this.velocity.x + ax * dt,
      vy = this.velocity.y + ay * dt,
      vz = this.velocity.z + az * dt,
      px = this.position.x + vx * dt,
      py = this.position.y + vy * dt,
      pz = this.position.z + vz * dt;
    this.orientation.inverseRotate(this.omega, this.localOmega);
    this.orientation.inverseRotate(this.torque, this.localTorque);

    // Kick / gyrostat drift / kick. Moving from hStart to hMid and from
    // hMid to hEnd transfers -deltaH/2 at each boundary. World external torque
    // changes total (chassis + rotor) angular momentum by exactly torque*dt.
    const hx = ((spinStart?.x ?? 0) + (spinEnd?.x ?? 0)) * 0.5,
      hy = ((spinStart?.y ?? 0) + (spinEnd?.y ?? 0)) * 0.5,
      hz = ((spinStart?.z ?? 0) + (spinEnd?.z ?? 0)) * 0.5,
      dx = (spinEnd?.x ?? 0) - (spinStart?.x ?? 0),
      dy = (spinEnd?.y ?? 0) - (spinStart?.y ?? 0),
      dz = (spinEnd?.z ?? 0) - (spinStart?.z ?? 0);
    const x0 = this.localOmega.x + (this.localTorque.x * dt - dx) / (2 * ix);
    const y0 = this.localOmega.y + (this.localTorque.y * dt - dy) / (2 * iy);
    const z0 = this.localOmega.z + (this.localTorque.z * dt - dz) / (2 * iz);
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
      const fx = x - x0 - dt * kx * my * mz - (dt * (hy * mz - hz * my)) / ix;
      const fy = y - y0 - dt * ky * mz * mx - (dt * (hz * mx - hx * mz)) / iy;
      const fz = z - z0 - dt * kz * mx * my - (dt * (hx * my - hy * mx)) / iz;
      if (Math.max(Math.abs(fx), Math.abs(fy), Math.abs(fz)) < tolerance) {
        converged = true;
        break;
      }
      // Analytic inverse of the 3x3 midpoint Jacobian (diagonal entries = 1).
      const a = -0.5 * dt * kx * mz + (0.5 * dt * hz) / ix,
        b = -0.5 * dt * kx * my - (0.5 * dt * hy) / ix;
      const c = -0.5 * dt * ky * mz - (0.5 * dt * hz) / iy,
        d = -0.5 * dt * ky * mx + (0.5 * dt * hx) / iy;
      const e = -0.5 * dt * kz * my + (0.5 * dt * hy) / iz,
        f = -0.5 * dt * kz * mx - (0.5 * dt * hx) / iz;
      const determinant = 1 - d * f - a * (c - d * e) + b * (c * f - e);
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
        throw new Error('Singular rigid-body midpoint solve');
      x -= ((1 - d * f) * fx + (b * f - a) * fy + (a * d - b) * fz) / determinant;
      y -= ((d * e - c) * fx + (1 - b * e) * fy + (b * c - d) * fz) / determinant;
      z -= ((c * f - e) * fx + (a * e - f) * fy + (1 - a * c) * fz) / determinant;
    }
    if (!converged) {
      // The twelfth correction has not yet had its residual tested. Accept
      // it at the same tolerance, without taking a thirteenth Newton step.
      const mx = (x0 + x) * 0.5,
        my = (y0 + y) * 0.5,
        mz = (z0 + z) * 0.5;
      const fx = x - x0 - dt * kx * my * mz - (dt * (hy * mz - hz * my)) / ix;
      const fy = y - y0 - dt * ky * mz * mx - (dt * (hz * mx - hx * mz)) / iy;
      const fz = z - z0 - dt * kz * mx * my - (dt * (hx * my - hy * mx)) / iz;
      if (!(Math.max(Math.abs(fx), Math.abs(fy), Math.abs(fz)) < tolerance))
        throw new Error('Rigid-body midpoint solve did not converge');
    }
    this.midpoint.set((x0 + x) * 0.5, (y0 + y) * 0.5, (z0 + z) * 0.5);
    this.orientation.rotate(this.midpoint, this.midpoint);
    // integrateWorld's normalized quaternion increment is a Cayley rotation.
    // Paired with the midpoint drift, it preserves the WORLD momentum vector,
    // not just its magnitude. Never substitute the endpoint angular velocity.
    const nextQ = this.nextOrientation;
    nextQ.x = q.x;
    nextQ.y = q.y;
    nextQ.z = q.z;
    nextQ.w = q.w;
    nextQ.integrateWorld(this.midpoint, dt);
    nextQ.rotate(
      this.localOmega.set(x - dx / (2 * ix), y - dy / (2 * iy), z - dz / (2 * iz)),
      this.nextOmega,
    );
    // The final kick uses the candidate orientation, in the same order as
    // inverseInertia, without exposing that orientation before validation.
    nextQ.inverseRotate(this.torque, this.localTorque);
    this.localTorque.set(this.localTorque.x / ix, this.localTorque.y / iy, this.localTorque.z / iz);
    nextQ.rotate(this.localTorque, this.localTorque);
    this.nextOmega.addScaled(this.localTorque, dt * 0.5);
    // omega is still the accepted value: no old-omega copy is needed while
    // the step is staged. Preserve subtraction then reciprocal multiplication.
    const inverseDt = 1 / dt,
      alphaX = (this.nextOmega.x - this.omega.x) * inverseDt,
      alphaY = (this.nextOmega.y - this.omega.y) * inverseDt,
      alphaZ = (this.nextOmega.z - this.omega.z) * inverseDt;
    if (
      !Number.isFinite(px + py + pz) ||
      !Number.isFinite(vx + vy + vz) ||
      !this.nextOmega.finite() ||
      !Number.isFinite(ax + ay + az) ||
      !Number.isFinite(alphaX + alphaY + alphaZ) ||
      !Number.isFinite(nextQ.x + nextQ.y + nextQ.z + nextQ.w)
    )
      throw new Error('Non-finite rigid body');
    this.position.set(px, py, pz);
    this.velocity.set(vx, vy, vz);
    this.omega.copy(this.nextOmega);
    this.acceleration.set(ax, ay, az);
    this.angularAcceleration.set(alphaX, alphaY, alphaZ);
    q.x = nextQ.x;
    q.y = nextQ.y;
    q.z = nextQ.z;
    q.w = nextQ.w;
  }
}
