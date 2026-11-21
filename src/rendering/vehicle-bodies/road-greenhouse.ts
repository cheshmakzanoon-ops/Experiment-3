import { clamp } from '../../core/math.ts';
import type { ClosedBodyModel, Greenhouse } from './closed-body.ts';
import { insetProfile, sampleProfile, type Pt, type Ring } from './loft.ts';
import type { Detail } from './wheel.ts';

/** Section landmarks are measured along the skin. Keeping them at every LOD
 * stops a single coarse quad from becoming the whole A-pillar or side window. */
export type RoadWindowForm = 'canopy' | 'hatch' | 'saloon' | 'fastback' | 'classic' | 'cab';

const sideSteps = [5, 3, 1] as const;
const roofSteps = [6, 4, 2] as const;

function smooth(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function windscreenBow(form?: RoadWindowForm) {
  if (!form) return 0;
  if (form === 'cab') return 0.045;
  return form === 'fastback' || form === 'canopy' ? 0.155 : 0.095;
}

function rearBow(form: RoadWindowForm) {
  return form === 'cab' ? 0.012 : form === 'fastback' || form === 'canopy' ? 0.105 : 0.052;
}

// Stamping the base of the screen forward also carries the cowl with it.
// A steeply falling bonnet can be 18 cm lower at the moved station. The
// pressing follows only a shallow draw there, avoiding a scoop across the seal.
function sweptDeckHeight(nominal: number, actual: number) {
  return nominal + 0.025 * Math.tanh((actual - nominal) / 0.08);
}

/** Match the painted scuttle and parcel shelf to the swept glass feet. The
 * outer edge stays at its existing wheel-arch station. The surface query
 * supplies the height of the stamping at the moved point. */
export function fitRoadDeck(model: ClosedBodyModel, ring: Ring, detail: Detail): Ring {
  const { f, s } = model,
    form = s.windowForm;
  if (!form) return ring;
  const z = ring.z;
  // Carry a forward canopy's swept sill into the long bonnet pressing.
  // More stations share the bow, keeping the longitudinal mesh monotone.
  const frontBlend = model.forwardCanopy ? 0.63 : 0.41;
  const front = 1 - smooth(Math.abs(z - f.z(s.cabin[0])) / frontBlend);
  const rear = 1 - smooth(Math.abs(z - f.z(s.cabin[3])) / 0.31);
  if (!front && !rear) return ring;
  const shift = windscreenBow(form) * front - rearBow(form) * rear;
  const sill = model.halfWidth(z) * 0.8 - 0.01;
  const deck = model.deckSample(detail);
  const depths = ring.half.map(([x], j) =>
    j < deck ? z : z + shift * Math.max(0, 1 - (x / sill) ** 2),
  );
  const half = ring.half.map(
    (pt, j): Pt =>
      depths[j] === z ? pt : [pt[0], sweptDeckHeight(pt[1], model.surfaceY(depths[j], pt[0]))],
  );
  return { z, depths, half };
}

function bPillar(house: Greenhouse) {
  return (house.zRF + house.zRR) / 2 - 0.08;
}

function pillarWidth(form: RoadWindowForm) {
  if (form === 'canopy' || form === 'classic') return 0.034;
  return form === 'fastback' ? 0.055 : 0.081;
}

export function roadWindowMaterial(house: Greenhouse, form: RoadWindowForm, detail: Detail) {
  const side = sideSteps[detail],
    b = bPillar(house),
    halfPost = pillarWidth(form) / 2;
  return (z: number, j: number) => {
    const sidePane = j > 0 && j <= side;
    const roofPane = j >= side + 3;
    if (z < house.zRW + 0.012 || z > house.zWs - 0.014) return 2;
    if (j === 0) return 2;
    if (z > house.zRF) return sidePane || roofPane ? 1 : 0;
    if (z < house.zRR) return roofPane ? 1 : 0;
    if (!sidePane) return j === side + 1 ? 2 : 0;
    if (form !== 'cab' && Math.abs(z - b) < halfPost) return 2;
    return 1;
  };
}

function stations(house: Greenhouse, form: RoadWindowForm, detail: Detail) {
  const { zRW, zRR, zRF, zWs } = house;
  const keys = [zRW, zRW + 0.012, zRR, zRF, zWs - 0.014, zWs];
  if (form !== 'cab') {
    const b = bPillar(house),
      w = pillarWidth(form) / 2;
    keys.push(b - w, b + w);
  }
  keys.sort((a, b) => a - b);
  const step = [0.058, 0.12, 0.26][detail],
    result = [keys[0]];
  for (let i = 1; i < keys.length; i++) {
    const start = keys[i - 1],
      span = keys[i] - start;
    const n = Math.max(1, Math.ceil(span / step));
    for (let k = 1; k <= n; k++) result.push(start + (span * k) / n);
  }
  return result;
}

export function roadWindowRings(
  house: Greenhouse,
  form: RoadWindowForm,
  detail: Detail,
  inset: number,
): Ring[] {
  const { model, zRW, zRR, zRF } = house;
  const b = bPillar(house),
    side = sideSteps[detail],
    roof = roofSteps[detail];
  const coupe = form === 'fastback' || form === 'canopy';
  const frontBow = windscreenBow(form);
  const backBow = rearBow(form);
  return stations(house, form, detail).map((z) => {
    // Resolve the bent section once, then walk its arc to the glazing rails.
    const profile = sampleProfile(house.control(z), [5, 5, 5, 5]);
    const arc = [0];
    for (let i = 1; i < profile.length; i++)
      arc.push(
        arc[i - 1] +
          Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]),
      );
    const rail = arc[10],
      end = arc.at(-1)!;
    const sillSeal = Math.min(0.012, rail * 0.12);
    const sideRail = rail - Math.min(form === 'cab' ? 0.035 : 0.022, rail * 0.21);
    const upperRail = rail + Math.min(form === 'classic' ? 0.023 : 0.035, (end - rail) * 0.15);
    const lengths = [0, sillSeal];
    for (let i = 1; i <= side; i++) lengths.push(sillSeal + ((sideRail - sillSeal) * i) / side);
    lengths.push(rail, upperRail);
    for (let i = 1; i <= roof; i++) lengths.push(upperRail + ((end - upperRail) * i) / roof);

    const front = smooth((z - b) / (zRF - b));
    const rear = smooth((b - z) / (b - zRR));
    const quarter = 1 - smooth(Math.abs(z - zRR) / Math.min(zRR - zRW, b - zRR));
    const post = 1 - smooth(Math.abs(z - b) / Math.min(b - zRR, zRF - b));
    const sill = profile[0][0],
      base = house.base(z);
    const half: Pt[] = [],
      depths: number[] = [];
    let segment = 1;
    for (const length of lengths) {
      while (segment < arc.length - 1 && arc[segment] < length) segment++;
      const a = profile[segment - 1],
        c = profile[segment];
      const t = clamp((length - arc[segment - 1]) / (arc[segment] - arc[segment - 1]), 0, 1);
      const x = a[0] + (c[0] - a[0]) * t,
        y = a[1] + (c[1] - a[1]) * t;
      const across = clamp(x / sill, 0, 1);
      const sideHeight = Math.min(1, length / rail);
      // The front and rear screens bow in plan. The quarterlight runs aft
      // along its sill and the division bar rakes back toward the roof rail.
      const plane = (frontBow * front - backBow * rear) * (1 - across * across);
      const quarterRun = Math.min((zRR - zRW) * 0.62, coupe ? 0.23 : 0.14);
      const actualZ =
        z +
        plane -
        quarter * quarterRun * (1 - sideHeight) -
        post * (coupe ? 0.105 : 0.06) * sideHeight;
      const seat = 1 - smooth((y - base) / 0.14);
      const deck = sweptDeckHeight(model.surfaceY(actualZ - plane, x), model.surfaceY(actualZ, x));
      half.push([x, y + (deck + 0.002 - base) * seat]);
      depths.push(actualZ);
    }
    return { z, half: inset ? insetProfile(half, inset) : half, depths };
  });
}

