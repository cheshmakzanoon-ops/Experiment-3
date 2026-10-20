import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BikeMaterials } from './bike.ts';
import { GP_CALIPER_HOSE_PROFILE } from './gp-radial-caliper.ts';

type Materials = Pick<BikeMaterials, 'dark' | 'aluminium' | 'steel' | 'reservoir'>;
const RADIUS = 0.0027;
const GUIDE = [0.148, -0.22, -0.065] as const;
const LEAD = new T.Vector3(0.008, 0.035, 0.036).normalize().multiplyScalar(0.12);
const SHAPE_STEPS = 32;
// Fixed catalogue hardpoints share the small table across entrants and LODs.
const shapes = new Map<string, { length: number; bows: Float64Array }>();

function add(
  parent: T.Group,
  geometry: T.BufferGeometry,
  material: T.Material,
  name: string,
  position: readonly [number, number, number],
) {
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.fromArray(position);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function fixedHose(
  parent: T.Group,
  points: readonly (readonly [number, number, number])[],
  material: T.Material,
  name: string,
  segments = 16,
) {
  return add(
    parent,
    new T.TubeGeometry(
      new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p))),
      segments,
      RADIUS,
      6,
      false,
    ),
    material,
    name,
    [0, 0, 0],
  );
}

/** The exact end of the existing rigid caliper hose, in fork-lower space.
 * The short authored hose and its brake housing remain geometrically intact. */
export function gpFrontHoseOutlet(side: -1 | 1, forkOffset: number, out: T.Vector3) {
  const end = GP_CALIPER_HOSE_PROFILE[GP_CALIPER_HOSE_PROFILE.length - 1];
  return out.set(side * (0.066 + end[0]), -0.02 + end[1], forkOffset - 0.135 + end[2]);
}

/** Routing follows REF_018/022/065/076; all dimensions are authored, not
 * measured from photographs. Compliant lines join moving lowers to fixed
 * steering guides. Only
 * 350 vertices at High (182 at Mid) move. Pressure feed, cross-over, master
 * cylinder and fittings join the existing rigid material batches. No extra
 * material, texture, skeleton, allocation per pose or elapsed-time state. */
export class GPFrontHydraulics {
  readonly root = new T.Group();
  readonly lines: T.Mesh<T.BufferGeometry>;
  private readonly positions: T.BufferAttribute;
  private readonly normals: T.BufferAttribute;
  private readonly rows: number;
  private readonly sides = 6;
  private readonly start = new T.Vector3();
  private readonly c1 = new T.Vector3();
  private readonly c2 = new T.Vector3();
  private readonly end = new T.Vector3(...GUIDE);
  private readonly point = new T.Vector3();
  private readonly tangent = new T.Vector3();
  private readonly normal = new T.Vector3();
  private readonly binormal = new T.Vector3();
  private readonly lastPoint = new T.Vector3();
  private readonly length: number;
  private readonly bows: Float64Array;
  private previous = Number.NaN;

