import * as T from 'three';
import { VEHICLES, vehicleIndex, type VehicleDefinition } from '../simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from './vehicle-bodies/body-sheet.ts';

type Point = readonly [number, number, number];
type Parts = T.BufferGeometry[];
export const TRAFFIC_BODY_PARTS = ['paint', 'glazing', 'trim', 'lamps'] as const;
export type TrafficBodyGeometry = Record<(typeof TRAFFIC_BODY_PARTS)[number], T.BufferGeometry>;
export interface TrafficVisualProfile {
  readonly vehicle: VehicleDefinition;
  readonly index: number;
  readonly sheet: ClosedSheet;
}

/** A deliberately bounded palette. Each target uses the existing original
 * body sheet, including its actual wheelbase and cabin silhouette. New road
 * entries use the closest existing dimensions until this palette is reviewed. */
const PROFILE_IDS = [
  'rh3',
  'rs5',
  'rm8',
  'rg63',
  'rp6',
  'rr4',
  'lx12',
  'rd2',
  'eh3',
  'sc7',
] as const;
export const TRAFFIC_VISUAL_PROFILES: readonly TrafficVisualProfile[] = PROFILE_IDS.map((id) => {
  const vehicle = VEHICLES[id],
    sheet = bodySheetFor(vehicle);
  if (!sheet || sheet.kind !== 'closed') throw new Error(`Missing traffic body sheet: ${id}`);
  return { vehicle, index: vehicleIndex(id), sheet };
});

function add(parts: Parts, geometry: T.BufferGeometry, tint: number) {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const color = new T.Color(tint),
    colors = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
  g.setAttribute('color', new T.BufferAttribute(colors, 3));
  parts.push(g);
}
function patch(parts: Parts, points: Point[], index: number[], tint: number) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(points.flat(), 3));
  g.setIndex(index);
  g.computeVertexNormals();
  add(parts, g, tint);
}
function face(parts: Parts, points: Point[], outward: Point, tint: number) {
  const a = new T.Vector3(...points[0]),
    b = new T.Vector3(...points[1]),
    c = new T.Vector3(...points[2]);
  const reverse =
    b
      .sub(a)
      .cross(c.sub(a))
      .dot(new T.Vector3(...outward)) < 0;
  const index: number[] = [];
  for (let i = 1; i < points.length - 1; i++)
    index.push(0, reverse ? i + 1 : i, reverse ? i : i + 1);
  patch(parts, points, index, tint);
}
function box(
  parts: Parts,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  l: number,
  tint: number,
) {
  add(parts, new T.BoxGeometry(w, h, l).translate(x, y, z), tint);
}
function merge(parts: Parts) {
  const count = parts.reduce((sum, g) => sum + g.getAttribute('position').count, 0),
    out = new T.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const values = new Float32Array(count * 3);
    let offset = 0;
    for (const g of parts) {
      values.set(g.getAttribute(name).array as Float32Array, offset);
      offset += g.getAttribute(name).count * 3;
    }
    out.setAttribute(name, new T.BufferAttribute(values, 3));
  }
  for (const g of parts) g.dispose();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Four material groups, identical vertex topology for every sheet. Dimensions
 * are metres at the traffic body's ground + half-height origin, +Z forward.
 * Roadster roofs collapse intentionally; the open cockpit remains visible.
 * Wheels are separate so neither rolling nor steering deforms the body. */
