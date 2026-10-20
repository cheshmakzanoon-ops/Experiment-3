import { Quat, Vec3 } from '../core/math.ts';

/** Rates of an authoritative orientation, independent of collision-solver
 * changes to a body's transient pose or velocities. The quaternion logarithm
 * gives the measured WORLD angular displacement over the last step, including
 * simultaneous yaw, pitch and roll. It is a step-average rate, not a second
 * orientation integrator. Shortest-arc sampling requires less than pi radians
 * of physical rotation per step, well beyond the motorcycle substep envelope. */
export class OrientationKinematics {
  private readonly previous = new Quat();
  private readonly previousOmega = new Vec3();
  private previousDt = 0;
  private initialized = false;

  /** dt=0 establishes a placement/recovery baseline without manufacturing a
   * spin or acceleration from an instantaneous change of pose convention. */
  sample(q: Quat, dt: number, omega: Vec3, acceleration: Vec3) {
    const norm = Math.hypot(q.x, q.y, q.z, q.w);
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(norm) || norm < 1e-12)
      throw new Error('Invalid authoritative orientation sample');
    const x = q.x / norm,
      y = q.y / norm,
      z = q.z / norm,
      w = q.w / norm,
      p = this.previous;
    if (dt > 0 && this.initialized) {
      // q_new * inverse(q_previous): left multiplication is a WORLD rotation.
      const dx = -w * p.x + x * p.w - y * p.z + z * p.y,
        dy = -w * p.y + x * p.z + y * p.w - z * p.x,
        dz = -w * p.z - x * p.y + y * p.x + z * p.w,
        dw = w * p.w + x * p.x + y * p.y + z * p.z,
        sine = Math.hypot(dx, dy, dz),
        sign = dw < 0 ? -1 : 1,
        scale =
          sine > 1e-12
            ? (sign * 2 * Math.atan2(sine, Math.abs(dw))) / (sine * dt)
            : (sign * 2) / dt;
      omega.set(dx * scale, dy * scale, dz * scale);
      // Rates belong to the centres of their measured intervals. Their
      // separation is (previousDt + dt)/2, also for an adaptive final substep.
      // A reset has no preceding motion interval from which to infer a rate.
      if (this.previousDt > 0)
        acceleration
          .copy(omega)
          .sub(this.previousOmega)
          .scale(2 / (this.previousDt + dt));
      else acceleration.set(0, 0, 0);
    } else {
      omega.set(0, 0, 0);
      acceleration.set(0, 0, 0);
    }
    p.x = x;
    p.y = y;
    p.z = z;
    p.w = w;
    this.previousOmega.copy(omega);
    this.previousDt = dt > 0 && this.initialized ? dt : 0;
    this.initialized = true;
  }
}
