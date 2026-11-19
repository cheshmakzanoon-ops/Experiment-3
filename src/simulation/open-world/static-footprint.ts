import { clamp } from '../../core/math.ts';
import type { Structure } from './placement.ts';

/** Four-axis planar chassis/structure contact. Static buildings retain their
 * existing upright footprint proxy and separate finite height test; this is
 * not a new swept or spatial rigid-body solver. Scratch output is reused. */
export class StaticFootprintContact {
  depth = 0;
  nx = 0;
  nz = 0;
  x = 0;
  z = 0;

  intersect(x: number, z: number, ux: number, uz: number, hx: number, hz: number, b: Structure) {
    const vx = uz,
      vz = -ux,
      bx = Math.cos(b.heading),
      bz = Math.sin(b.heading),
      dx = x - b.x,
      dz = z - b.z;
    this.depth = Infinity;
    for (let i = 0; i < 4; i++) {
      const nx = i === 0 ? vx : i === 1 ? ux : i === 2 ? bx : -bz,
        nz = i === 0 ? vz : i === 1 ? uz : i === 2 ? bz : bx,
        distance = dx * nx + dz * nz,
        aRadius = hx * Math.abs(vx * nx + vz * nz) + hz * Math.abs(ux * nx + uz * nz),
        bRadius = b.hx * Math.abs(bx * nx + bz * nz) + b.hz * Math.abs(-bz * nx + bx * nz),
        overlap = aRadius + bRadius - Math.abs(distance);
      if (overlap <= 0) return false;
      if (overlap < this.depth) {
        this.depth = overlap;
        // A coincident centre has two equally short exits. Choose one
        // deterministically; Math.sign(0) must never produce a zero normal.
        const sign = distance < 0 ? -1 : 1;
        this.nx = nx * sign;
        this.nz = nz * sign;
      }
    }
    // Opposed support features, then clamp their midpoint along each box's
    // tangent. This matches the shared chassis contact's single-point proxy
    // without arbitrarily choosing one sampled car corner.
    const ax = featureSign(vx * this.nx + vz * this.nz),
      az = featureSign(ux * this.nx + uz * this.nz),
      sx = featureSign(bx * this.nx + bz * this.nz),
      sz = featureSign(-bz * this.nx + bx * this.nz);
    this.x = (x - ax * hx * vx - az * hz * ux + b.x + sx * b.hx * bx - sz * b.hz * bz) * 0.5;
    this.z = (z - ax * hx * vz - az * hz * uz + b.z + sx * b.hx * bz + sz * b.hz * bx) * 0.5;
    for (let i = 0; i < 4; i++) {
      const nx = i === 0 ? vx : i === 1 ? ux : i === 2 ? bx : -bz,
        nz = i === 0 ? vz : i === 1 ? uz : i === 2 ? bz : bx;
      if (Math.abs(nx * this.nx + nz * this.nz) > 0.95) continue;
      const cx = i < 2 ? x : b.x,
        cz = i < 2 ? z : b.z,
        half = i === 0 ? hx : i === 1 ? hz : i === 2 ? b.hx : b.hz,
        along = (this.x - cx) * nx + (this.z - cz) * nz,
        excess = along - clamp(along, -half, half);
      this.x -= excess * nx;
      this.z -= excess * nz;
    }
    return Number.isFinite(this.depth);
  }
}

function featureSign(value: number) {
  return Math.abs(value) > 1e-7 ? Math.sign(value) : 0;
}