export function trafficBodyGeometry({
  vehicle: v,
  sheet: s,
}: TrafficVisualProfile): TrafficBodyGeometry {
  const paint: Parts = [],
    glazing: Parts = [],
    trim: Parts = [],
    headlamps: Parts = [],
    stopLamps: Parts = [],
    indicators: Parts = [];
  const white = 0xffffff,
    dark = 0x172026,
    rubber = 0x15181b,
    metal = 0x9aa7af;
  const origin = v.halfExtents[1],
    y = (height: number) => height - origin;
  const hx = s.width / 2,
    front = v.wheelPositions[0][2],
    rear = v.wheelPositions[2][2];
  const nose = front + s.overhang[0],
    tail = rear - s.overhang[1],
    length = nose - tail;
  const floor = y(s.floor),
    axleY = y(v.spec.wheelRadius),
    arch = v.spec.wheelRadius + 0.045;
  const zAt = (station: number) => front - station * v.spec.wheelbase;
  const [screen, roofFront, roofRear, back] = s.cabin.map(zAt);
  const open = s.style === 'roadster' || !!s.open,
    truck = s.style === 'truck';
  // The same nine semantic rings plus thirty arch stations are retained for
  // all profiles. Do not deduplicate coincident stations: topology is shared.
  const rings = [
    [tail, hx * 0.88, y(s.tail)],
    [tail + s.overhang[1] * 0.24, hx * 0.96, y(s.deck)],
    [rear, hx, y(s.belt)],
    [rear + v.spec.wheelbase * 0.22, hx * 0.97, y(s.belt)],
    [(rear + front) / 2, hx * 0.96, y(s.belt)],
    [front - v.spec.wheelbase * 0.22, hx * 0.98, y(s.bonnet)],
    [front, hx, y(s.bonnet)],
    [nose - s.overhang[0] * 0.24, hx * 0.96, y(s.nose) + 0.05],
    [nose, hx * (s.noseWidth ?? 0.86), y(s.nose)],
  ];
  const profile = (z: number) => {
    let i = 0;
    while (i < rings.length - 2 && z > rings[i + 1][0]) i++;
    const a = rings[i],
      b = rings[i + 1],
      t = (z - a[0]) / (b[0] - a[0]);
    let belt = a[2] + (b[2] - a[2]) * t;
    // Low sports-car bonnets sit below the tyre crown. The fender shoulder
    // must rise over the rolled arch instead of folding its side faces back
    // down through the wheel opening.
    for (const axle of [rear, front]) {
      const d = Math.abs(z - axle),
        outer = arch + 0.018;
      if (d < outer) belt = Math.max(belt, axleY + Math.sqrt(outer * outer - d * d) + 0.018);
    }
    return { width: a[1] + (b[1] - a[1]) * t, belt };
  };
  const stations = rings.map((r) => r[0]);
  for (const axle of [rear, front]) {
    stations.push(axle - arch - 0.002, axle + arch + 0.002);
    for (let i = 0; i <= 12; i++) stations.push(axle + Math.cos((i * Math.PI) / 12) * arch);
  }
  stations.sort((a, b) => a - b);
  const shoulder = [-0.98, -0.82, -0.45, 0, 0.45, 0.82, 0.98];
  const top: Point[] = [],
    topIndex: number[] = [];
  for (const z of stations) {
    const p = profile(z);
    const recess =
      truck && z < back - 0.08 && z > tail + 0.12
        ? 0.29
        : open && z < screen && z > back
          ? 0.24
          : 0;
    for (const x of shoulder) {
      const inset = Math.abs(x) < 0.82 ? recess : 0;
      top.push([x * p.width, p.belt + 0.035 * (1 - (x / 0.98) ** 2) - inset, z]);
    }
  }
  for (let row = 0; row < stations.length - 1; row++)
    for (let col = 0; col < shoulder.length - 1; col++) {
      const a = row * shoulder.length + col,
        b = a + shoulder.length;
      topIndex.push(a, b, a + 1, a + 1, b, b + 1);
    }
  patch(paint, top, topIndex, white);
  for (const side of [-1, 1]) {
    const points: Point[] = [],
      index: number[] = [];
    for (const z of stations) {
      const p = profile(z);
      let sill = floor;
      for (const axle of [rear, front]) {
        const d = Math.abs(z - axle);
        if (d < arch - 0.00001) sill = Math.max(sill, axleY + Math.sqrt(arch * arch - d * d));
      }
      points.push(
        [side * p.width * 0.94, sill, z],
        [side * p.width, sill + (p.belt - sill) * 0.58, z],
        [side * p.width * 0.98, p.belt, z],
      );
    }
    for (let row = 0; row < stations.length - 1; row++)
      for (let col = 0; col < 2; col++) {
        const a = row * 3 + col,
          b = a + 3;
        index.push(...(side > 0 ? [a, a + 1, b + 1, a, b + 1, b] : [a, b + 1, a + 1, a, b, b + 1]));
      }
    patch(paint, points, index, white);
    for (const axle of [rear, front]) {
      const lip: Point[] = [],
        well: Point[] = [],
        indices: number[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i * Math.PI) / 16;
        for (const radius of [arch, arch + 0.018]) {
          const z = axle + Math.cos(a) * radius;
          lip.push([side * (profile(z).width + 0.002), axleY + Math.sin(a) * radius, z]);
        }
        const z = axle + Math.cos(a) * arch,
          height = axleY + Math.sin(a) * arch;
        well.push(
          [side * profile(z).width, height, z],
          [side * (profile(z).width - 0.18), height, z],
        );
        if (i < 16) {
          const j = i * 2;
          indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
        }
      }
      const lipIndex = indices.slice();
      if (side < 0)
        for (let i = 0; i < lipIndex.length; i += 3)
          [lipIndex[i + 1], lipIndex[i + 2]] = [lipIndex[i + 2], lipIndex[i + 1]];
      patch(paint, lip, lipIndex, white);
      patch(trim, well, indices, rubber);
    }
  }
  // Join the deck, shoulder and sill at the same three heights as the side
  // panels. The intermediate vertices carry real bumper curvature across the
  // pressed face rather than triangulating a flat cap from its first corner.
  for (const z of [tail, nose]) {
    const p = profile(z),
      points: Point[] = [],
      indices: number[] = [];
    const heights = z === tail ? [0, 0.2, 0.29, 0.42, 0.58, 1] : [0, 0.29, 0.58, 1];
    for (const t of heights) {
      const width = t < 0.58 ? 0.94 + (0.06 * t) / 0.58 : 1 - (0.02 * (t - 0.58)) / 0.42;
      for (const x of shoulder) {
        const across = x / 0.98;
        const top = p.belt + 0.035 * (1 - across * across);
        points.push([across * width * p.width, floor + t * (top - floor), z]);
      }
    }
    for (let row = 0; row < heights.length - 1; row++)
      for (let col = 0; col < shoulder.length - 1; col++) {
        const a = row * shoulder.length + col,
          b = a + shoulder.length;
        indices.push(
          ...(z === nose ? [a, a + 1, b, b, a + 1, b + 1] : [a, b, a + 1, b, b + 1, a + 1]),
        );
      }
    patch(paint, points, indices, white);
  }
  box(trim, 0, floor + 0.024, (nose + tail) / 2, hx * 1.5, 0.045, length * 0.9, rubber);

  const roofWidth = hx * s.roofWidth,
    roofY = y(s.roof),
    frontBaseY = y(s.cowl);
  const rearBaseY = y(truck ? s.belt : s.deck),
    sideBaseY = y(s.belt + 0.025);
  const roof: Point[] = [],
    roofIndex: number[] = [],
    across = [-1, -0.7, 0, 0.7, 1];
  for (let row = 0; row < 4; row++) {
    const t = row / 3,
      z = roofRear + (roofFront - roofRear) * t;
    for (const x of across)
      roof.push([
        x * roofWidth * (0.96 + Math.sin(t * Math.PI) * 0.04),
        roofY - 0.028 * x * x - 0.024 * (2 * t - 1) ** 2,
        z,
      ]);
  }
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < across.length - 1; col++) {
      const a = row * across.length + col,
        b = a + across.length;
      roofIndex.push(a, b, a + 1, a + 1, b, b + 1);
    }
  patch(paint, roof, roofIndex, white);
  const framedGlass = (points: Point[], normal: Point) => {
    const centre = new T.Vector3();
    for (const p of points) centre.add(new T.Vector3(...p));
    centre.multiplyScalar(0.25);
    const n = new T.Vector3(...normal).normalize();
    const inset = (amount: number, height: number): Point[] =>
      points.map((p) => {
        const v = new T.Vector3(...p)
          .sub(centre)
          .multiplyScalar(amount)
          .add(centre)
          .addScaledVector(n, height);
        return [v.x, v.y, v.z];
      });
    const seal = inset(0.94, 0.002),
      glass = inset(0.907, 0.005);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      face(paint, [points[i], points[j], seal[j], seal[i]], normal, white);
      face(trim, [seal[i], seal[j], glass[j], glass[i]], normal, rubber);
    }
    // Automotive glass is crowned in both directions. Keep its perimeter at
    // the gasket and let a moving sky highlight travel across the actual pane.
    const vertices: Point[] = [],
      indices: number[] = [];
    const left = new T.Vector3(),
      right = new T.Vector3(),
      p = new T.Vector3();
    const corners = glass.map((point) => new T.Vector3(...point));
    const forward =
      left
        .subVectors(corners[3], corners[0])
        .cross(right.subVectors(corners[1], corners[0]))
        .dot(n) >= 0;
    for (let row = 0; row <= 2; row++) {
      const v = row / 2;
      left.lerpVectors(corners[0], corners[1], v);
      right.lerpVectors(corners[3], corners[2], v);
      for (let col = 0; col <= 4; col++) {
        const u = col / 4;
        p.lerpVectors(left, right, u).addScaledVector(n, 0.024 * 16 * u * (1 - u) * v * (1 - v));
        vertices.push([p.x, p.y, p.z]);
        if (row < 2 && col < 4) {
          const i = row * 5 + col;
          indices.push(
            ...(forward
              ? [i, i + 1, i + 5, i + 1, i + 6, i + 5]
              : [i, i + 5, i + 1, i + 1, i + 5, i + 6]),
          );
        }
      }
    }
    patch(glazing, vertices, indices, white);
  };
  framedGlass(
    [
      [-hx * 0.87, frontBaseY, screen],
      [-roofWidth * 0.96, roofY - 0.05, roofFront],
      [roofWidth * 0.96, roofY - 0.05, roofFront],
      [hx * 0.87, frontBaseY, screen],
    ],
    [0, 0.6, 0.8],
  );
  const backRoofY = open ? rearBaseY : roofY - 0.05;
  const backRoofZ = open ? back : roofRear;
  framedGlass(
    [
      [hx * 0.88, rearBaseY, back],
      [roofWidth * 0.96, backRoofY, backRoofZ],
      [-roofWidth * 0.96, backRoofY, backRoofZ],
      [-hx * 0.88, rearBaseY, back],
    ],
    [0, 0.6, -0.8],
  );
  const pillar = (roofRear + roofFront) / 2;
  for (const side of [-1, 1]) {
    const topY = open ? sideBaseY : roofY - 0.04;
    framedGlass(
      [
        [side * hx * 0.88, rearBaseY, back],
        [side * roofWidth * 0.96, open ? rearBaseY : roofY - 0.05, backRoofZ],
        [side * roofWidth, topY, pillar - 0.035],
        [side * hx * 0.94, sideBaseY, pillar - 0.035],
      ],
      [side, 0.25, 0],
    );
    framedGlass(
      [
        [side * hx * 0.94, sideBaseY, pillar + 0.035],
        [side * roofWidth, topY, pillar + 0.035],
        [side * roofWidth * 0.96, open ? sideBaseY : roofY - 0.05, roofFront],
        [side * hx * 0.87, frontBaseY, screen],
      ],
      [side, 0.25, 0],
    );
    face(
      trim,
      [
        [side * hx * 0.943, sideBaseY + 0.005, pillar - 0.035],
        [side * roofWidth, topY + 0.005, pillar - 0.035],
        [side * roofWidth, topY + 0.005, pillar + 0.035],
        [side * hx * 0.943, sideBaseY + 0.005, pillar + 0.035],
      ],
      [side, 0.2, 0],
      dark,
    );
    box(
      trim,
      side * hx * 0.947,
      sideBaseY - 0.012,
      (back + screen) / 2,
      0.012,
      0.018,
      screen - back,
      metal,
    );
    for (const z of [pillar - 0.34, screen - 0.32])
      box(trim, side * hx * 0.982, sideBaseY - 0.12, z, 0.022, 0.035, 0.15, metal);
    box(trim, side * hx * 0.94, frontBaseY + 0.02, screen - 0.08, 0.08, 0.035, 0.07, dark);
    add(
      paint,
      new T.SphereGeometry(1, 8, 5)
        .scale(0.048, 0.047, 0.1)
        .translate(side * hx * 0.96, frontBaseY + 0.07, screen - 0.13),
      white,
    );
    box(glazing, side * hx * 0.96, frontBaseY + 0.07, screen - 0.223, 0.075, 0.05, 0.008, 0xa3b5bf);
    // Seats are visible in the roadster and enclosed by the other cabins.
    box(trim, side * hx * 0.4, y(s.belt - 0.02), screen - 0.65, hx * 0.58, 0.22, 0.32, dark);
  }
  // A recessed bed liner on the pickup; the same topology sits under the
  // enclosed boot on the other profiles, so morph target counts stay fixed.
  const bedFront = truck ? back - 0.1 : tail + 0.2,
    bedRear = tail + 0.14;
  box(
    trim,
    0,
    truck ? y(s.deck) - 0.28 : floor + 0.05,
    (bedFront + bedRear) / 2,
    hx * 1.38,
    0.025,
    Math.max(0.02, bedFront - bedRear),
    rubber,
  );

  // Long fittings need intermediate vertices at the same curved surface as
  // the bumper. A box has just its two end vertices across a strip: its long
  // planar face can cut through the paint between them. Back faces live inside
  // the presswork. The exposed lip has a small bevel at its upper/lower edge.
  const panel = (
    parts: Parts,
    x: number,
    h: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    tint: number,
    cols = 1,
  ) => {
    const direction = z > (nose + tail) * 0.5 ? 1 : -1;
    const bevel = depth >= 0.018 ? Math.min(height * 0.12, depth * 0.4) : 0;
    const rows = bevel
      ? [-height / 2, -height / 2 + bevel, height / 2 - bevel, height / 2]
      : [-height / 2, height / 2];
    const points: Point[] = [],
      index: number[] = [];
    for (let r = 0; r < rows.length; r++) {
      const inset = r === 0 || r === rows.length - 1 ? bevel : 0;
      for (let c = 0; c <= cols; c++) {
        points.push([
          x + width * (c / cols - 0.5),
          h + rows[r],
          z + direction * (depth / 2 - inset),
        ]);
        if (c < cols && r < rows.length - 1) {
          const a = r * (cols + 1) + c,
            b = a + cols + 1;
          index.push(
            ...(direction > 0 ? [a, a + 1, b, b, a + 1, b + 1] : [a, b, a + 1, b, b + 1, a + 1]),
          );
        }
      }
    }
    patch(parts, points, index, tint);
  };
  const noseY = y(s.nose),
    tailY = y(s.tail),
    frontWidth = profile(nose).width;
  panel(trim, 0, noseY - 0.23, nose + 0.012, frontWidth * 1.1, 0.21, 0.025, rubber, 8);
  for (let i = 0; i < 4; i++)
    panel(trim, 0, noseY - 0.155 - i * 0.048, nose + 0.028, frontWidth, 0.011, 0.015, 0x556168, 8);
  // A folded bumper insert and a recessed registration panel give the back
  // a readable waist even when the car ahead occupies only a few dozen pixels.
  const bumperY = floor + (tailY - floor) * 0.25;
  const plateY = tailY - Math.min(0.36, (tailY - floor) * 0.41);
  panel(trim, 0, bumperY, tail - 0.014, hx * 1.56, 0.055, 0.035, dark, 10);
  panel(trim, 0, floor + 0.048, tail - 0.009, hx * 1.3, 0.085, 0.025, rubber, 10);
  panel(trim, 0, plateY + 0.018, tail - 0.014, 0.58, 0.197, 0.03, 0x333b3f, 4);
  panel(trim, 0, plateY, tail - 0.034, 0.455, 0.143, 0.016, 0xd4dadb, 4);
  for (let i = 0; i < 6; i++)
    panel(trim, -0.105 + i * 0.042, plateY, tail - 0.046, 0.021, 0.051, 0.004, dark);
  for (const side of [-1, 1]) {
    const x = side * frontWidth * 0.67;
    panel(trim, x, noseY - 0.075, nose + 0.01, 0.34, 0.13, 0.03, dark, 4);
    panel(trim, x, noseY - 0.075, nose + 0.028, 0.29, 0.09, 0.012, metal, 4);
    for (const dx of [-0.07, 0.07])
      add(
        headlamps,
        new T.CylinderGeometry(0.03, 0.03, 0.008, 10)
          .rotateX(Math.PI / 2)
          .translate(x + dx, noseY - 0.08, nose + 0.039),
        0xfff3db,
      );
    panel(headlamps, x, noseY - 0.035, nose + 0.038, 0.27, 0.014, 0.008, 0xf4f8ff, 4);
    panel(indicators, x + side * 0.137, noseY - 0.07, nose + 0.039, 0.018, 0.057, 0.008, 0xff8c24);
    const lightType = s.lamps.rear;
    const wide = lightType === 'bar' || lightType === 'strip';
    const lensWidth = wide ? hx * 0.61 : 0.32;
    const lensHeight = lightType === 'strip' ? 0.063 : wide ? 0.105 : 0.123;
    const rearX = side * (hx * 0.78 - lensWidth * 0.48);
    panel(
      trim,
      rearX,
      tailY - 0.11,
      tail - 0.01,
      lensWidth + 0.031,
      lensHeight + 0.027,
      0.03,
      dark,
      6,
    );
    panel(trim, rearX, tailY - 0.11, tail - 0.028, lensWidth, lensHeight, 0.015, 0x822a30, 6);
    for (let i = 0; i < 3; i++)
      panel(
        stopLamps,
        rearX + (i - 1) * lensWidth * 0.295,
        tailY - 0.105,
        tail - 0.038,
        lensWidth * (wide ? 0.286 : 0.205),
        lensHeight * (wide ? 0.39 : 0.6),
        0.008,
        0xff2418,
        2,
      );
    panel(
      indicators,
      rearX + side * lensWidth * 0.46,
      tailY - 0.11,
      tail - 0.039,
      0.018,
      lensHeight * 0.71,
      0.008,
      0xff8c24,
    );
  }
  const topY = tailY - 0.04,
    bottomY = floor + (tailY - floor) * 0.54;
  const seam: Point[] = [],
    seams: number[] = [];
  const line = [
    [-0.75, topY],
    [-0.74, tailY - 0.21],
    [-0.7, bottomY + 0.04],
    [-0.62, bottomY],
    [-0.42, bottomY],
    [-0.21, bottomY],
    [0, bottomY],
    [0.21, bottomY],
    [0.42, bottomY],
    [0.62, bottomY],
    [0.7, bottomY + 0.04],
    [0.74, tailY - 0.21],
    [0.75, topY],
  ];
  for (let i = 0; i < line.length; i++) {
    const previous = line[Math.max(0, i - 1)],
      next = line[Math.min(line.length - 1, i + 1)];
    const dx = (next[0] - previous[0]) * hx,
      dy = next[1] - previous[1],
      scale = 0.0034 / Math.hypot(dx, dy);
    for (const side of [-1, 1])
      seam.push([
        line[i][0] * hx - dy * scale * side,
        line[i][1] + dx * scale * side,
        tail - 0.009,
      ]);
    if (i < line.length - 1)
      seams.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  }
  patch(trim, seam, seams, 0x273034);
  // Circuit assignment is constant across every catalogue morph. Only the
  // three drive levels change per instance, preserving a single optical draw.
  const circuits = [headlamps, stopLamps, indicators];
  const vertexCounts = circuits.map((parts) =>
    parts.reduce((count, part) => count + part.getAttribute('position').count, 0),
  );
  const optics = merge(circuits.flat());
  const channels = new Uint8Array(optics.getAttribute('position').count);
  let start = 0;
  for (let circuit = 0; circuit < vertexCounts.length; circuit++) {
    channels.fill(circuit, start, start + vertexCounts[circuit]);
    start += vertexCounts[circuit];
  }
  optics.setAttribute('trafficLampCircuit', new T.BufferAttribute(channels, 1));
  const geometry = {
    paint: merge(paint),
    glazing: merge(glazing),
    trim: merge(trim),
    lamps: optics,
  };
  // Tool the end panels, grilles, sockets and individual lenses together.
  // The centre section stays broad, the corners wrap around the flank and
  // the bottom of the bumper rolls under. The panel normal follows the same
  // deformation, including where a lamp projects beyond the nominal length.
  const n = new T.Vector3(),
    noseHalf = profile(nose).width,
    tailHalf = profile(tail).width;
  for (const g of Object.values(geometry)) {
    const pos = g.getAttribute('position'),
      normal = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        h = pos.getY(i),
        z = pos.getZ(i);
      const direction = z >= front ? 1 : z <= rear ? -1 : 0;
      if (!direction) continue;
      const end = direction > 0 ? nose : tail;
      const transition = s.overhang[direction > 0 ? 0 : 1] * 0.83;
      const t = T.MathUtils.clamp(1 - ((end - z) * direction) / transition, 0, 1);
      if (t === 0) continue;
      const weight = t * t * (3 - 2 * t);
      const u = Math.max(0, (Math.abs(x) / hx - 0.35) / 0.65);
      const lower = T.MathUtils.clamp((floor + 0.21 - h) / 0.21, 0, 1);
      const depth = (truck ? 0.15 : 0.245) * Math.min(1, transition / 0.65);
      const bumperSpan = (tailY - floor) * 0.21;
      const q = (h - floor - (tailY - floor) * 0.31) / bumperSpan;
      const bumper = direction < 0 ? Math.max(0, 1 - q * q) : 0;
      // Fade the vertical presswork before the side-panel seam so the
      // skirt and cap share their edge between the original sill stations.
      const half = direction > 0 ? noseHalf : tailHalf;
      const edge = T.MathUtils.clamp((0.91 - Math.abs(x) / half) / 0.25, 0, 1);
      const middle = edge * edge * (3 - 2 * edge);
      const press = 0.075 * lower * lower - 0.082 * bumper * bumper;
      const inset = depth * u * u + middle * press;
      pos.setZ(i, z - direction * weight * inset);
      const dzdx =
        -direction *
        weight *
        Math.sign(x) *
        ((depth * 2 * u) / (0.65 * hx) - (6 * edge * (1 - edge) * press) / (half * 0.25));
      const dzdy =
        direction *
        weight *
        middle *
        ((h > floor ? (0.15 * lower) / 0.21 : 0) - (0.328 * q * bumper) / bumperSpan);
      const dzdz = 1 - (6 * t * (1 - t) * inset) / transition;
      const nz = normal.getZ(i) / dzdz;
      n.set(normal.getX(i) - nz * dzdx, normal.getY(i) - nz * dzdy, nz).normalize();
      normal.setXYZ(i, n.x, n.y, n.z);
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  return geometry;
}

