import { mod, smooth, Vec3 } from '../src/core/math.ts';
import { Track, type SurfaceSample, type TrackPoint, SURFACE } from '../src/simulation/track.ts';

export type RigKind = 'runway' | 'skidpad' | 'low-kerb' | 'high-kerb' | 'sausage-kerb';
/** Isolated, deterministic laboratory surfaces. The production Vehicle and tire
 * solver run unchanged; only geometry is replaced. A plane has an exact ray hit,
 * and the nonplanar kerbs use a bracketed contact query. This fixture does not
 * certify the circuit BVH, whose independent seam tests cover that code path.
 */
export class DynamicsTrack extends Track {
  override readonly length: number;
  readonly radius = 80;
  constructor(
    readonly kind: RigKind = 'runway',
    readonly waterMm = 0,
  ) {
    super('clear', true);
    this.length = kind === 'skidpad' ? 2 * Math.PI * this.radius : 100000;
    this.windX = this.windZ = 0;
  }
  private height(x: number, z: number) {
    if (!this.kind.endsWith('kerb')) return 0;
    const peak = this.kind === 'low-kerb' ? 0.025 : this.kind === 'high-kerb' ? 0.055 : 0.085;
    // Only one side of the vehicle crosses the raised strip. Smooth shoulders
    // prevent a zero-width discontinuity masquerading as a suspension impulse.
    return peak * smooth(0.25, 0.55, x) * smooth(10, 11.5, z) * (1 - smooth(14, 15.5, z));
  }
  override at(s: number, out: TrackPoint) {
    const circle = this.kind === 'skidpad',
      theta = s / this.radius;
    out.s = mod(s, this.length);
    out.x = circle ? this.radius * (1 - Math.cos(theta)) : 0;
    out.z = circle ? this.radius * Math.sin(theta) : s;
    out.y = 0;
    out.tx = circle ? Math.sin(theta) : 0;
    out.tz = circle ? Math.cos(theta) : 1;
    out.nx = out.tz;
    out.nz = -out.tx;
    out.width = 10000;
    out.bank = 0;
    out.gradient = 0;
    out.curvature = circle ? 1 / this.radius : 0;
    return out;
  }
  override nearest(x: number, z: number, out: TrackPoint) {
    const s = this.kind === 'skidpad' ? Math.atan2(z, this.radius - x) * this.radius : z;
    this.at(s, out);
    return (x - out.x) * out.nx + (z - out.z) * out.nz;
  }
  override sample(x: number, z: number, out: SurfaceSample) {
    out.s = mod(z, this.length);
    out.lateral = x;
    out.width = 10000;
    out.height = this.height(x, z);
    const hx = (this.height(x + 0.001, z) - this.height(x - 0.001, z)) / 0.002;
    const hz = (this.height(x, z + 0.001) - this.height(x, z - 0.001)) / 0.002;
    out.normal.set(-hx, 1, -hz).normalize();
    out.surface = out.height > 0 ? SURFACE.KERB : SURFACE.ASPHALT;
    out.grip = out.height > 0 ? 0.91 : 1;
    out.resistance = 0.015;
    out.water = this.waterMm;
    out.rubber = 0;
    out.marbles = 0;
    out.temp = 32;
    out.pit = false;
    out.cell = 0;
    return out;
  }
  override cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    if (down.y >= -1e-6) return Infinity;
    let lo = 0,
      hi = maximum;
    const difference = (t: number) =>
      origin.y + down.y * t - this.height(origin.x + down.x * t, origin.z + down.z * t);
    if (difference(0) < 0 || difference(hi) > 0) return Infinity;
    if (!this.kind.endsWith('kerb')) hi = -origin.y / down.y;
    else
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) * 0.5;
        if (difference(mid) > 0) lo = mid;
        else hi = mid;
      }
    this.sample(origin.x + down.x * hi, origin.z + down.z * hi, out);
    return hi;
  }
}