  constructor(
    steering: T.Group,
    lower: T.Group,
    detail: 'high' | 'mid',
    materials: Materials,
    private readonly forkOffset: number,
    private readonly extendedLowerY: number,
    private readonly travel: number,
  ) {
    if (!Number.isFinite(travel) || travel <= 0) throw new RangeError('Invalid GP fork travel');
    this.rows = detail === 'high' ? 24 : 12;
    this.root.name = 'GP connected front hydraulic lines';
    steering.add(this.root);
    this.end.z += forkOffset - 0.03;

    // High retains the existing fluid pot and its feed. Mid receives the same
    // silhouette without the close-up volume window or extra material slots.
    if (detail === 'mid') {
      add(
        steering,
        new T.CylinderGeometry(0.022, 0.019, 0.035, 10),
        materials.reservoir,
        'GP brake-fluid reservoir',
        [-0.207, 0.003, 0.065],
      );
      add(
        steering,
        new T.CylinderGeometry(0.024, 0.024, 0.009, 10),
        materials.dark,
        'GP reservoir cap',
        [-0.207, 0.025, 0.065],
      );
      fixedHose(
        steering,
        [
          [-0.204, -0.014, 0.063],
          [-0.19, -0.032, 0.064],
          [-0.21, -0.041, 0.029],
        ],
        materials.dark,
        'GP reservoir feed',
        8,
      );
      for (const side of [-1, 1] as const) {
        fixedHose(
          lower,
          GP_CALIPER_HOSE_PROFILE.map(([x, y, z], index) =>
            // Mid has a narrower, tilted casting. Its inlet must meet that
            // surface; the final lead tangent/outlet still match High.
            index === 0
              ? [side * 0.09, 0.025, forkOffset - 0.125]
              : [side * (0.066 + x), -0.02 + y, forkOffset - 0.135 + z],
          ),
          materials.dark,
          'GP caliper hydraulic lead',
          8,
        );
        const inlet = add(
          lower,
          new T.CylinderGeometry(0.006, 0.006, 0.012, 6),
          materials.steel,
          'GP compact caliper pressure fitting',
          [side * 0.09, 0.025, forkOffset - 0.125],
        );
        inlet.rotation.z = Math.PI / 2;
      }
    }

    // Clamp around the existing clip-on tube, with a short cast bridge to the
    // radial body: the reservoir/master cluster is supported by real geometry.
    const clamp = add(
      steering,
      new T.TorusGeometry(0.0135, 0.0025, 6, detail === 'high' ? 16 : 10),
      materials.aluminium,
      'GP master-cylinder clip-on clamp',
      [-0.187, -0.036, 0.005],
    );
    clamp.quaternion.setFromUnitVectors(
      new T.Vector3(0, 0, 1),
      new T.Vector3(0, 1, 0).applyEuler(new T.Euler(0, -0.22, Math.PI / 2 + 0.18)),
    );
    add(
      steering,
      new RoundedBoxGeometry(0.017, 0.018, 0.025, 1, 0.003),
      materials.dark,
      'GP master-cylinder clamp bridge',
      [-0.187, -0.036, 0.017],
    );

    // The original blade pivot and reservoir inlet meet this compact casting.
    // Its radial bore faces forward; the hand and lever retain their joints.
    add(
      steering,
      new RoundedBoxGeometry(0.052, 0.025, 0.039, 2, 0.006),
      materials.dark,
      'GP radial front master-cylinder casting',
      [-0.185, -0.036, 0.046],
    );
    const bore = add(
      steering,
      new T.CylinderGeometry(0.013, 0.016, 0.02, detail === 'high' ? 16 : 10),
      materials.aluminium,
      'GP master-cylinder radial bore',
      [-0.183, -0.036, 0.057],
    );
    bore.rotation.x = Math.PI / 2;
    const banjo = add(
      steering,
      new T.CylinderGeometry(0.008, 0.008, 0.013, 6),
      materials.steel,
      'GP master-cylinder pressure banjo',
      [-0.166, -0.032, 0.051],
    );
    banjo.rotation.z = Math.PI / 2;
    fixedHose(
      steering,
      [
        [-0.166, -0.032, 0.051],
        [-0.167, -0.072, 0.063],
        [-0.153, -0.132, 0.049],
        [-0.15, -0.188, -0.014],
        [-GUIDE[0], GUIDE[1], this.end.z],
      ],
      materials.dark,
      'GP front-brake pressure feed',
    );
    fixedHose(
      steering,
      [
        [-GUIDE[0], GUIDE[1], this.end.z],
        [-0.085, -0.203, this.end.z - 0.012],
        [0.065, -0.203, this.end.z - 0.012],
        [GUIDE[0], GUIDE[1], this.end.z],
      ],
      materials.dark,
      'GP paired-caliper pressure cross-over',
    );
    for (const side of [-1, 1]) {
      const clip = add(
        steering,
        new T.TorusGeometry(0.0041, 0.0012, 4, detail === 'high' ? 10 : 6),
        materials.steel,
        'GP hydraulic guide clamp',
        [side * GUIDE[0], GUIDE[1], this.end.z],
      );
      clip.rotation.x = Math.PI / 2;
      const forkClamp = add(
        steering,
        new T.TorusGeometry(0.0305, 0.002, 4, detail === 'high' ? 14 : 10),
        materials.steel,
        'GP brake-line fork clamp',
        [side * 0.105, GUIDE[1], forkOffset],
      );
      forkClamp.rotation.x = Math.PI / 2;
      const from = new T.Vector3(side * 0.12, GUIDE[1], forkOffset - 0.027),
        to = new T.Vector3(side * GUIDE[0], GUIDE[1], this.end.z),
        direction = to.clone().sub(from),
        bracket = add(
          steering,
          new T.BoxGeometry(0.009, 0.006, direction.length()),
          materials.dark,
          'GP fork-mounted hydraulic guide bracket',
          from.clone().add(to).multiplyScalar(0.5).toArray(),
        );
      bracket.rotation.y = Math.atan2(direction.x, direction.z);
    }

    const count = 2 * (this.rows + 1) * (this.sides + 1),
      uv = new Float32Array(count * 2),
      indices: number[] = [];
    this.positions = new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(
      T.DynamicDrawUsage,
    );
    this.normals = new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(
      T.DynamicDrawUsage,
    );
    for (let side = 0; side < 2; side++)
      for (let row = 0; row <= this.rows; row++)
        for (let col = 0; col <= this.sides; col++) {
          const at = (side * (this.rows + 1) + row) * (this.sides + 1) + col;
          uv[at * 2] = col / this.sides;
          uv[at * 2 + 1] = row / this.rows;
          if (row < this.rows && col < this.sides) {
            const next = at + this.sides + 1;
            if (side === 0) indices.push(at, at + 1, next, at + 1, next + 1, next);
            else indices.push(at, next, at + 1, at + 1, next, next + 1);
          }
        }
    const geometry = new T.BufferGeometry();
    geometry.name = 'GP constant-length suspension brake hoses';
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('normal', this.normals);
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.boundingBox = new T.Box3();
    geometry.boundingSphere = new T.Sphere();
    this.lines = new T.Mesh(geometry, materials.dark);
    this.lines.name = 'GP compliant paired brake hoses';
    this.lines.castShadow = this.lines.receiveShadow = true;
    this.root.add(this.lines);
    const key = `${forkOffset}/${extendedLowerY}/${travel}`,
      cached = shapes.get(key);
    if (cached) {
      this.length = cached.length;
      this.bows = cached.bows;
    } else {
      this.controlPoints(extendedLowerY, 0.09);
      this.length = this.arcLength();
      this.bows = new Float64Array(SHAPE_STEPS + 1);
      for (let i = 0; i <= SHAPE_STEPS; i++)
        this.bows[i] = this.solveBow(extendedLowerY + (i / SHAPE_STEPS) * travel);
      shapes.set(key, { length: this.length, bows: this.bows });
    }
    this.update(extendedLowerY);
  }

