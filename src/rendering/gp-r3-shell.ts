import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleProfile } from './profile-sampling.ts';
import { atlasUv, gpR3LiveryMaterial, type Projection } from './gp-r3-livery.ts';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';

/** GP-R3 bodywork: an original, hard-surfaced prototype shell guided by the
 * MotoGP 26 reference pack (REF_018 side profile, REF_028 nose, REF_056/060
 * aero and ground-effect flanks, REF_001/003 three-quarter silhouettes).
 *
 * The previous shell read as one inflated volume. Real fairings are separate
 * thin panels meeting at crisp feature lines, so this shell is assembled from
 * ruled strips: every strip is lofted between named feature curves and owns
 * its normals, which makes each shared curve a real crease in the lighting.
 * Feature curves are authored right-hand (+X) keys in the existing chassis
 * frame (ground y = -0.62, front axle z = +0.70); the left half mirrors. */

type Key = readonly [x: number, y: number, z: number];
/** A feature curve sampled by a shared parameter t in [0, 1]. */
class Curve {
  private readonly t: number[];
  private readonly x: number[];
  private readonly y: number[];
  private readonly z: number[];
  constructor(keys: readonly Key[]) {
    if (keys.length < 2) throw new RangeError('A feature curve needs two keys');
    this.t = keys.map((_, i) => i / (keys.length - 1));
    this.x = keys.map((k) => k[0]);
    this.y = keys.map((k) => k[1]);
    this.z = keys.map((k) => k[2]);
  }
  at(t: number, target: T.Vector3) {
    return target.set(
      sampleProfile(this.t, this.x, t),
      sampleProfile(this.t, this.y, t),
      sampleProfile(this.t, this.z, t),
    );
  }
  /** A new curve offset by a constant vector (for crowns and recesses). */
  shifted(dx: number, dy: number, dz = 0) {
    return new Curve(
      this.t.map((_, i) => [this.x[i] + dx, this.y[i] + dy, this.z[i] + dz] as const),
    );
  }
}
interface Span {
  curve: Curve;
  from?: number;
  to?: number;
}
interface Strip {
  /** Ordered across the strip; interior spans are smooth control curves. */
  spans: readonly (Curve | Span)[];
  /** Approximate outward direction for the right half. */
  out: Key;
  part: 'livery' | 'carbon' | 'dark' | 'seat' | 'screen';
  projection?: Projection;
  /** A thin dark inner skin for panels whose underside is visible. */
  lining?: boolean;
  rows: number;
  columns: number;
}

const span = (s: Curve | Span): Required<Span> =>
  s instanceof Curve ? { curve: s, from: 0, to: 1 } : { from: 0, to: 1, ...s };

/** Catmull-Rom across the strip; uniform, passing through every curve. */
function across(points: readonly T.Vector3[], u: number, target: T.Vector3) {
  const n = points.length - 1,
    f = u * n,
    i = Math.min(n - 1, Math.floor(f)),
    s = f - i,
    p0 = points[Math.max(0, i - 1)],
    p1 = points[i],
    p2 = points[i + 1],
    p3 = points[Math.min(n, i + 2)],
    s2 = s * s,
    s3 = s2 * s;
  const w0 = -0.5 * s3 + s2 - 0.5 * s,
    w1 = 1.5 * s3 - 2.5 * s2 + 1,
    w2 = -1.5 * s3 + 2 * s2 + 0.5 * s,
    w3 = 0.5 * s3 - 0.5 * s2;
  return target
    .set(0, 0, 0)
    .addScaledVector(p0, w0)
    .addScaledVector(p1, w1)
    .addScaledVector(p2, w2)
    .addScaledVector(p3, w3);
}

