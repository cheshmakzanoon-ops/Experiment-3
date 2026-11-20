import * as T from 'three';
import { clamp } from '../../core/math.ts';
import { sharedMaterials } from './materials.ts';

const POSES = 20,
  CYCLE = 1.24,
  PARK = 0.035;
interface Screen {
  baseZ: number;
  topZ: number;
  rise: number;
  halfWidth: number;
}
/** Index actual upward-facing glass triangles along the screen. A rounded
 * roadster pane and a curved bonded windscreen use the same projection. */
function glassSampler(glass: T.BufferGeometry, screen: Screen) {
  const p = glass.getAttribute('position'),
    n = glass.getAttribute('normal'),
    index = glass.index;
  const groups = glass.groups.length
    ? glass.groups
    : [{ start: 0, count: index?.count ?? p.count }];
  const bins = Array.from({ length: 32 }, () => [] as number[]);
  const bucket = (z: number) =>
    clamp(Math.floor(((screen.baseZ - z) / (screen.baseZ - screen.topZ)) * 32), 0, 31);
  const id = (i: number) => (index ? index.getX(i) : i);
  for (const group of groups)
    for (let j = group.start; j < group.start + group.count; j += 3) {
      const a = id(j),
        b = id(j + 1),
        c = id(j + 2);
      if (Math.max(n.getY(a), n.getY(b), n.getY(c)) < 0.05) continue;
      const high = Math.max(p.getZ(a), p.getZ(b), p.getZ(c)),
        low = Math.min(p.getZ(a), p.getZ(b), p.getZ(c));
      if (high < screen.topZ || low > screen.baseZ) continue;
      for (let bin = bucket(high); bin <= bucket(low); bin++) bins[bin].push(a, b, c);
    }
  return (x: number, z: number, point: T.Vector3, normal: T.Vector3) => {
    let best = -Infinity;
    const tris = bins[bucket(z)];
    for (let j = 0; j < tris.length; j += 3) {
      const a = tris[j],
        b = tris[j + 1],
        c = tris[j + 2],
        ax = p.getX(a),
        az = p.getZ(a);
      const bx = p.getX(b) - ax,
        bz = p.getZ(b) - az,
        cx = p.getX(c) - ax,
        cz = p.getZ(c) - az;
      const area = bx * cz - bz * cx;
      if (Math.abs(area) < 1e-10) continue;
      const u = ((x - ax) * cz - (z - az) * cx) / area,
        v = (bx * (z - az) - bz * (x - ax)) / area,
        w = 1 - u - v;
      if (Math.min(u, v, w) < -1e-6) continue;
      const y = w * p.getY(a) + u * p.getY(b) + v * p.getY(c);
      if (y <= best) continue;
      best = y;
      point.set(x, y, z);
      normal
        .set(
          w * n.getX(a) + u * n.getX(b) + v * n.getX(c),
          w * n.getY(a) + u * n.getY(b) + v * n.getY(c),
          w * n.getZ(a) + u * n.getZ(b) + v * n.getZ(c),
        )
        .normalize();
    }
    return Number.isFinite(best);
  };
}

