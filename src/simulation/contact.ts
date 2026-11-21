import { clamp, TAU, Vec3 } from '../core/math.ts';
import { TriangleBVH, VerticalRayColumn, rayHit } from './bvh.ts';
import { RoadSurfaceProjection, type Track, type SurfaceSample } from './track.ts';
import { TireFootprint } from './tire-footprint.ts';
import { apronWidth, GP_KERB_WIDTH } from './gp-course-edges.ts';

/** One authored height law feeds the contact mesh and rendered kerbs. */
export function kerbHeight(s: number, across: number, amount = 1): number {
  const shoulder =
    clamp(across / 0.12, 0, 1) * clamp((GP_KERB_WIDTH * amount - across) / 0.12, 0, 1);
  return amount * shoulder * (0.025 + 0.016 * Math.sin((s * TAU) / 0.65));
}
export function trackHeight(
  y: number,
  bank: number,
  s: number,
  lateral: number,
  width: number,
  amount = 1,
) {
  const across = Math.abs(lateral) - width;
  return (
    y +
    bank * clamp(lateral, -12, 12) +
    (across > 0 && across < 1.1 ? kerbHeight(s, across, amount) : 0)
  );
}

const BANDS = [-35, -12, -4, -1.1, -0.55, 0, 0.18, 100, 0.18, 0, 0.55, 1.1, 4, 12, 35];
const COLUMNS = BANDS.length;

/** Independent static collision ribbon. Narrow bands preserve kerb profiles;
 * vertex normals are shared across triangle seams. No Three.js/DOM dependency.
 */