/** Distant alloy and tyre. Fifteen facets preserve the five-spoke phase and
 * limit silhouette deviation to 0.27 px at a 12 px projected radius. */
export function distantTrafficWheelGeometry() {
  const parts: Parts = [],
    segments = 15;
  const rotate = (r: number, x: number, i: number): Point => {
    const angle = (i * Math.PI * 2) / segments;
    return [x, Math.cos(angle) * r, Math.sin(angle) * r];
  };
  const tyre = [
    [0.7, -0.5],
    [0.89, -0.5],
    [1, -0.27],
    [1, 0.27],
    [0.89, 0.5],
    [0.7, 0.5],
  ];
  add(
    parts,
    new T.LatheGeometry(
      tyre.map(([r, x]) => new T.Vector2(r, x)),
      segments,
    ).rotateZ(Math.PI / 2),
    0x15181b,
  );
  for (const side of [-1, 1]) {
    const outward: Point = [side, 0, 0],
      x = side * 0.465;
    for (let i = 0; i < segments; i++) {
      face(
        parts,
        [rotate(0.64, x, i), rotate(0.72, x, i), rotate(0.72, x, i + 1), rotate(0.64, x, i + 1)],
        outward,
        0x909ba3,
      );
      face(parts, [[x, 0, 0], rotate(0.64, x, i), rotate(0.64, x, i + 1)], outward, 0x272d30);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5,
        points: Point[] = [];
      for (const [r, angle] of [
        [0.12, a - 0.42],
        [0.68, a - 0.085],
        [0.68, a + 0.085],
        [0.12, a + 0.42],
      ])
        points.push([side * 0.472, r * Math.cos(angle), r * Math.sin(angle)]);
      face(parts, points, outward, 0x9aa7af);
    }
    const hub = Array.from(
      { length: 10 },
      (_, i): Point => [
        side * 0.476,
        0.17 * Math.cos((i * Math.PI) / 5),
        0.17 * Math.sin((i * Math.PI) / 5),
      ],
    );
    face(parts, hub, outward, 0x9aa7af);
  }
  return merge(parts);
}