export class FestivalWipers {
  readonly mesh: T.Mesh<T.BufferGeometry, T.Material>;
  /** Pivot x, lower z, projected z/metre along glass, outer blade radius. */
  readonly footprint: T.Vector4;
  /** Park angle, full sweep angle, periods since last stroke, preceding interval. */
  readonly motion = new T.Vector4(PARK, 0, 8, 4);
  private previous = -1;
  private cycle = -Infinity;
  private lastStroke = -Infinity;
  private interval = 4;
  private constructor(
    private poses: Float32Array[],
    private normals: Float32Array[],
    indices: number[],
    footprint: T.Vector4,
    sweep: number,
  ) {
    this.footprint = footprint;
    this.motion.y = sweep;
    const g = new T.BufferGeometry();
    g.setAttribute(
      'position',
      new T.BufferAttribute(poses[0].slice(), 3).setUsage(T.DynamicDrawUsage),
    );
    g.setAttribute(
      'normal',
      new T.BufferAttribute(normals[0].slice(), 3).setUsage(T.DynamicDrawUsage),
    );
    g.setIndex(indices);
    const box = new T.Box3();
    const tmp = new T.Vector3();
    for (const pose of poses)
      for (let i = 0; i < pose.length; i += 3) box.expandByPoint(tmp.fromArray(pose, i));
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new T.Sphere());
    this.mesh = new T.Mesh(g, sharedMaterials.trim());
    this.mesh.name = 'Articulated windscreen wipers';
    this.mesh.userData.sweptGlass = { footprint: this.footprint, motion: this.motion };
  }
  static fit(glass: T.BufferGeometry, screen: Screen) {
    const sample = glassSampler(glass, screen),
      dz = screen.baseZ - screen.topZ;
    const length = Math.hypot(dz, screen.rise),
      slope = dz / length;
    const pivot = 0.055,
      base = screen.baseZ - dz * 0.13;
    let radius = Math.min(0.65, screen.halfWidth * 0.84 - pivot);
    for (let fit = 0; fit < 4; fit++, radius *= 0.9) {
      const sweep = Math.min(1.34, Math.asin(Math.min(1, (length * 0.72) / radius)));
      const poses: Float32Array[] = [],
        normals: Float32Array[] = [],
        indices: number[] = [];
      for (let pose = 0; pose <= POSES; pose++) {
        const angle = PARK + ((sweep - PARK) * pose) / POSES,
          points: number[] = [];
        let valid = true;
        for (const side of [-1, 1]) {
          const profile = (
            r0: number,
            r1: number,
            steps: number,
            width: number,
            height: number,
            lift: number,
          ) => {
            const offset = points.length / 3,
              centre = new T.Vector3(),
              normal = new T.Vector3(),
              tangent = new T.Vector3(),
              cross = new T.Vector3();
            for (let j = 0; j <= steps; j++) {
              const u = j / steps,
                r = r0 + (r1 - r0) * u,
                x = side * (pivot + r * Math.cos(angle)),
                z = base - r * Math.sin(angle) * slope;
              if (!sample(x, z, centre, normal)) {
                valid = false;
                return;
              }
              tangent.set(side * Math.cos(angle), 0, -Math.sin(angle) * slope);
              tangent.y = -(normal.x * tangent.x + normal.z * tangent.z) / Math.max(0.08, normal.y);
              cross.crossVectors(tangent, normal).normalize();
              for (const [across, above] of [
                [-1, 0],
                [1, 0],
                [1, 1],
                [-1, 1],
              ]) {
                const a = width * 0.5 * across,
                  h = lift + height * above;
                points.push(
                  centre.x + cross.x * a + normal.x * h,
                  centre.y + cross.y * a + normal.y * h,
                  centre.z + cross.z * a + normal.z * h,
                );
              }
              if (pose === 0 && j > 0)
                for (let k = 0; k < 4; k++) {
                  const i = offset + 4 * (j - 1) + k,
                    next = offset + 4 * (j - 1) + ((k + 1) % 4);
                  indices.push(i, i + 4, next, next, i + 4, next + 4);
                }
            }
            if (pose === 0) {
              const end = offset + steps * 4;
              indices.push(
                offset,
                offset + 1,
                offset + 2,
                offset,
                offset + 2,
                offset + 3,
                end,
                end + 2,
                end + 1,
                end,
                end + 3,
                end + 2,
              );
            }
          };
          // The bowed steel arm stands above the flexible wiping edge.
          profile(0, radius * 0.65, 4, 0.014, 0.008, 0.015);
          profile(radius * 0.3, radius, 8, 0.012, 0.01, 0.0015);
        }
        if (!valid) break;
        const position = new Float32Array(points),
          g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(position, 3));
        g.setIndex(indices);
        g.computeVertexNormals();
        poses.push(position);
        normals.push(g.getAttribute('normal').array as Float32Array);
        g.dispose();
      }
      if (poses.length === POSES + 1)
        return new FestivalWipers(
          poses,
          normals,
          indices,
          new T.Vector4(pivot, base, slope, radius),
          sweep,
        );
    }
    return undefined;
  }
  /** Strokes start on the recorded simulation clock. Rain changes select
   * the next cycle, allowing a moving blade to finish and park. */
  update(time: number, rain: number, entrant: number) {
    const t = (time + entrant * 0.197) / CYCLE,
      cycle = Math.floor(t);
    const interval = rain <= 0.08 ? 0 : rain < 1.5 ? 4 : rain < 6 ? 2 : 1;
    if (cycle !== this.cycle) {
      if (cycle !== this.cycle + 1) {
        this.lastStroke = interval
          ? cycle - (((cycle % interval) + interval) % interval)
          : -Infinity;
        this.interval = interval || 4;
      } else if (interval && ((cycle % interval) + interval) % interval === 0) {
        this.interval = Math.min(8, cycle - this.lastStroke);
        this.lastStroke = cycle;
      }
      this.cycle = cycle;
    }
    const elapsed = Math.max(0, Math.min(8, t - this.lastStroke));
    this.motion.z = elapsed;
    this.motion.w = this.interval;
    const stroke = elapsed < 1 ? (1 - Math.cos(Math.PI * 2 * elapsed)) * 0.5 : 0;
    if (stroke === this.previous) return;
    this.previous = stroke;
    const cursor = stroke * POSES,
      lo = Math.min(POSES - 1, Math.floor(cursor)),
      weight = cursor - lo;
    for (const [name, frames] of [
      ['position', this.poses],
      ['normal', this.normals],
    ] as const) {
      const a = frames[lo],
        b = frames[lo + 1],
        attr = this.mesh.geometry.getAttribute(name) as T.BufferAttribute;
      const out = attr.array;
      for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * weight;
      attr.needsUpdate = true;
    }
  }
}