export class TrackContactMesh {
  readonly bvh: TriangleBVH;
  readonly vertices: Float64Array;
  readonly normals: Float64Array;
  readonly indices: Uint32Array;
  private hit = rayHit();
  private readonly obliqueHit = this.hit;
  private readonly verticalProbes = new WeakMap<
    SurfaceSample,
    {
      origin: Vec3;
      maximum: number;
      column: VerticalRayColumn;
      surfacePoint: RoadSurfaceProjection;
      hit: ReturnType<typeof rayHit>;
    }
  >();
  private readonly tireHit = rayHit();
  private readonly ownershipPoint;
  readonly tireFootprint: TireFootprint;
  constructor(
    readonly track: Track,
    readonly rows = 8192,
  ) {
    const p = { ...track.points[0] };
    this.ownershipPoint = { ...p };
    const bands = BANDS,
      columns = COLUMNS;
    this.vertices = new Float64Array((rows + 1) * columns * 3);
    this.normals = new Float64Array(this.vertices.length);
    this.indices = new Uint32Array(rows * (columns - 1) * 6);
    const n = new Vec3();
    for (let row = 0; row <= rows; row++) {
      track.at((row * track.length) / rows, p);
      const left = track.gpEdges?.at(p.s, -1) ?? 1;
      const right = track.gpEdges?.at(p.s, 1) ?? 1;
      for (let col = 0; col < columns; col++) {
        const amount = col < 7 ? left : right;
        let lateral: number;
        if (col === 0 || col === columns - 1) lateral = bands[col];
        else if (col === 7) lateral = 0;
        else if (col < 7) lateral = -p.width + bands[col];
        else lateral = p.width + bands[col];
        if (amount < 1) {
          const side = col < 7 ? -1 : 1;
          if (col === 2 || col === 12) lateral = side * (p.width + apronWidth(amount));
          if (col === 3 || col === 4 || col === 10 || col === 11)
            lateral = side * (p.width + Math.abs(bands[col]) * Math.max(0.04, amount));
        }
        // Asphalt/paint bands approach the kerb from the inside.
        if (col === 6) lateral = -p.width + 0.18;
        if (col === 8) lateral = p.width - 0.18;
        const inPit = track.inPitLane(p.s, lateral);
        const height = inPit
          ? p.y + p.bank * clamp(lateral, -12, 12)
          : trackHeight(p.y, p.bank, p.s, lateral, p.width, amount);
        const i = (row * columns + col) * 3;
        this.vertices[i] = p.x + p.nx * lateral;
        this.vertices[i + 1] = height;
        this.vertices[i + 2] = p.z + p.nz * lateral;
        const across = Math.abs(lateral) - p.width;
        const sideDerivative =
          !inPit && across > 0 && across < GP_KERB_WIDTH * amount
            ? ((kerbHeight(p.s, across + 0.005, amount) - kerbHeight(p.s, across - 0.005, amount)) /
                0.01) *
              Math.sign(lateral)
            : 0;
        const alongDerivative =
          !inPit && across > 0 && across < GP_KERB_WIDTH * amount
            ? (kerbHeight(p.s + 0.005, across, track.gpEdges?.at(p.s + 0.005, lateral) ?? 1) -
                kerbHeight(p.s - 0.005, across, track.gpEdges?.at(p.s - 0.005, lateral) ?? 1)) /
              0.01
            : 0;
        const bank = Math.abs(lateral) < 12 ? p.bank : 0;
        n.set(
          -p.tx * (p.gradient + alongDerivative) - p.nx * (bank + sideDerivative),
          1,
          -p.tz * (p.gradient + alongDerivative) - p.nz * (bank + sideDerivative),
        ).normalize();
        this.normals.set([n.x, n.y, n.z], i);
        if (row < rows && col < columns - 1) {
          const a = row * columns + col,
            b = a + 1,
            c = a + columns,
            d = c + 1;
          this.indices.set([a, c, b, b, c, d], (row * (columns - 1) + col) * 6);
        }
      }
    }
    this.bvh = new TriangleBVH(this.vertices, this.indices, this.normals, this.ownsContact);
    this.tireFootprint = new TireFootprint(this.bvh);
  }
  /** The 35 m runoff ribbon can cross the opposite leg of a tight hairpin.
   * It is auxiliary terrain, not a second road deck. Preserve the narrower
   * road/kerb (and then its paved shoulder) wherever they own the same layer.
   * Test the actual hit point, not the ray origin or tire centre, so oblique
   * casts and finite-crown contacts retain the same geometric ownership.
   * Core road triangles bypass this entirely; real stacked decks therefore
   * keep their normal nearest-hit rule. */
  private readonly ownsContact = (triangle: number, x: number, y: number, z: number) => {
    const band = Math.floor(triangle / 2) % (COLUMNS - 1);
    if (band >= 3 && band <= 10) return true;
    const p = this.ownershipPoint;
    this.track.nearest(x, z, p, y);
    const lateral = (x - p.x) * p.nx + (z - p.z) * p.nz;
    const amount = this.track.gpEdges?.at(p.s, lateral) ?? 1;
    const protectedWidth =
      p.width +
      (band === 2 || band === 11 ? GP_KERB_WIDTH * Math.max(0.04, amount) : apronWidth(amount)) -
      1e-7;
    // Equal boundaries have a legitimate adjacent inner triangle; the small
    // tolerance only admits floating-point seam error, never a height blend.
    return (x - p.x) ** 2 + (z - p.z) ** 2 >= protectedWidth * protectedWidth;
  };
  cast(origin: Vec3, down: Vec3, maximum: number, surface: SurfaceSample, heightOnly = false) {
    let projection: RoadSurfaceProjection | undefined;
    if (down.x === 0 && down.y === -1 && down.z === 0) {
      let probe = this.verticalProbes.get(surface);
      if (!probe) {
        probe = {
          origin: new Vec3(),
          maximum: NaN,
          column: new VerticalRayColumn(),
          surfacePoint: new RoadSurfaceProjection(),
          hit: rayHit(),
        };
        this.verticalProbes.set(surface, probe);
      }
      this.hit = probe.hit;
      projection = probe.surfacePoint;
      if (
        origin.x === probe.origin.x &&
        origin.y === probe.origin.y &&
        origin.z === probe.origin.z &&
        maximum === probe.maximum
      ) {
        this.bvh.trianglesTested = 0;
      } else {
        this.bvh.raycastVertical(origin, maximum, this.hit, probe.column);
        probe.origin.copy(origin);
        probe.maximum = maximum;
      }
      if (this.hit.triangle === -1) return Infinity;
    } else {
      this.hit = this.obliqueHit;
      if (!this.bvh.raycast(origin, down, maximum, this.hit)) return Infinity;
    }
    // The road geometry is static. Weather, temperature and rubber evolve
    // even while the motorcycle rests on exactly the same triangle.
    if (!heightOnly)
      this.track.sample(this.hit.point.x, this.hit.point.z, surface, this.hit.point.y, projection);
    surface.height = this.hit.point.y;
    surface.normal.copy(this.hit.normal);
    return this.hit.distance;
  }
  /** Centre-ray support plus a width-bounded rounded tire-crown envelope.
   * Returns uncompressed wheel-centre distance along the suspension axis;
   * `point` is the actual force/velocity contact point on the road mesh. */
  castTire(
    origin: Vec3,
    down: Vec3,
    maximum: number,
    radius: number,
    halfWidth: number,
    axle: Vec3,
    surface: SurfaceSample,
    point: Vec3,
  ) {
    const distance = this.cast(origin, down, maximum, surface),
      length = Number.isFinite(distance)
        ? distance - radius / Math.max(0.15, -down.dot(surface.normal))
        : Infinity;
    if (Number.isFinite(distance)) point.copy(this.hit.point);
    if (
      this.tireFootprint.cast(
        origin,
        down,
        maximum,
        radius,
        Math.min(radius, halfWidth),
        axle,
        length,
        this.tireHit,
      )
    ) {
      point.copy(this.tireHit.point);
      this.track.sample(point.x, point.z, surface, point.y);
      surface.height = point.y;
      surface.normal.copy(this.tireHit.normal);
      return this.tireHit.distance;
    }
    return length;
  }
}
