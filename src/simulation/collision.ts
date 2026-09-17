import { clamp, Vec3 } from '../core/math.ts';
import { trackPoint, type Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';
/** Scratch state is owned per collision solver, not by a mutable module singleton. */
export class CollisionSolver {
  private n = new Vec3();
  private rA = new Vec3();
  private rB = new Vec3();
  private vA = new Vec3();
  private vB = new Vec3();
  private cross = new Vec3();
  private inertia = new Vec3();
  private point = new Vec3();
  private trackPos = trackPoint();
  impulse(a: Vehicle, b: Vehicle | null, contact: Vec3, normal: Vec3, penetration: number) {
    const { rA, rB, vA, vB, cross, inertia } = this,
      A = a.body,
      B = b?.body;
    A.pointVelocity(contact, vA);
    if (B) B.pointVelocity(contact, vB);
    else vB.set(0, 0, 0);
    vA.sub(vB);
    const vn = vA.dot(normal),
      inverseMass = 1 / A.mass + (B ? 1 / B.mass : 0);
    rA.copy(contact).sub(A.position);
    cross.cross(rA, normal);
    A.inverseInertia(cross, inertia);
    let denominator = inverseMass + inertia.dot(cross);
    if (B) {
      rB.copy(contact).sub(B.position);
      cross.cross(rB, normal);
      B.inverseInertia(cross, inertia);
      denominator += inertia.dot(cross);
    }
    if (vn < 0) {
      const j = (-1.08 * vn) / denominator;
      A.velocity.addScaled(normal, j / A.mass);
      cross.cross(rA, normal).scale(j);
      A.inverseInertia(cross, inertia);
      A.omega.add(inertia);
      if (B) {
        B.velocity.addScaled(normal, -j / B.mass);
        cross.cross(rB, normal).scale(-j);
        B.inverseInertia(cross, inertia);
        B.omega.add(inertia);
      }
      vA.addScaled(normal, -vn);
      const speed = vA.length();
      if (speed > 1e-5) {
        vA.scale(1 / speed);
        const jt = Math.min(j * 0.3, speed / inverseMass);
        A.velocity.addScaled(vA, -jt / A.mass);
        if (B) B.velocity.addScaled(vA, jt / B.mass);
      }
      const energy = (0.5 * vn * vn) / denominator;
      a.damage(energy, rA.dot(a.forward) > 0);
      if (b) b.damage(energy, rB.dot(b.forward) > 0);
    }
    const correction = (Math.max(0, penetration - 0.004) * 0.48) / inverseMass;
    A.position.addScaled(normal, correction / A.mass);
    if (B) B.position.addScaled(normal, -correction / B.mass);
  }
  solve(cars: Vehicle[], track: Track) {
    const { n, point, trackPos } = this;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i],
        A = a.body;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j],
          B = b.body;
        if (
          (A.position.x - B.position.x) ** 2 + (A.position.z - B.position.z) ** 2 > 30 ||
          Math.abs(A.position.y - B.position.y) > 1.6
        )
          continue;
        let deepest = 0,
          ax = 0,
          az = 0,
          bx = 0,
          bz = 0;
        for (let u = -1; u <= 1; u += 2)
          for (let v = -1; v <= 1; v += 2) {
            const x = A.position.x + a.forward.x * u * 1.25,
              z = A.position.z + a.forward.z * u * 1.25,
              xx = B.position.x + b.forward.x * v * 1.25,
              zz = B.position.z + b.forward.z * v * 1.25,
              pen = 1.72 - Math.hypot(x - xx, z - zz);
            if (pen > deepest) {
              deepest = pen;
              ax = x;
              az = z;
              bx = xx;
              bz = zz;
            }
          }
        if (deepest > 0) {
          n.set(ax - bx, 0, az - bz);
          if (n.length() < 1e-6) n.set(i % 2 ? 1 : -1, 0, 0);
          else n.normalize();
          point.set((ax + bx) * 0.5, (A.position.y + B.position.y) * 0.5, (az + bz) * 0.5);
          this.impulse(a, b, point, n, deepest);
        }
      }
      const lateral = track.nearest(A.position.x, A.position.z, trackPos),
        boundary =
          lateral < 0
            ? trackPos.width + 11
            : Math.max(trackPos.width + 11, track.pitOffset(trackPos.s) + 5);
      if (Math.abs(lateral) > boundary) {
        const sign = Math.sign(lateral);
        n.set(-trackPos.nx * sign, 0, -trackPos.nz * sign);
        point.set(
          A.position.x + trackPos.nx * sign * 0.85,
          A.position.y,
          A.position.z + trackPos.nz * sign * 0.85,
        );
        this.impulse(a, null, point, n, clamp(Math.abs(lateral) - boundary + 0.85, 0, 5));
      }
    }
  }
}