/** Fit a bonded bonnet insert to the exact triangles of its own distance
 * level, including both mirror diagonals and the swept scuttle pressing. */
export function deckInsertHeight(
  model: ClosedBodyModel,
  detail: Detail,
  x0: number,
  z0: number,
  width: number,
  depth: number,
) {
  const rings = model.bodyRings(detail),
    deck = model.deckSample(detail);
  const faces: {
    ax: number;
    az: number;
    ay: number;
    ux: number;
    uz: number;
    uy: number;
    vx: number;
    vz: number;
    vy: number;
    inv: number;
  }[] = [];
  const point = (r: Ring, j: number) =>
    [Math.sign(x0) * r.half[j][0], r.half[j][1], r.depths?.[j] ?? r.z] as const;
  type Point = ReturnType<typeof point>;
  const face = (a: Point, b: Point, c: Point) => {
    if (
      Math.max(a[0], b[0], c[0]) < x0 - width ||
      Math.min(a[0], b[0], c[0]) > x0 + width ||
      Math.max(a[2], b[2], c[2]) < z0 - depth ||
      Math.min(a[2], b[2], c[2]) > z0 + depth
    )
      return;
    const ux = b[0] - a[0],
      uz = b[2] - a[2],
      vx = c[0] - a[0],
      vz = c[2] - a[2];
    const determinant = ux * vz - uz * vx;
    if (Math.abs(determinant) > 1e-10)
      faces.push({
        ax: a[0],
        ay: a[1],
        az: a[2],
        ux,
        uz,
        uy: b[1] - a[1],
        vx,
        vz,
        vy: c[1] - a[1],
        inv: 1 / determinant,
      });
  };
  for (let i = 1; i < rings.length; i++) {
    const p = rings[i - 1],
      q = rings[i];
    if (q.z + 0.16 < z0 - depth || p.z - 0.11 > z0 + depth) continue;
    for (let j = deck; j < p.half.length - 1; j++) {
      const a = point(p, j),
        b = point(p, j + 1),
        c = point(q, j),
        d = point(q, j + 1);
      if (x0 > 0) {
        face(a, c, b);
        face(c, d, b);
      } else {
        face(b, d, a);
        face(d, c, a);
      }
    }
  }
  return (x: number, z: number) => {
    for (const f of faces) {
      const dx = x - f.ax,
        dz = z - f.az;
      const u = (dx * f.vz - dz * f.vx) * f.inv,
        v = (f.ux * dz - f.uz * dx) * f.inv;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7) return f.ay + u * f.uy + v * f.vy;
    }
    return model.surfaceY(z, Math.abs(x));
  };
}