/** Shared circular wheel, unit radius and unit section width, axle along X.
 * Both faces are authored so right wheels do not need a mirror that reverses
 * rolling. The instance scales X by width and Y/Z equally by tyre radius. */
export function trafficWheelGeometry() {
  const parts: Parts = [],
    rubber = 0x15181b,
    dark = 0x252c30,
    metal = 0x9aa7af;
  const profile = [
    [0.59, -0.5],
    [0.88, -0.5],
    [0.97, -0.4],
    [1, -0.27],
    [1, 0.27],
    [0.97, 0.4],
    [0.88, 0.5],
    [0.59, 0.5],
  ].map(([r, x]) => new T.Vector2(r, x));
  add(parts, new T.LatheGeometry(profile, 18).rotateZ(Math.PI / 2), rubber);
  for (const side of [-1, 1]) {
    add(
      parts,
      new T.CylinderGeometry(0.67, 0.67, 0.045, 14)
        .rotateZ(Math.PI / 2)
        .translate(side * 0.405, 0, 0),
      dark,
    );
    add(
      parts,
      new T.TorusGeometry(0.71, 0.045, 5, 18).rotateY(Math.PI / 2).translate(side * 0.46, 0, 0),
      metal,
    );
    for (let k = 0; k < 5; k++) {
      const a = (k * Math.PI * 2) / 5;
      add(
        parts,
        new T.BoxGeometry(0.06, 0.64, 0.11)
          .rotateX(a)
          .translate(side * 0.465, Math.cos(a) * 0.32, Math.sin(a) * 0.32),
        metal,
      );
    }
    add(
      parts,
      new T.CylinderGeometry(0.18, 0.18, 0.065, 10)
        .rotateZ(Math.PI / 2)
        .translate(side * 0.465, 0, 0),
      metal,
    );
  }
  return merge(parts);
}