  private controlPoints(lowerY: number, bow: number) {
    gpFrontHoseOutlet(1, this.forkOffset, this.start).y += lowerY;
    this.c1.copy(this.start).add(LEAD);
    this.c2.set(this.end.x + 0.015, this.end.y - 0.1, this.end.z + bow);
  }

  private sample(t: number, out: T.Vector3) {
    const u = 1 - t;
    return out
      .copy(this.start)
      .multiplyScalar(u * u * u)
      .addScaledVector(this.c1, 3 * u * u * t)
      .addScaledVector(this.c2, 3 * u * t * t)
      .addScaledVector(this.end, t * t * t);
  }

  private arcLength() {
    this.lastPoint.copy(this.start);
    let length = 0;
    for (let i = 1; i <= 32; i++) {
      this.sample(i / 32, this.point);
      length += this.point.distanceTo(this.lastPoint);
      this.lastPoint.copy(this.point);
    }
    return length;
  }

  private solveBow(lowerY: number) {
    let low = 0,
      high = 0.7;
    for (let step = 0; step < 16; step++) {
      const bow = (low + high) * 0.5;
      this.controlPoints(lowerY, bow);
      if (this.arcLength() < this.length) low = bow;
      else high = bow;
    }
    return (low + high) * 0.5;
  }

