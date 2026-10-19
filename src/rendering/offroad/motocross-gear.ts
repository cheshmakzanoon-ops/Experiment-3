import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sampleProfile } from '../profile-sampling.ts';
import type { RiderDetail } from '../rider.ts';
import { mouldedPanel } from './motocross-detail.ts';

function part(parent: T.Object3D, g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0) {
  const mesh = new T.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

type ClothSection = readonly [number, number, number, number, number];
export type MotocrossGarment = 'jersey' | 'seat' | 'sleeve' | 'pants';

/** Metre-space textile sections, not anatomical capsules. Reference 004's
 * loose lower back and 020's broad underarms sit above a cinched separate
 * waistband; 026's pants gather over the knee and the top of the boot. */
const JERSEY_SECTIONS: readonly ClothSection[] = [
  [0.043, 0, 0.145, 0.094, 0.096],
  [0.062, -0.002, 0.157, 0.112, 0.114],
  [0.104, -0.007, 0.17, 0.119, 0.137],
  [0.165, -0.008, 0.17, 0.121, 0.133],
  [0.26, -0.002, 0.177, 0.128, 0.124],
  [0.35, 0.008, 0.193, 0.131, 0.112],
  [0.418, 0.015, 0.2, 0.125, 0.102],
  [0.452, 0.018, 0.19, 0.111, 0.094],
  [0.491, 0.022, 0.15, 0.079, 0.073],
  [0.522, 0.026, 0.096, 0.061, 0.056],
  [0.542, 0.028, 0.064, 0.054, 0.052],
];
const SEAT_SECTIONS: readonly ClothSection[] = [
  [-0.078, -0.006, 0.03, 0.025, 0.034],
  [-0.044, -0.005, 0.132, 0.094, 0.1],
  [0, -0.004, 0.149, 0.099, 0.109],
  [0.047, -0.002, 0.151, 0.097, 0.107],
  [0.093, 0, 0.143, 0.091, 0.098],
];

function garmentSections(kind: MotocrossGarment, upper: number, lower: number): ClothSection[] {
  if (kind === 'jersey') return JERSEY_SECTIONS.map((section) => [...section]);
  if (kind === 'seat') return SEAT_SECTIONS.map((section) => [...section]);
  const arm = kind === 'sleeve';
  const proximal: readonly ClothSection[] = arm
    ? [
        [-0.14, 0, 0.027, 0.028, 0.032],
        [-0.035, -0.003, 0.049, 0.047, 0.055],
        [0.09, -0.004, 0.06, 0.054, 0.066],
        [0.29, -0.004, 0.059, 0.052, 0.064],
        [0.54, -0.003, 0.052, 0.047, 0.057],
        [0.78, -0.001, 0.047, 0.043, 0.05],
        [1, 0, 0.046, 0.043, 0.048],
      ]
    : [
        [-0.12, 0, 0.042, 0.043, 0.047],
        [-0.025, -0.002, 0.073, 0.08, 0.079],
        [0.15, 0, 0.086, 0.091, 0.084],
        [0.35, 0.002, 0.084, 0.09, 0.078],
        [0.61, 0.003, 0.072, 0.08, 0.069],
        [0.82, 0.003, 0.062, 0.069, 0.061],
        [1, 0.003, 0.059, 0.062, 0.058],
      ];
  const distal: readonly ClothSection[] = arm
    ? [
        [0.12, -0.002, 0.048, 0.049, 0.052],
        [0.29, -0.004, 0.049, 0.049, 0.052],
        [0.5, -0.003, 0.043, 0.042, 0.046],
        [0.76, -0.001, 0.034, 0.034, 0.037],
        [0.94, 0, 0.028, 0.029, 0.031],
        [1.025, 0, 0.026, 0.028, 0.028],
      ]
    : [
        [0.12, 0.003, 0.059, 0.059, 0.059],
        [0.26, -0.001, 0.055, 0.052, 0.058],
        [0.43, -0.003, 0.047, 0.045, 0.049],
        [0.64, -0.002, 0.04, 0.038, 0.043],
        [1.02, 0, 0.03, 0.032, 0.032],
      ];
  return [
    ...proximal.map(
      ([t, z, width, front, back]): ClothSection => [t * upper, z, width, front, back],
    ),
    ...distal.map(
      ([t, z, width, front, back]): ClothSection => [upper + t * lower, z, width, front, back],
    ),
  ];
}

/** Closed cloth loft with finite cap UV footprints and a welded smooth wrap.
 * Folds occupy compression zones; quiet broad fabric spans stay readable.
 * The same longitudinal UV wraps once across each whole sleeve or pant leg,
 * so the garment no longer repeats a new printed stripe at every joint. */
export function motocrossGarmentGeometry(
  kind: MotocrossGarment,
  detail: RiderDetail,
  upper = 0.29,
  lower = 0.28,
) {
  const sections = garmentSections(kind, upper, lower),
    ys = sections.map((section) => section[0]),
    axes = [1, 2, 3, 4].map((axis) => sections.map((section) => section[axis])),
    sides = detail === 'high' ? 28 : detail === 'mid' ? 16 : 8,
    rows =
      kind === 'seat'
        ? detail === 'high'
          ? 16
          : detail === 'mid'
            ? 10
            : 6
        : detail === 'high'
          ? 64
          : detail === 'mid'
            ? 36
            : 18,
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    skinIndices: number[] = [],
    skinWeights: number[] = [],
    first = ys[0],
    last = ys[ys.length - 1],
    articulated = kind === 'sleeve' || kind === 'pants',
    transition = kind === 'sleeve' ? 0.067 : 0.086;
  const append = (x: number, y: number, z: number, u: number, v: number) => {
    positions.push(x, y, z);
    uv.push(u, v);
    if (articulated) {
      const weight = T.MathUtils.smoothstep(y, upper - transition, upper + transition);
      skinIndices.push(0, 1, 0, 0);
      skinWeights.push(1 - weight, weight, 0, 0);
    }
  };
  for (let row = 0; row <= rows; row++) {
    const t = row / rows,
      y = T.MathUtils.lerp(first, last, t),
      [centre, width, front, back] = axes.map((values) => sampleProfile(ys, values, y));
    for (let column = 0; column <= sides; column++) {
      const angle = (column / sides) * Math.PI * 2,
        c = Math.cos(angle),
        s = Math.sin(angle),
        envelope = Math.sin(t * Math.PI) ** 0.8;
      let fold = 0;
      if (kind === 'jersey') {
        const hem = Math.exp(-(((y - 0.115) / 0.07) ** 2)),
          underarm = Math.exp(-(((y - 0.365) / 0.082) ** 2)),
          side = Math.abs(c) ** 3;
        fold =
          0.0026 * Math.sin(angle * 7 + y * 11) * envelope +
          0.0064 * hem * Math.sin(y * 116 + s * 4 + c * 3) +
          0.0045 * underarm * side * Math.sin(y * 87 + s * 5);
      } else if (articulated) {
        const joint = Math.exp(-(((y - upper) / (kind === 'sleeve' ? 0.075 : 0.105)) ** 2)),
          hip = kind === 'pants' ? Math.exp(-(((y - 0.105) / 0.075) ** 2)) : 0,
          cuff = Math.exp(-(((y - (upper + lower * 0.88)) / 0.043) ** 2));
        fold =
          (0.0058 * joint * (0.65 + s * 0.35) + 0.0037 * hip) *
            Math.sin((y - upper) * 127 + c * 3.8) +
          0.002 * cuff * Math.sin(y * 169 + s * 3) +
          0.0013 * envelope * Math.sin(y * 39 + angle * 5);
      } else fold = 0.002 * envelope * Math.sin(y * 90 + angle * 5);
      // Rounded cloth facets give fabric a planar drape instead of a latex tube.
      const roundness = kind === 'jersey' ? 0.86 : 0.94,
        shape = (value: number) => Math.sign(value) * Math.abs(value) ** roundness;
      append(
        shape(c) * (width + fold),
        y,
        centre + shape(s) * ((s > 0 ? front : back) + fold),
        column / sides,
        t,
      );
      if (row < rows && column < sides) {
        const a = row * (sides + 1) + column,
          b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  // Duplicate cap corners retain their own planar UV and hard inside rim.
  for (const row of [0, rows]) {
    const y = row === 0 ? first : last,
      centreZ = sampleProfile(ys, axes[0], y),
      cap = positions.length / 3,
      ring = row * (sides + 1);
    append(0, y, centreZ, 0.5, row === 0 ? 0.012 : 0.988);
    for (let column = 0; column <= sides; column++) {
      const vertex = (ring + column) * 3,
        x = positions[vertex],
        z = positions[vertex + 2];
      append(x, y, z, 0.5 + x * 0.12, (row === 0 ? 0.012 : 0.988) + (z - centreZ) * 0.06);
    }
    for (let column = 0; column < sides; column++) {
      const a = cap + 1 + column;
      if (row === 0) indices.push(cap, a, a + 1);
      else indices.push(cap, a + 1, a);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.name = `Motocross continuous ${kind} (${detail})`;
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  if (articulated) {
    geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(skinWeights, 4));
  }
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal'),
    seam = new T.Vector3(),
    other = new T.Vector3();
  for (let row = 0; row <= rows; row++) {
    const a = row * (sides + 1),
      b = a + sides;
    seam.fromBufferAttribute(normals, a).add(other.fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, seam.x, seam.y, seam.z);
    normals.setXYZ(b, seam.x, seam.y, seam.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Two tiny render bones inherit the already solved IK transforms. The skin
 * spans the elbow/knee instead of intersecting two capped rigid meshes. This
 * adds no simulation state, pose history, per-frame buffers or CPU cloth pass. */
export function addMotocrossGarment(
  parent: T.Group,
  proximal: T.Group,
  distal: T.Group,
  upper: number,
  lower: number,
  kind: 'sleeve' | 'pants',
  detail: RiderDetail,
  material: T.Material,
) {
  const bones = [new T.Bone(), new T.Bone()];
  proximal.add(bones[0]);
  distal.add(bones[1]);
  const skeleton = new T.Skeleton(bones, [
    new T.Matrix4(),
    new T.Matrix4().makeTranslation(0, -upper, 0),
  ]);
  const mesh = new T.SkinnedMesh(motocrossGarmentGeometry(kind, detail, upper, lower), material);
  mesh.name = `Motocross continuous ${kind}`;
  mesh.bind(skeleton, new T.Matrix4());
  // An envelope of the entire local riding/recovery rig avoids stale automatic
  // bind-pose bounds while the bones move. It is independent of world travel.
  mesh.boundingSphere = new T.Sphere(new T.Vector3(0, 0.3, 0), 1.65);
  mesh.boundingBox = new T.Box3(new T.Vector3(-1.2, -1.15, -1.3), new T.Vector3(1.2, 1.8, 1.3));
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// Neck-centred assembly uses the same 150 mm shell offset as the road rig, but
// an MX shell has its own projected chin, lower cheek rail and taller eye port.
// Columns are [height, half-width, forward extent, rearward extent], in metres.
const MX_HELMET_PROFILE = [
  [-0.15, 0.046, 0.168, 0.056],
  [-0.127, 0.078, 0.232, 0.083],
  [-0.096, 0.107, 0.244, 0.11],
  [-0.067, 0.12, 0.224, 0.13],
  [-0.038, 0.132, 0.19, 0.14],
  [0.005, 0.136, 0.179, 0.142],
  [0.038, 0.134, 0.174, 0.138],
  [0.065, 0.124, 0.162, 0.128],
  [0.094, 0.103, 0.122, 0.105],
  [0.123, 0.074, 0.086, 0.077],
  [0.141, 0.037, 0.043, 0.039],
  [0.15, 0, 0, 0],
] as const;
const MX_HEIGHTS = MX_HELMET_PROFILE.map((p) => p[0]);
const MX_RADII = [1, 2, 3].map((axis) => MX_HELMET_PROFILE.map((p) => p[axis]));
const helmetV = (y: number) =>
  (y - MX_HEIGHTS[0]) / (MX_HEIGHTS[MX_HEIGHTS.length - 1] - MX_HEIGHTS[0]);

function motocrossHelmetPoint(y: number, phi: number, offset = 0) {
  const front = Math.max(0, Math.sin(phi)),
    jaw = 1 - T.MathUtils.smoothstep(y, -0.067, -0.025);
  return new T.Vector3(
    -Math.cos(phi) *
      (sampleProfile(MX_HEIGHTS, MX_RADII[0], y) + offset) *
      (1 - 0.11 * jaw * front ** 4),
    y + 0.018 * jaw * (1 - front),
    Math.sin(phi) *
      (front > 0 ? front ** (jaw * 0.7) : 1) *
      (sampleProfile(MX_HEIGHTS, MX_RADII[front > 0 ? 1 : 2], y) + offset),
  );
}

function motocrossHelmetPatch(
  y0: number,
  y1: number,
  phi0: number,
  phi1: number,
  offset: number,
  rows = 4,
  columns = 24,
) {
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      const p = motocrossHelmetPoint(
        T.MathUtils.lerp(y0, y1, row / rows),
        T.MathUtils.lerp(phi0, phi1, column / columns),
        offset,
      );
      positions.push(p.x, p.y, p.z);
      uv.push(column / columns, row / rows);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** The black return closes the shell thickness around the eye opening. A
 * recessed backing alone leaves a see-through slit at the exposed cut edge. */
function motocrossEyePortReturn(detail: RiderDetail) {
  const steps = detail === 'far' ? 8 : 24,
    outline: [number, number][] = [],
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < steps; i++)
    outline.push([0.065, T.MathUtils.lerp(Math.PI / 8, (Math.PI * 7) / 8, i / steps)]);
  for (let i = 0; i < steps; i++)
    outline.push([T.MathUtils.lerp(0.065, -0.038, i / steps), (Math.PI * 7) / 8]);
  for (let i = 0; i < steps; i++)
    outline.push([-0.038, T.MathUtils.lerp((Math.PI * 7) / 8, Math.PI / 8, i / steps)]);
  for (let i = 0; i < steps; i++)
    outline.push([T.MathUtils.lerp(-0.038, 0.065, i / steps), Math.PI / 8]);
  for (const [y, phi] of outline)
    for (const offset of [0, -0.013]) {
      const p = motocrossHelmetPoint(y, phi, offset);
      positions.push(p.x, p.y, p.z);
      uv.push(phi / (Math.PI * 2), helmetV(y));
    }
  for (let i = 0; i < outline.length; i++) {
    const a = i * 2,
      b = ((i + 1) % outline.length) * 2;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Dedicated MX silhouette at all LODs. The eye port is an actual opening in
 * the outer shell, backed by a recessed dark liner in addMotocrossHelmet;
 * race graphics therefore cannot show through the gap around the goggles. */
export function motocrossHelmetShell(detail: RiderDetail = 'high') {
  const columns = detail === 'high' ? 48 : detail === 'mid' ? 32 : 16,
    subdivisions = detail === 'high' ? 4 : detail === 'mid' ? 2 : 1,
    ys: number[] = [],
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < MX_HEIGHTS.length - 1; i++)
    for (let step = 0; step < subdivisions; step++)
      ys.push(T.MathUtils.lerp(MX_HEIGHTS[i], MX_HEIGHTS[i + 1], step / subdivisions));
  for (let row = 0; row < ys.length; row++)
    for (let column = 0; column <= columns; column++) {
      const p = motocrossHelmetPoint(ys[row], (column / columns) * Math.PI * 2);
      positions.push(p.x, p.y, p.z);
      uv.push(column / columns, helmetV(ys[row]));
      if (row < ys.length - 1 && column < columns) {
        const inEyePort =
          ys[row] >= -0.038 - 1e-9 &&
          ys[row + 1] <= 0.065 + 1e-9 &&
          column >= columns / 16 &&
          column < (columns * 7) / 16;
        if (inEyePort) continue;
        const a = row * (columns + 1) + column,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const top = positions.length / 3;
  positions.push(0, 0.15, 0);
  uv.push(0.5, 1);
  for (let i = 0; i < columns; i++)
    indices.push((ys.length - 1) * (columns + 1) + i, (ys.length - 1) * (columns + 1) + i + 1, top);
  const bottom = positions.length / 3;
  positions.push(0, ys[0], 0);
  uv.push(0.5, 0);
  for (let i = 0; i < columns; i++) indices.push(bottom, i + 1, i);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const normal = g.getAttribute('normal'),
    average = new T.Vector3();
  for (let row = 0; row < ys.length; row++) {
    const a = row * (columns + 1),
      b = a + columns;
    average
      .fromBufferAttribute(normal, a)
      .add(new T.Vector3().fromBufferAttribute(normal, b))
      .normalize();
    normal.setXYZ(a, average.x, average.y, average.z);
    normal.setXYZ(b, average.x, average.y, average.z);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function peakGeometry(detail: RiderDetail) {
  const rows = detail === 'high' ? 9 : 5,
    columns = detail === 'high' ? 14 : 8;
  const pos: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (const under of [false, true]) {
    const base = pos.length / 3;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= columns; i++) {
        const v = j / rows,
          u = (i / columns) * 2 - 1;
        const width = 0.11 + Math.sin(v * Math.PI) * 0.023 - v * 0.009;
        const y = 0.272 - v * v * 0.039 + 0.011 * (1 - u * u) - (under ? 0.0045 : 0);
        pos.push(u * width, y, 0.035 + v * (0.268 - 0.039 * Math.abs(u) ** 1.4));
        uv.push(i / columns, 1 - v);
        if (j < rows && i < columns) {
          const a = base + j * (columns + 1) + i,
            b = a + columns + 1;
          if (under) index.push(a, a + 1, b, a + 1, b + 1, b);
          else index.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
  }
  // Close the front and side lips so the peak remains a thin moulding in
  // backlit and underside views, rather than a pair of unrelated sheets.
  const stride = (rows + 1) * (columns + 1);
  for (let i = 0; i < columns; i++) {
    const a = rows * (columns + 1) + i,
      b = a + stride;
    index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  for (let row = 0; row < rows; row++)
    for (const column of [0, columns]) {
      const a = row * (columns + 1) + column,
        b = a + columns + 1;
      if (column === 0) index.push(a, a + stride, b, b, a + stride, b + stride);
      else index.push(a, b, a + stride, b, b + stride, a + stride);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function gogglePoint(u: number, v: number) {
  const x = (u * 2 - 1) * 0.112 * (1 - 0.105 * Math.abs(v * 2 - 1) ** 2),
    edge = Math.abs(u * 2 - 1);
  const bottom = 0.129 + Math.exp(-(((u - 0.5) * 11) ** 2)) * 0.021 + edge ** 4 * 0.01;
  const top = 0.207 - edge ** 2 * 0.009;
  return new T.Vector3(
    x,
    T.MathUtils.lerp(bottom, top, v),
    0.204 - edge * edge * 0.041 - (v - 0.5) ** 2 * 0.014,
  );
}

/** Peaked shell, curved mirrored goggles, foam gasket, real ribbon strap and
 * vented chin protector. All meshes are merged by the caller per material. */
export function addMotocrossHelmet(
  head: T.Group,
  detail: RiderDetail,
  shell: T.Material,
  lens: T.Material,
  trim: T.Material,
  accent: T.Material,
) {
  part(head, peakGeometry(detail), shell).name = 'Motocross swept helmet peak';
  part(
    head,
    motocrossHelmetPatch(-0.038, 0.065, Math.PI / 8, (Math.PI * 7) / 8, -0.013),
    trim,
    0,
    0.15,
    0.02,
  ).name = 'Motocross recessed eye-port liner';
  part(head, motocrossEyePortReturn(detail), trim, 0, 0.15, 0.02).name =
    'Motocross eye-port shell return';
  if (detail === 'far') {
    // Preserve the two defining off-road helmet features at distance without
    // retaining the close curved gasket, vents and fasteners.
    part(head, new T.BoxGeometry(0.198, 0.067, 0.024), trim, 0, 0.167, 0.186);
    part(head, new T.PlaneGeometry(0.17, 0.046), lens, 0, 0.171, 0.199);
    return;
  }
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    columns = detail === 'high' ? 24 : 12,
    rows = 5;
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= columns; i++) {
      const p = gogglePoint(i / columns, j / rows);
      positions.push(p.x, p.y, p.z);
      uv.push(i / columns, j / rows);
      if (j < rows && i < columns) {
        const a = j * (columns + 1) + i,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const lensGeometry = new T.BufferGeometry();
  lensGeometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  lensGeometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  lensGeometry.setIndex(indices);
  lensGeometry.computeVertexNormals();
  part(head, lensGeometry, lens).name = 'Motocross curved goggle lens';
  const outline: T.Vector3[] = [];
  for (const edge of [1, 0])
    for (let i = 0; i <= 24; i++) outline.push(gogglePoint(edge ? i / 24 : 1 - i / 24, edge));
  part(
    head,
    new T.TubeGeometry(new T.CatmullRomCurve3(outline, true), 60, 0.008, 6, true),
    trim,
  ).name = 'Motocross goggle foam gasket';
  const rim = part(
    head,
    new T.TubeGeometry(
      new T.CatmullRomCurve3(
        outline.map((p) => p.clone().add(new T.Vector3(0, 0, 0.003))),
        true,
      ),
      60,
      0.0034,
      5,
      true,
    ),
    accent,
  );
  rim.name = 'Motocross goggle frame';
  const strap = part(
    head,
    motocrossHelmetPatch(0.002, 0.034, Math.PI - 0.11, Math.PI * 2 + 0.11, 0.006, 2, 32),
    trim,
    0,
    0.15,
    0.02,
  );
  strap.name = 'Motocross woven goggle strap';
  const vent = part(
    head,
    motocrossHelmetPatch(-0.13, -0.076, 1.05, Math.PI - 1.05, 0.002),
    trim,
    0,
    0.15,
    0.02,
  );
  vent.name = 'Motocross integrated chin intake';
  for (let i = 0; i < 3; i++) {
    const y = -0.121 + i * 0.015;
    part(
      head,
      motocrossHelmetPatch(y, y + 0.003, 1.05, Math.PI - 1.05, 0.005, 1, 16),
      accent,
      0,
      0.15,
      0.02,
    );
  }
  for (const side of [-1, 1]) {
    // Outriggers bridge the curved goggle frame to the woven side strap;
    // they cast a narrow shadow behind the foam instead of floating at the eye.
    const outrigger = part(
      head,
      new RoundedBoxGeometry(0.012, 0.029, 0.097, 2, 0.005),
      trim,
      side * 0.125,
      0.169,
      0.121,
    );
    outrigger.name = 'Motocross goggle strap outrigger';
    outrigger.rotation.y = side * -0.27;
    const fastener = part(
      head,
      new T.CylinderGeometry(0.007, 0.007, 0.006, 8),
      accent,
      side * 0.12,
      0.255,
      0.065,
    );
    fastener.rotation.z = Math.PI / 2;
    const phi = side > 0 ? 0.64 : Math.PI - 0.96;
    part(
      head,
      motocrossHelmetPatch(0.095, 0.118, phi, phi + 0.32, 0.0018, 2, 8),
      trim,
      0,
      0.15,
      0.02,
    );
    part(
      head,
      motocrossHelmetPatch(-0.096, -0.07, phi, phi + 0.32, 0.0018, 2, 8),
      trim,
      0,
      0.15,
      0.02,
    );
  }
}

/** Off-road boots have a distinct calf, shin protector, ankle hinge, toe box,
 * rubber sole and four buckles. Coordinates match the existing ankle group. */
export function addMotocrossBoot(
  foot: T.Group,
  detail: RiderDetail,
  side: number,
  boot: T.Material,
  flex: T.Material,
  metal: T.Material,
) {
  const sides = detail === 'high' ? 16 : detail === 'mid' ? 10 : 6;
  const shaft = new T.LatheGeometry(
    [
      new T.Vector2(0.045, -0.325),
      new T.Vector2(0.057, -0.3),
      new T.Vector2(0.061, -0.23),
      new T.Vector2(0.054, -0.14),
      new T.Vector2(0.043, -0.052),
      new T.Vector2(0.044, -0.004),
    ],
    sides,
  );
  part(foot, shaft, boot).scale.set(0.93, 1, 0.9);
  part(
    foot,
    new RoundedBoxGeometry(0.089, 0.074, 0.234, detail === 'far' ? 1 : 3, 0.026),
    boot,
    0,
    -0.016,
    0.045,
  );
  part(foot, new RoundedBoxGeometry(0.096, 0.017, 0.251, 2, 0.007), flex, 0, 0.025, 0.052);
  if (detail === 'far') return;
  const protector = part(
    foot,
    mouldedPanel(
      [
        [-0.035, 0.1],
        [-0.043, 0.062],
        [-0.031, -0.084],
        [0.03, -0.084],
        [0.043, 0.062],
        [0.035, 0.1],
      ],
      0.007,
      0.003,
    ),
    boot,
    0,
    -0.204,
    0.052,
  );
  protector.name = 'Motocross moulded shin protector';
  const inset = part(
    foot,
    new RoundedBoxGeometry(0.044, 0.09, 0.008, 2, 0.006),
    flex,
    0,
    -0.208,
    0.059,
  );
  inset.rotation.z = side * 0.13;
  for (let i = 0; i < 4; i++) {
    const y = -0.061 - i * 0.064;
    const strap = part(foot, new T.TorusGeometry(0.052, 0.004, 5, sides), flex, 0, y, 0);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(1, 0.91, 1);
    const buckle = part(
      foot,
      new RoundedBoxGeometry(0.019, 0.014, 0.03, 2, 0.004),
      metal,
      side * 0.052,
      y,
      0.018,
    );
    buckle.name = 'Motocross boot buckle';
  }
  const hinge = part(
    foot,
    new T.CylinderGeometry(0.018, 0.018, 0.008, 12),
    flex,
    side * 0.046,
    -0.059,
    -0.004,
  );
  hinge.rotation.z = Math.PI / 2;
  part(foot, new RoundedBoxGeometry(0.073, 0.02, 0.055, 2, 0.005), flex, 0, -0.054, 0.07);
  if (detail === 'high')
    for (let rib = 0; rib < 4; rib++)
      part(
        foot,
        new RoundedBoxGeometry(0.068, 0.005, 0.01, 2, 0.002),
        boot,
        0,
        -0.066,
        0.033 + rib * 0.021,
      );
}