/** The four morph batches use one common GPU index for all ten bodies. Weld
 * only corners identical in every target and base attribute. A collapsed
 * roadster roof, hard glass edge or different lamp circuit stays independent. */
function indexTrafficCorners(geometry: T.BufferGeometry) {
  const morphs = [geometry.morphAttributes.position!, geometry.morphAttributes.normal!];
  const attributes = [
    ...Object.values(geometry.attributes),
    ...morphs.flat(),
  ] as T.BufferAttribute[];
  const count = attributes[0].count;
  const hashes = new Uint32Array(count).fill(2166136261);
  for (const { array, itemSize } of attributes) {
    const words =
      array instanceof Float32Array
        ? new Uint32Array(array.buffer, array.byteOffset, array.length)
        : array;
    for (let v = 0; v < count; v++)
      for (let k = 0; k < itemSize; k++)
        hashes[v] = Math.imul(hashes[v] ^ words[v * itemSize + k], 16777619);
  }
  const equal = (a: number, b: number) => {
    for (const { array, itemSize } of attributes)
      for (let k = 0; k < itemSize; k++)
        if (array[a * itemSize + k] !== array[b * itemSize + k]) return false;
    return true;
  };
  const buckets = new Map<number, number[]>(),
    sources: number[] = [];
  const index = count > 0xffff ? new Uint32Array(count) : new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    let bucket = buckets.get(hashes[i]);
    if (!bucket) buckets.set(hashes[i], (bucket = []));
    let slot = bucket.find((candidate) => equal(i, sources[candidate]));
    if (slot === undefined) {
      slot = sources.length;
      sources.push(i);
      bucket.push(slot);
    }
    index[i] = slot;
  }
  const pack = (attribute: T.BufferAttribute) => {
    const { array, itemSize } = attribute;
    const compact = array.slice(0, sources.length * itemSize);
    for (let i = 0; i < sources.length; i++)
      for (let k = 0; k < itemSize; k++)
        compact[i * itemSize + k] = array[sources[i] * itemSize + k];
    return new T.BufferAttribute(compact, itemSize, attribute.normalized);
  };
  for (const [name, field] of Object.entries(geometry.attributes))
    geometry.setAttribute(name, pack(field as T.BufferAttribute));
  for (const fields of morphs)
    for (let i = 0; i < fields.length; i++) fields[i] = pack(fields[i] as T.BufferAttribute);
  geometry.setIndex(new T.BufferAttribute(index, 1));
}

