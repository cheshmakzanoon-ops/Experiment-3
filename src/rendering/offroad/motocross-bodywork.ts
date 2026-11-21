import * as T from 'three';
import { superLoft, type Section } from '../bike.ts';
import { sampleProfile } from '../profile-sampling.ts';
import type { RiderDetail } from '../rider.ts';

/** Sprung-frame bodywork volumes (m; origin at the CG, +Z forward, +Y up).
 *
 * The earlier machine carried a seat slab and printed panels on an open
 * frame: from a chase camera there was daylight where a motocross bike has
 * its tank, airbox and seat base. These are the closed mouldings between
 * those panels. Every surface the rider touches keeps its height: the seat
 * crown from the tail to the tank is the original one, and the tank climbs
 * ahead of the forward-most hip position, inside the knees and shrouds. */
const sidesFor = (detail: RiderDetail) => (detail === 'high' ? 36 : detail === 'mid' ? 18 : 10);

/** Fuel tank and upper shroud body: a narrow-shouldered wedge that rises
 * from under the seat nose to the steering head and covers the frame spars. */
const TANK: readonly Section[] = [
  { z: -0.06, y: 0.07, w: 0.1, top: 0.05, bottom: 0.07, topWidth: 0.62 },
  { z: 0.03, y: 0.09, w: 0.128, top: 0.075, bottom: 0.1, topWidth: 0.54 },
  { z: 0.114, y: 0.115, w: 0.158, top: 0.1, bottom: 0.115, topWidth: 0.44 },
  { z: 0.2, y: 0.15, w: 0.15, top: 0.12, bottom: 0.13, topWidth: 0.36 },
  { z: 0.262, y: 0.2, w: 0.094, top: 0.095, bottom: 0.11, topWidth: 0.42 },
  { z: 0.284, y: 0.225, w: 0.05, top: 0.06, bottom: 0.07, topWidth: 0.6 },
];
export function motocrossTankShell(detail: RiderDetail) {
  return superLoft(TANK, sidesFor(detail), 2.9);
}
/** Top of the tank moulding at `z`, for the filler cap and the seat nose. */
export function motocrossTankTop(z: number) {
  const zs = TANK.map((s) => s.z);
  if (z <= zs[0]) return TANK[0].y + TANK[0].top;
  for (let i = 1; i < TANK.length; i++)
    if (z <= zs[i]) {
      const t = (z - zs[i - 1]) / (zs[i] - zs[i - 1]),
        a = TANK[i - 1],
        b = TANK[i];
      return T.MathUtils.lerp(a.y + a.top, b.y + b.top, t);
    }
  const last = TANK[TANK.length - 1];
  return last.y + last.top;
}

/** One-piece seat: the original crown where the rider sits, a kicked-up
 * tail, deeper foam at the sides and a nose that runs up the tank. */
const SEAT: readonly Section[] = [
  { z: -0.74, y: 0.094, w: 0.058, top: 0.03, bottom: 0.03, topWidth: 0.8 },
  { z: -0.66, y: 0.088, w: 0.094, top: 0.04, bottom: 0.04, topWidth: 0.8 },
  { z: -0.45, y: 0.085, w: 0.118, top: 0.045, bottom: 0.052, topWidth: 0.78 },
  { z: -0.15, y: 0.09, w: 0.122, top: 0.045, bottom: 0.058, topWidth: 0.76 },
  { z: -0.02, y: 0.102, w: 0.102, top: 0.042, bottom: 0.05, topWidth: 0.74 },
  // The nose rides 1.5-2 cm proud of the tank top, as a pad over it: a
  // coincident surface would leave an irregular black intersection patch.
  { z: 0.06, y: 0.153, w: 0.084, top: 0.045, bottom: 0.035, topWidth: 0.72 },
  { z: 0.13, y: 0.205, w: 0.066, top: 0.04, bottom: 0.03, topWidth: 0.7 },
  { z: 0.17, y: 0.232, w: 0.044, top: 0.026, bottom: 0.022, topWidth: 0.7 },
];
export function motocrossSeat(detail: RiderDetail) {
  return superLoft(SEAT, sidesFor(detail), 3);
}

/** Sewn traction pleats wrap down the actual seat shoulders. Their edges
 * enter the foam, so only the upper rubber crown needs triangles. */
export function motocrossSeatPleats(detail: RiderDetail) {
  const stations = SEAT.map((s) => s.z),
    centre = SEAT.map((s) => s.y),
    top = SEAT.map((s) => s.top),
    width = SEAT.map((s) => s.w),
    taper = SEAT.map((s) => s.topWidth ?? 1);
  const columns = detail === 'high' ? 8 : 6;
  const pos: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const profile = [
    [-0.0075, -0.0012],
    [-0.0035, 0.0036],
    [0.0028, 0.0041],
    [0.0075, -0.0012],
  ];
  for (let rib = 0; rib < 6; rib++) {
    for (let i = 0; i <= columns; i++) {
      const u = i / columns,
        a = Math.PI * (0.15 + u * 0.7);
      const c = Math.cos(a),
        s = Math.sin(a);
      const z0 = -0.215 - rib * 0.066 - 0.014 * Math.abs(c);
      for (let row = 0; row < profile.length; row++) {
        const [offset, lift] = profile[row],
          z = z0 + offset;
        const x =
          Math.sign(c) *
          Math.abs(c) ** (2 / 3) *
          sampleProfile(stations, width, z) *
          (1 - (1 - sampleProfile(stations, taper, z)) * s);
        const y =
          sampleProfile(stations, centre, z) + s ** (2 / 3) * sampleProfile(stations, top, z);
        pos.push(x, y + lift, z);
        uv.push(u, row / (profile.length - 1));
        if (i && row) {
          const d = pos.length / 3 - 1,
            b = d - profile.length;
          indices.push(b - 1, d - 1, b, b, d - 1, d);
        }
      }
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Airbox and seat base behind the frame: closes the space between the side
 * number panels above the swingarm, clear of the rear tyre at full travel. */
const AIRBOX: readonly Section[] = [
  { z: -0.6, y: 0.07, w: 0.07, top: 0.02, bottom: 0.014 },
  { z: -0.52, y: 0.058, w: 0.1, top: 0.034, bottom: 0.016 },
  { z: -0.41, y: 0.036, w: 0.126, top: 0.052, bottom: 0.044 },
  { z: -0.28, y: -0.024, w: 0.132, top: 0.108, bottom: 0.15 },
  { z: -0.15, y: -0.036, w: 0.126, top: 0.118, bottom: 0.15 },
  { z: -0.1, y: -0.04, w: 0.108, top: 0.11, bottom: 0.13 },
];
export function motocrossAirbox(detail: RiderDetail) {
  return superLoft(AIRBOX, sidesFor(detail), 3.4);
}

/** Rear mudguard flap between the airbox and the tyre (a flat, slightly
 * dished sheet hanging from the subframe), seen through the wheel opening. */
export function motocrossMudFlap() {
  const g = new T.BoxGeometry(0.19, 0.2, 0.006, 4, 4, 1),
    p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i);
    // Dish toward the tyre and taper the lower corners.
    p.setZ(i, p.getZ(i) - 0.5 * x * x + 0.12 * (y + 0.1) * (y + 0.1));
    p.setX(i, x * (1 - 0.18 * T.MathUtils.clamp(-y / 0.1, 0, 1)));
  }
  g.computeVertexNormals();
  return g;
}