function buildStrip(strip: Strip, density: number, mirror: -1 | 1) {
  const spans = strip.spans.map(span),
    rows = Math.max(2, Math.round(strip.rows * density)),
    columns = Math.max(1, Math.round(strip.columns * density)),
    points = spans.map(() => new T.Vector3()),
    p = new T.Vector3(),
    position: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    spans.forEach((s, k) => s.curve.at(T.MathUtils.lerp(s.from, s.to, v), points[k]));
    for (let c = 0; c <= columns; c++) {
      if (points.length === 2) p.lerpVectors(points[0], points[1], c / columns);
      else across(points, c / columns, p);
      const x = p.x * mirror;
      position.push(x, p.y, p.z);
      const [u, w] = atlasUv(strip.projection ?? 'side', x === 0 ? mirror * 1e-6 : x, p.y, p.z);
      uv.push(u, w);
    }
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      const a = r * (columns + 1) + c,
        b = a + columns + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // Orient by the authored outward hint, not by the order the curves happen
  // to be listed in: the result is identical for both mirrored halves.
  const normal = geometry.getAttribute('normal'),
    out = new T.Vector3(strip.out[0] * mirror, strip.out[1], strip.out[2]);
  let facing = 0;
  for (let i = 0; i < normal.count; i++)
    facing += normal.getX(i) * out.x + normal.getY(i) * out.y + normal.getZ(i) * out.z;
  if (facing < 0) {
    for (let i = 0; i < index.length; i += 3)
      [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    geometry.setIndex(index);
    geometry.computeVertexNormals();
  }
  return geometry;
}

/** Inner skin: the same strip pushed 4 mm inward with reversed winding. */
function lining(geometry: T.BufferGeometry) {
  const inner = geometry.clone(),
    position = inner.getAttribute('position'),
    normal = inner.getAttribute('normal');
  for (let i = 0; i < position.count; i++)
    position.setXYZ(
      i,
      position.getX(i) - normal.getX(i) * 0.004,
      position.getY(i) - normal.getY(i) * 0.004,
      position.getZ(i) - normal.getZ(i) * 0.004,
    );
  const index = [...inner.index!.array];
  for (let i = 0; i < index.length; i += 3)
    [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  inner.setIndex(index);
  inner.computeVertexNormals();
  return inner;
}

// ---- Feature curves (right half, chassis metres) ------------------------
// Nose cowl. t runs from the beak tip (t = 0) rearwards.
const NOSE_TOP = new Curve([
  [0, 0.112, 0.995],
  [0, 0.168, 0.93],
  [0, 0.214, 0.845],
  [0, 0.243, 0.755],
  [0, 0.262, 0.672],
]);
// Top shoulder crease: the number face meets the flank. It continues past the
// screen base as the cheek's upper edge, which carries the windscreen.
const SHOULDER = new Curve([
  [0.012, 0.11, 0.99],
  [0.066, 0.156, 0.925],
  [0.118, 0.193, 0.838],
  [0.152, 0.22, 0.75],
  [0.17, 0.236, 0.672],
  [0.182, 0.258, 0.585],
  [0.19, 0.282, 0.49],
  [0.19, 0.292, 0.425],
]);
const SHOULDER_SCREEN = 4 / 7; // t at the screen base (z = 0.672)
const FLANK_MID = new Curve([
  [0.02, 0.084, 0.99],
  [0.084, 0.122, 0.925],
  [0.142, 0.14, 0.838],
  [0.182, 0.15, 0.75],
  [0.2, 0.156, 0.672],
  [0.216, 0.162, 0.585],
  [0.224, 0.16, 0.49],
  [0.226, 0.152, 0.425],
]);
// The chine: where the nose flank folds under towards the intake.
const CHINE = new Curve([
  [0.022, 0.064, 0.985],
  [0.078, 0.079, 0.928],
  [0.13, 0.09, 0.85],
  [0.172, 0.094, 0.77],
  [0.196, 0.08, 0.69],
  [0.218, 0.03, 0.6],
  [0.228, -0.04, 0.51],
  [0.232, -0.085, 0.43],
]);
const LIP = new Curve([
  [0.014, 0.058, 0.975],
  [0.05, 0.07, 0.925],
  [0.088, 0.082, 0.86],
  [0.122, 0.09, 0.79],
  [0.152, 0.082, 0.705],
  [0.176, 0.034, 0.61],
  [0.186, -0.038, 0.52],
  [0.19, -0.085, 0.44],
]);
// Recessed central intake (dark) behind the lip.
const INTAKE = new Curve([
  [0, 0.068, 0.955],
  [0, 0.094, 0.9],
  [0, 0.112, 0.84],
  [0, 0.122, 0.78],
  [0, 0.124, 0.72],
]);

// Lower fairing: t runs from the leading edge behind the front wheel to the
// trailing edge ahead of the rider's knee; each line has its own z range.
const LOWER_TOP = new Curve([
  [0.19, 0.05, 0.44],
  [0.175, 0.07, 0.3],
  [0.165, 0.075, 0.14],
  [0.16, 0.07, 0.0],
  [0.155, 0.06, -0.045],
]);
const LOWER_SHOULDER = new Curve([
  [0.228, -0.02, 0.43],
  [0.222, 0.0, 0.29],
  [0.212, 0.005, 0.13],
  [0.2, -0.005, -0.01],
  [0.19, -0.02, -0.06],
]);
const LOWER_WAIST = new Curve([
  [0.214, -0.15, 0.38],
  [0.21, -0.14, 0.25],
  [0.2, -0.14, 0.1],
  [0.19, -0.15, -0.04],
  [0.18, -0.16, -0.085],
]);
// Ground-effect pod: the widest, hardest edge of the lower fairing.
const POD = new Curve([
  [0.24, -0.24, 0.345],
  [0.254, -0.25, 0.22],
  [0.254, -0.26, 0.08],
  [0.25, -0.27, -0.05],
  [0.232, -0.27, -0.1],
]);
const POD_FOOT = new Curve([
  [0.214, -0.345, 0.305],
  [0.226, -0.355, 0.2],
  [0.224, -0.36, 0.06],
  [0.212, -0.355, -0.06],
  [0.196, -0.345, -0.11],
]);
const KEEL = new Curve([
  [0.09, -0.44, 0.24],
  [0.1, -0.455, 0.14],
  [0.1, -0.455, 0.02],
  [0.09, -0.44, -0.08],
  [0.075, -0.41, -0.12],
]);
const KEEL_CENTRE = new Curve([
  [0, -0.452, 0.23],
  [0, -0.466, 0.13],
  [0, -0.466, 0.02],
  [0, -0.45, -0.08],
  [0, -0.42, -0.12],
]);

// Tank cover: t from the steering head to the saddle.
const TANK_TOP = new Curve([
  [0, 0.305, 0.37],
  [0, 0.33, 0.25],
  [0, 0.334, 0.11],
  [0, 0.31, -0.03],
  [0, 0.262, -0.14],
]);
const TANK_EDGE = new Curve([
  [0.085, 0.296, 0.37],
  [0.135, 0.316, 0.25],
  [0.152, 0.318, 0.11],
  [0.13, 0.292, -0.03],
  [0.1, 0.25, -0.14],
]);
const TANK_SIDE = new Curve([
  [0.13, 0.22, 0.37],
  [0.172, 0.22, 0.25],
  [0.184, 0.21, 0.11],
  [0.165, 0.19, -0.03],
  [0.13, 0.17, -0.14],
]);
const TANK_FOOT = new Curve([
  [0.15, 0.1, 0.36],
  [0.17, 0.09, 0.25],
  [0.17, 0.085, 0.11],
  [0.155, 0.09, -0.03],
  [0.13, 0.11, -0.14],
]);

// Seat unit and tail. t from the saddle front to the tail tip.
const SADDLE = new Curve([
  [0, 0.232, -0.15],
  [0, 0.226, -0.28],
  [0, 0.228, -0.42],
  [0, 0.24, -0.5],
]);
const SADDLE_EDGE = new Curve([
  [0.095, 0.228, -0.15],
  [0.105, 0.222, -0.28],
  [0.1, 0.224, -0.42],
  [0.092, 0.236, -0.5],
]);
const TAIL_TOP = new Curve([
  [0, 0.25, -0.5],
  [0, 0.322, -0.56],
  [0, 0.368, -0.63],
  [0, 0.362, -0.74],
  [0, 0.336, -0.88],
]);
const TAIL_EDGE = new Curve([
  [0.095, 0.24, -0.5],
  [0.094, 0.31, -0.56],
  [0.088, 0.352, -0.63],
  [0.068, 0.348, -0.74],
  [0.03, 0.33, -0.875],
]);
const TAIL_FLANK = new Curve([
  [0.118, 0.21, -0.14],
  [0.124, 0.2, -0.3],
  [0.118, 0.22, -0.5],
  [0.106, 0.28, -0.63],
  [0.08, 0.3, -0.75],
  [0.034, 0.305, -0.878],
]);
const TAIL_SHOULDER = new Curve([
  [0.104, 0.226, -0.14],
  [0.112, 0.22, -0.3],
  [0.108, 0.232, -0.5],
  [0.096, 0.31, -0.6],
  [0.072, 0.335, -0.74],
  [0.03, 0.326, -0.877],
]);
const TAIL_SKIRT = new Curve([
  [0.122, 0.12, -0.13],
  [0.13, 0.12, -0.3],
  [0.122, 0.15, -0.5],
  [0.104, 0.2, -0.64],
  [0.075, 0.24, -0.76],
  [0.03, 0.28, -0.875],
]);
const TAIL_FLOOR = new Curve([
  [0.0, 0.12, -0.13],
  [0.0, 0.12, -0.3],
  [0.0, 0.15, -0.5],
  [0.0, 0.2, -0.64],
  [0.0, 0.24, -0.76],
  [0.0, 0.28, -0.875],
]);

// Windscreen: from the cowl's top edge, bubbled, rising to helmet height.
const SCREEN_CENTRE = new Curve([
  [0, 0.262, 0.672],
  [0, 0.33, 0.62],
  [0, 0.388, 0.55],
  [0, 0.425, 0.48],
  [0, 0.44, 0.425],
]);
const SCREEN_BUBBLE = new Curve([
  [0.09, 0.256, 0.67],
  [0.11, 0.322, 0.615],
  [0.122, 0.372, 0.545],
  [0.13, 0.404, 0.478],
  [0.132, 0.416, 0.425],
]);

function strips(): Strip[] {
  const shoulderToScreen = { curve: SHOULDER, from: 0, to: SHOULDER_SCREEN };
  return [
    // Nose number face with a slight crown.
    {
      spans: [NOSE_TOP, NOSE_TOP.shifted(0.07, 0.004), shoulderToScreen],
      out: [0, 1, 0.3],
      part: 'livery',
      projection: 'top',
      rows: 30,
      columns: 8,
    },
    // Upper nose flank and cheek beside the screen.
    {
      spans: [SHOULDER, FLANK_MID],
      out: [1, 0.2, 0],
      part: 'livery',
      rows: 44,
      columns: 6,
      lining: true,
    },
    // Lower nose flank folding to the chine.
    {
      spans: [FLANK_MID, CHINE],
      out: [1, -0.1, 0],
      part: 'livery',
      rows: 44,
      columns: 5,
      lining: true,
    },
    // Under-chin return to the intake lip.
    {
      spans: [CHINE, LIP],
      out: [0.2, -1, 0.3],
      part: 'livery',
      rows: 40,
      columns: 2,
      lining: true,
    },
    // Recessed intake mouth.
    {
      spans: [{ curve: LIP, from: 0, to: 0.62 }, INTAKE],
      out: [0, -0.3, 1],
      part: 'dark',
      rows: 18,
      columns: 3,
    },
    // Lower fairing: upper skin under the tank, shoulder crease, waist, the
    // ground-effect pod with its hard edge, foot and belly keel.
    {
      spans: [LOWER_TOP, LOWER_SHOULDER],
      out: [0.4, 1, 0],
      part: 'livery',
      rows: 26,
      columns: 2,
      lining: true,
    },
    {
      spans: [LOWER_SHOULDER, LOWER_WAIST.shifted(0.006, 0.06), LOWER_WAIST],
      out: [1, 0, 0],
      part: 'livery',
      rows: 26,
      columns: 6,
      lining: true,
    },
    {
      spans: [LOWER_WAIST, POD],
      out: [1, 0.2, 0],
      part: 'livery',
      rows: 26,
      columns: 5,
      lining: true,
    },
    {
      spans: [POD, POD_FOOT],
      out: [0.6, -1, 0],
      part: 'livery',
      rows: 26,
      columns: 3,
      lining: true,
    },
    {
      spans: [POD_FOOT, KEEL],
      out: [0.4, -1, 0],
      part: 'livery',
      rows: 26,
      columns: 4,
      lining: true,
    },
    {
      spans: [KEEL, KEEL_CENTRE],
      out: [0, -1, 0],
      part: 'livery',
      rows: 22,
      columns: 2,
    },
    // Tank cover: crowned top, rolled edge, knee flank.
    {
      spans: [TANK_TOP, TANK_TOP.shifted(0.07, 0.006), TANK_EDGE],
      out: [0, 1, 0],
      part: 'livery',
      projection: 'top',
      rows: 22,
      columns: 6,
    },
    {
      spans: [TANK_EDGE, TANK_SIDE.shifted(0.012, 0.04), TANK_SIDE],
      out: [1, 0.3, 0],
      part: 'livery',
      rows: 22,
      columns: 6,
    },
    {
      spans: [TANK_SIDE, TANK_FOOT],
      out: [1, -0.2, 0],
      part: 'carbon',
      rows: 18,
      columns: 3,
    },
    // Saddle pad and the tail unit.
    {
      spans: [SADDLE, SADDLE.shifted(0.06, 0.004), SADDLE_EDGE],
      out: [0, 1, 0],
      part: 'seat',
      rows: 14,
      columns: 5,
    },
    {
      spans: [TAIL_TOP, TAIL_TOP.shifted(0.06, 0.004), TAIL_EDGE],
      out: [0, 1, -0.3],
      part: 'livery',
      projection: 'top',
      rows: 18,
      columns: 5,
    },
    {
      spans: [
        { curve: TAIL_SHOULDER, from: 0.4, to: 1 },
        { curve: TAIL_EDGE, from: 0, to: 1 },
      ],
      out: [1, 0.6, 0],
      part: 'livery',
      rows: 18,
      columns: 2,
    },
    {
      spans: [TAIL_SHOULDER, TAIL_FLANK.shifted(0.004, -0.02), TAIL_SKIRT],
      out: [1, 0, 0],
      part: 'livery',
      rows: 30,
      columns: 6,
      lining: true,
    },
    // Closes the saddle edge onto the tail flank.
    {
      spans: [SADDLE_EDGE, { curve: TAIL_SHOULDER, from: 0, to: 0.4 }],
      out: [1, 1, 0],
      part: 'livery',
      rows: 12,
      columns: 1,
    },
    {
      spans: [TAIL_SKIRT, TAIL_FLOOR],
      out: [0, -1, 0],
      part: 'dark',
      rows: 18,
      columns: 2,
    },
    // Windscreen bubble seated on the cheek tops.
    {
      spans: [SCREEN_CENTRE, SCREEN_BUBBLE, { curve: SHOULDER, from: SHOULDER_SCREEN, to: 1 }],
      out: [0, 1, 0.6],
      part: 'screen',
      rows: 18,
      columns: 8,
    },
  ];
}

/** Box wing: two aerofoils joined by a vertical end plate, swept back from
 * the nose flank (REF_056, REF_049). Built as a swept closed section. */
const WING = [
  // [x, y, leading-edge z, chord]
  [0.13, 0.146, 0.875, 0.15],
  [0.2, 0.142, 0.855, 0.165],
  [0.27, 0.126, 0.82, 0.17],
  [0.318, 0.1, 0.785, 0.165],
  [0.334, 0.06, 0.758, 0.155],
  [0.326, 0.018, 0.728, 0.145],
  [0.29, 0.0, 0.692, 0.14],
  [0.226, 0.012, 0.652, 0.13],
] as const;
function wingGeometry(density: number, mirror: -1 | 1) {
  const steps = Math.max(6, Math.round(30 * density)),
    ring = Math.max(6, Math.round(14 * density)),
    curve = new T.CatmullRomCurve3(WING.map(([x, y, z]) => new T.Vector3(x, y, z))),
    params = WING.map((_, i) => i / (WING.length - 1)),
    chords = WING.map((w) => w[3]),
    point = new T.Vector3(),
    tangent = new T.Vector3(),
    position: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const u = s / steps,
      chord = sampleProfile(params, chords, u);
    curve.getPoint(u, point);
    curve.getTangent(u, tangent);
    // Section plane: chord runs rearward (-Z); thickness is normal to the
    // span within the X/Y plane.
    const len = Math.hypot(tangent.x, tangent.y) || 1,
      nx = -tangent.y / len,
      ny = tangent.x / len;
    for (let k = 0; k <= ring; k++) {
      const a = (k / ring) * Math.PI * 2,
        t = (1 - Math.cos(a)) / 2,
        half =
          chord *
          0.7 *
          (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4) *
          Math.sign(Math.sin(a) || 1),
        // Gentle 6 degree incidence: trailing edge rises.
        x = point.x + nx * half,
        y = point.y + ny * half + t * chord * 0.1,
        z = point.z - t * chord,
        mx = x * mirror;
      position.push(mx, y, z);
      const [uu, vv] = atlasUv('side', mx, y, z);
      uv.push(uu, vv);
    }
  }
  for (let s = 0; s < steps; s++)
    for (let k = 0; k < ring; k++) {
      const a = s * (ring + 1) + k,
        b = a + ring + 1;
      if (mirror > 0) index.push(a, b, a + 1, a + 1, b, b + 1);
      else index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  // Orientation check against the section's own outward direction.
  const n = g.getAttribute('normal');
  let facing = 0;
  for (let i = 0; i < n.count; i++) {
    const s = Math.floor(i / (ring + 1));
    curve.getPoint(s / steps, point);
    facing +=
      n.getX(i) * (position[i * 3] - point.x * mirror) +
      n.getY(i) * (position[i * 3 + 1] - point.y);
  }
  if (facing < 0) {
    for (let i = 0; i < index.length; i += 3)
      [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    g.setIndex(index);
    g.computeVertexNormals();
  }
  return g;
}

export const GP_R3_SHELL_REVISION = 'gp-r3-hard-surface-1';

/** The complete GP-R1 shell at one detail level. Meshes are grouped into one
 * draw per finish (livery, carbon, dark, seat, screen, lining). */
export function gpR3Shell(
  materials: BikeMaterials,
  detail: RiderDetail,
  entrant: number,
  transmissive: boolean,
): T.Group {
  const density = detail === 'high' ? 1 : detail === 'mid' ? 0.5 : 0.28,
    groups: Record<string, T.BufferGeometry[]> = {};
  const push = (part: string, g: T.BufferGeometry) => (groups[part] ??= []).push(g);
  for (const strip of strips()) {
    for (const mirror of [1, -1] as const) {
      const g = buildStrip(strip, density, mirror);
      push(strip.part, g);
      if (strip.lining && detail !== 'far') push('lining', lining(g));
    }
  }
  if (detail !== 'far')
    for (const mirror of [1, -1] as const) push('livery', wingGeometry(density, mirror));
  const livery = gpR3LiveryMaterial(materials, entrant),
    finish: Record<string, T.Material> = {
      livery,
      carbon: materials.carbon,
      dark: materials.dark,
      lining: materials.dark,
      seat: materials.seat,
      screen: transmissive ? materials.screen : materials.screenLight,
    };
  const group = new T.Group();
  group.name = `GP-R3 hard-surface shell (${detail})`;
  for (const [part, pieces] of Object.entries(groups)) {
    const geometry = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    if (!geometry) throw new Error(`Incompatible GP-R3 ${part} geometry`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, finish[part]);
    mesh.name = part === 'livery' ? 'GP bodywork / paint' : `GP bodywork / ${part}`;
    mesh.castShadow = part !== 'screen';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.referenceRevision = GP_R3_SHELL_REVISION;
  return group;
}