/** Native morph targets keep body, glass, trim and lamps at four draws.
 * The standard shadow path reads the same per-instance morphTexture. */
export function trafficMorphGeometry() {
  const base = trafficBodyGeometry(TRAFFIC_VISUAL_PROFILES[0]);
  for (const part of TRAFFIC_BODY_PARTS) {
    base[part].morphAttributes.position = [];
    base[part].morphAttributes.normal = [];
  }
  for (const profile of TRAFFIC_VISUAL_PROFILES.slice(1)) {
    const variant = trafficBodyGeometry(profile);
    for (const part of TRAFFIC_BODY_PARTS) {
      const g = variant[part],
        target = base[part];
      if (g.getAttribute('position').count !== target.getAttribute('position').count)
        throw new Error(`Traffic morph topology changed: ${profile.vehicle.id}/${part}`);
      target.morphAttributes.position!.push(g.getAttribute('position'));
      target.morphAttributes.normal!.push(g.getAttribute('normal'));
      // Attribute data is retained by the base; no GPU resources were created
      // for this temporary geometry object.
      g.dispose();
    }
  }
  for (const part of TRAFFIC_BODY_PARTS) {
    indexTrafficCorners(base[part]);
    base[part].computeBoundingBox();
    base[part].computeBoundingSphere();
  }
  return base;
}