  /** Absolute fork displacement only. The shared shape table replaces a
   * per-frame length solve; its 3.9 mm stations retain sub-millimetre length
   * error through the catalogue travel. Invalid-range snapshots still keep
   * both attachment points rather than snapping a line away from a caliper. */
  update(lowerY: number) {
    lowerY = Number.isFinite(lowerY) ? lowerY : this.extendedLowerY;
    if (lowerY === this.previous) return;
    this.previous = lowerY;
    const stroke = ((lowerY - this.extendedLowerY) / this.travel) * SHAPE_STEPS,
      interval = Math.min(SHAPE_STEPS - 1, Math.max(0, Math.floor(stroke))),
      bow =
        stroke >= 0 && stroke <= SHAPE_STEPS
          ? T.MathUtils.lerp(this.bows[interval], this.bows[interval + 1], stroke - interval)
          : this.solveBow(lowerY);
    this.controlPoints(lowerY, bow);
    for (let row = 0; row <= this.rows; row++) {
      const t = row / this.rows,
        u = 1 - t;
      this.sample(t, this.point);
      this.tangent
        .copy(this.c1)
        .sub(this.start)
        .multiplyScalar(3 * u * u)
        .addScaledVector(this.end, 3 * t * t)
        .addScaledVector(this.c2, 6 * u * t - 3 * t * t)
        .addScaledVector(this.c1, -6 * u * t)
        .normalize();
      this.normal.set(1, 0, 0).addScaledVector(this.tangent, -this.tangent.x).normalize();
      this.binormal.crossVectors(this.tangent, this.normal).normalize();
      for (let col = 0; col <= this.sides; col++) {
        const angle = col === this.sides ? 0 : (col / this.sides) * Math.PI * 2,
          c = Math.cos(angle),
          s = Math.sin(angle),
          nx = this.normal.x * c + this.binormal.x * s,
          ny = this.normal.y * c + this.binormal.y * s,
          nz = this.normal.z * c + this.binormal.z * s;
        for (let side = 0; side < 2; side++) {
          const at = (side * (this.rows + 1) + row) * (this.sides + 1) + col,
            sign = side === 0 ? 1 : -1;
          this.positions.setXYZ(
            at,
            sign * (this.point.x + nx * RADIUS),
            this.point.y + ny * RADIUS,
            this.point.z + nz * RADIUS,
          );
          this.normals.setXYZ(at, nx * sign, ny, nz);
        }
      }
    }
    this.positions.needsUpdate = this.normals.needsUpdate = true;
    // A cubic remains inside the convex hull of its control points. Include
    // the hose radius and mirror X to bound both lines without two additional
    // full vertex scans per moving pose. The bound stays conservative at any
    // authored or replayed stroke, including a snapshot outside normal travel.
    const box = this.lines.geometry.boundingBox!,
      sphere = this.lines.geometry.boundingSphere!,
      maxX = Math.max(this.start.x, this.c1.x, this.c2.x, this.end.x) + RADIUS;
    box.min.set(
      -maxX,
      Math.min(this.start.y, this.c1.y, this.c2.y, this.end.y) - RADIUS,
      Math.min(this.start.z, this.c1.z, this.c2.z, this.end.z) - RADIUS,
    );
    box.max.set(
      maxX,
      Math.max(this.start.y, this.c1.y, this.c2.y, this.end.y) + RADIUS,
      Math.max(this.start.z, this.c1.z, this.c2.z, this.end.z) + RADIUS,
    );
    box.getCenter(sphere.center);
    sphere.radius = sphere.center.distanceTo(box.max);
  }
}
