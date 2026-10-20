import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sampleProfile } from '../profile-sampling.ts';
import type { RiderDetail } from '../rider.ts';

function part(parent: T.Group, geometry: T.BufferGeometry, material: T.Material, name: string) {
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Reconcile the duplicated UV seam without blunting separate cap normals. */
function finish(
  positions: number[],
  uv: number[],
  indices: number[],
  rows: number,
  sides: number,
  name: string,
) {
  const geometry = new T.BufferGeometry();
  geometry.name = name;
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal'),
    a = new T.Vector3(),
    b = new T.Vector3();
  for (let row = 0; row <= rows; row++) {
    const first = row * (sides + 1),
      last = first + sides;
    a.fromBufferAttribute(normal, first).add(b.fromBufferAttribute(normal, last)).normalize();
    normal.setXYZ(first, a.x, a.y, a.z);
    normal.setXYZ(last, a.x, a.y, a.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// The boot runs down -Y from the ankle group. Its foot extends along +Z.
// A single last joins the calf, instep, heel and tapered toe: no cylinder
// intersection or pill-shaped shoe can remain visible in a foot-dab pose.
// Reference 005's articulated boot and 011's exposed sole guide the forms.
const BOOT_SECTIONS = [
  [-0.325, 0.048, 0.039, 0.043],
  [-0.302, 0.053, 0.044, 0.048],
  [-0.247, 0.057, 0.052, 0.052],
  [-0.196, 0.056, 0.051, 0.054],
  [-0.136, 0.049, 0.044, 0.049],
  [-0.082, 0.043, 0.046, 0.043],
  [-0.06, 0.044, 0.073, 0.05],
  [-0.045, 0.046, 0.116, 0.066],
  [-0.029, 0.049, 0.151, 0.077],
  [-0.011, 0.05, 0.164, 0.079],
  [0.008, 0.049, 0.163, 0.078],
  [0.019, 0.046, 0.157, 0.072],
] as const;
const BOOT_HEIGHTS = BOOT_SECTIONS.map((section) => section[0]);
const BOOT_RADII = [1, 2, 3].map((axis) => BOOT_SECTIONS.map((section) => section[axis]));

function bootPoint(y: number, phi: number, side: number, offset = 0) {
  const width = sampleProfile(BOOT_HEIGHTS, BOOT_RADII[0], y),
    front = sampleProfile(BOOT_HEIGHTS, BOOT_RADII[1], y),
    rear = sampleProfile(BOOT_HEIGHTS, BOOT_RADII[2], y),
    shoe = T.MathUtils.smoothstep(y, -0.071, -0.019),
    c = Math.cos(phi),
    s = Math.sin(phi),
    // A flatter medial side and shorter lateral toe make an actual left/right
    // last. The heel remains narrow instead of becoming a symmetric oval.
    x = Math.sign(c) * Math.abs(c) ** (0.98 - shoe * 0.2),
    z = Math.sign(s) * Math.abs(s) ** (0.97 - shoe * 0.17),
    toe = Math.max(0, s) ** 4,
    taper = 1 - shoe * (0.11 * Math.max(c, 0) + 0.015 * Math.max(-c, 0)) * toe;
  return new T.Vector3(
    side * (x * (width + offset) - shoe * 0.003 * toe),
    y,
    z * ((s > 0 ? front : rear) + offset) * taper,
  );
}

export function motocrossBootShell(detail: RiderDetail, side: number) {
  const sides = detail === 'high' ? 28 : detail === 'mid' ? 18 : 10,
    subdivisions = detail === 'high' ? 4 : detail === 'mid' ? 2 : 1,
    heights: number[] = [],
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let row = 0; row < BOOT_HEIGHTS.length - 1; row++)
    for (let i = 0; i < subdivisions; i++)
      heights.push(T.MathUtils.lerp(BOOT_HEIGHTS[row], BOOT_HEIGHTS[row + 1], i / subdivisions));
  heights.push(BOOT_HEIGHTS[BOOT_HEIGHTS.length - 1]);
  const rows = heights.length - 1;
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= sides; column++) {
      const p = bootPoint(heights[row], (column / sides) * Math.PI * 2, side);
      positions.push(p.x, p.y, p.z);
      uv.push(column / sides, (heights[row] - BOOT_HEIGHTS[0]) / 0.344);
      if (row < rows && column < sides) {
        const a = row * (sides + 1) + column,
          b = a + sides + 1;
        if (side > 0) indices.push(a, b, a + 1, a + 1, b, b + 1);
        else indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  for (const row of [0, rows]) {
    const cap = positions.length / 3;
    positions.push(0, heights[row], 0);
    uv.push(0.5, row === 0 ? 0.04 : 0.96);
    for (let column = 0; column <= sides; column++) {
      const at = (row * (sides + 1) + column) * 3;
      positions.push(positions[at], positions[at + 1], positions[at + 2]);
      uv.push(0.5 + positions[at] * 0.7, (row === 0 ? 0.04 : 0.96) + positions[at + 2] * 0.18);
    }
    for (let column = 0; column < sides; column++) {
      const a = cap + column + 1;
      if ((row === 0) === side > 0) indices.push(cap, a, a + 1);
      else indices.push(cap, a + 1, a);
    }
  }
  return finish(positions, uv, indices, rows, sides, `Motocross anatomical boot last (${detail})`);
}

/** Front and side overlays conform to the last, including the instep. */
function bootPanel(
  detail: RiderDetail,
  side: number,
  y0: number,
  y1: number,
  phi0: number,
  phi1: number,
  offset: number,
  diagonal = 0,
) {
  const rows = Math.max(
      1,
      Math.min(
        detail === 'high' ? 10 : 6,
        Math.ceil((y1 - y0) / (detail === 'high' ? 0.016 : 0.028)),
      ),
    ),
    columns = detail === 'high' ? 16 : 10,
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      const u = column / columns,
        v = row / rows,
        phi = T.MathUtils.lerp(phi0, phi1, u),
        p = bootPoint(T.MathUtils.lerp(y0, y1, v) + diagonal * Math.cos(phi), phi, side, offset);
      positions.push(p.x, p.y, p.z);
      uv.push(u, v);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column,
          b = a + columns + 1;
        if (side > 0) indices.push(a, b, a + 1, a + 1, b, b + 1);
        else indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function motocrossBootSole(detail: RiderDetail, side: number) {
  const shape = new T.Shape();
  shape.moveTo(side * 0.018, -0.081);
  shape.bezierCurveTo(side * 0.053, -0.083, side * 0.048, -0.045, side * 0.045, -0.004);
  shape.bezierCurveTo(side * 0.054, 0.048, side * 0.053, 0.112, side * 0.033, 0.154);
  shape.bezierCurveTo(side * 0.021, 0.174, side * -0.014, 0.18, side * -0.039, 0.157);
  shape.bezierCurveTo(side * -0.051, 0.135, side * -0.052, 0.047, side * -0.048, 0.005);
  shape.bezierCurveTo(side * -0.045, -0.032, side * -0.051, -0.078, side * -0.018, -0.081);
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: 0.011,
    steps: 1,
    bevelEnabled: detail !== 'far',
    bevelSize: 0.0017,
    bevelThickness: 0.0015,
    bevelSegments: 1,
    curveSegments: detail === 'high' ? 8 : detail === 'mid' ? 5 : 3,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0.03, 0);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const arch = 0.004 * Math.exp(-(((positions.getZ(i) + 0.004) / 0.033) ** 2));
    positions.setY(i, positions.getY(i) - arch);
  }
  geometry.computeVertexNormals();
  geometry.name = `Motocross shaped sole with heel and toe (${detail})`;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Four low-profile closures, a separate shin plate, medial grip pad and
 * ankle flex bellows follow the continuous boot instead of wrapping it in
 * floating torus bands. Everything remains rigid under the solved ankle. */
export function addMotocrossBoot(
  foot: T.Group,
  detail: RiderDetail,
  side: number,
  boot: T.Material,
  flex: T.Material,
  metal: T.Material,
) {
  part(foot, motocrossBootShell(detail, side), boot, 'Motocross continuous calf instep and toe');
  part(foot, motocrossBootSole(detail, side), flex, 'Motocross shaped rubber sole');
  if (detail === 'far') return;
  part(
    foot,
    bootPanel(detail, side, -0.304, -0.132, 0.73, 2.41, 0.0034),
    boot,
    'Motocross fitted shin shield',
  );
  for (const phi of [1.19, 1.88])
    part(
      foot,
      bootPanel(detail, side, -0.283, -0.165, phi, phi + 0.055, 0.0042),
      flex,
      'Motocross recessed shin relief',
    );
  part(
    foot,
    bootPanel(detail, side, -0.324, -0.318, 0, Math.PI * 2, 0.0012),
    flex,
    'Motocross rolled boot cuff',
  );
  part(
    foot,
    bootPanel(detail, side, -0.248, -0.098, 2.68, 3.72, 0.0018),
    flex,
    'Motocross medial frame grip pad',
  );
  part(
    foot,
    bootPanel(detail, side, -0.133, -0.05, 3.78, 5.65, 0.0015),
    flex,
    'Motocross Achilles flex insert',
  );
  for (let i = 0; i < 4; i++) {
    const y = -0.273 + i * 0.066;
    part(
      foot,
      bootPanel(detail, side, y - 0.008, y + 0.008, -0.13, 2.93, 0.002, 0.0055),
      flex,
      'Motocross closure underlap',
    );
    part(
      foot,
      bootPanel(detail, side, y - 0.0065, y + 0.0065, -0.13, 2.93, 0.0034, 0.0055),
      boot,
      'Motocross fitted closure band',
    );
    const point = bootPoint(y + 0.0055, 0.18, side, 0.007),
      buckle = part(
        foot,
        new RoundedBoxGeometry(0.009, 0.018, 0.036, 2, 0.003),
        metal,
        'Motocross recessed closure buckle',
      );
    buckle.position.copy(point);
    const latch = part(
      foot,
      new RoundedBoxGeometry(0.003, 0.009, 0.024, 1, 0.0014),
      boot,
      'Motocross buckle lever',
    );
    latch.position.copy(point).add(new T.Vector3(side * 0.0055, 0, 0));
  }
  const hinge = part(
    foot,
    new T.CylinderGeometry(0.021, 0.021, 0.008, 16),
    flex,
    'Motocross ankle flex pivot',
  );
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(side * 0.046, -0.074, -0.012);
  const hingeCap = part(
    foot,
    new T.CylinderGeometry(0.012, 0.012, 0.01, 12),
    boot,
    'Motocross ankle pivot cover',
  );
  hingeCap.rotation.z = Math.PI / 2;
  hingeCap.position.copy(hinge.position);
  for (let i = 0; i < (detail === 'high' ? 5 : 3); i++) {
    const y = -0.123 + i * 0.013;
    part(
      foot,
      bootPanel(detail, side, y, y + 0.0035, 3.88, 5.55, 0.0034),
      boot,
      'Motocross rear ankle flex rib',
    );
  }
  // A broad replaceable toe bumper follows the shoe rather than sitting on
  // top of it as a row of boxes. Its small lip shades the rubber sole edge.
  part(
    foot,
    bootPanel(detail, side, -0.022, 0.014, 0.78, 2.38, 0.0024),
    boot,
    'Motocross wraparound toe bumper',
  );
  if (detail === 'high')
    for (let row = 0; row < 7; row++) {
      const z = -0.067 + row * 0.034,
        width = row === 0 ? 0.027 : row === 6 ? 0.025 : 0.035;
      for (const x of [-1, 1]) {
        const tread = part(
          foot,
          new T.BoxGeometry(width, 0.0025, 0.013),
          flex,
          'Motocross sole traction block',
        );
        tread.position.set(
          x * (width * 0.5 + 0.003),
          0.033 - 0.004 * Math.exp(-(((z + 0.004) / 0.033) ** 2)),
          z,
        );
        tread.rotation.y = x * 0.12;
      }
    }
}

/** Metacarpal volume tapers into a short textile cuff. The dorsal panel is
 * a conforming patch; it cannot become a separate rectangular knuckle slab. */
function palmPoint(u: number, v: number, side: number, offset = 0) {
  const z = T.MathUtils.lerp(-0.024, 0.052, v),
    width = sampleProfile([0, 0.2, 0.53, 0.82, 1], [0.023, 0.029, 0.035, 0.034, 0.024], v),
    height = sampleProfile([0, 0.3, 0.68, 1], [0.015, 0.022, 0.021, 0.012], v),
    angle = u * Math.PI * 2;
  return new T.Vector3(
    side * Math.cos(angle) * (width + offset),
    Math.sin(angle) * (height + offset) - 0.002 * Math.cos(angle),
    z,
  );
}

export function motocrossGlovePalm(detail: RiderDetail, side: number) {
  const rows = detail === 'high' ? 14 : detail === 'mid' ? 9 : 5,
    sides = detail === 'high' ? 20 : detail === 'mid' ? 12 : 8,
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= sides; column++) {
      const p = palmPoint(column / sides, row / rows, side);
      positions.push(p.x, p.y, p.z);
      uv.push(column / sides, row / rows);
      if (row < rows && column < sides) {
        const a = row * (sides + 1) + column,
          b = a + sides + 1;
        if (side > 0) indices.push(a, a + 1, b, a + 1, b + 1, b);
        else indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  for (const row of [0, rows]) {
    const cap = positions.length / 3;
    positions.push(0, 0, row === 0 ? -0.024 : 0.052);
    uv.push(0.5, row === 0 ? 0.04 : 0.96);
    for (let column = 0; column <= sides; column++) {
      const at = (row * (sides + 1) + column) * 3;
      positions.push(positions[at], positions[at + 1], positions[at + 2]);
      uv.push(0.5 + positions[at] * 2, (row === 0 ? 0.04 : 0.96) + positions[at + 1]);
    }
    for (let column = 0; column < sides; column++) {
      const a = cap + column + 1;
      if ((row === 0) === side > 0) indices.push(cap, a + 1, a);
      else indices.push(cap, a, a + 1);
    }
  }
  return finish(positions, uv, indices, rows, sides, `Motocross shaped glove palm (${detail})`);
}

function digit(points: T.Vector3[], radius: number, detail: RiderDetail) {
  const curve = new T.CatmullRomCurve3(points),
    rows = detail === 'high' ? 14 : 8,
    sides = detail === 'high' ? 8 : 6,
    frames = curve.computeFrenetFrames(rows, false),
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    centre = new T.Vector3(),
    radial = new T.Vector3();
  for (let row = 0; row <= rows; row++) {
    const t = row / rows,
      tip = T.MathUtils.smoothstep(t, 0.79, 1),
      r = radius * (1 - 0.2 * t) * (1 - tip * 0.86);
    curve.getPointAt(t, centre);
    for (let column = 0; column <= sides; column++) {
      const angle = (column / sides) * Math.PI * 2;
      radial
        .copy(frames.normals[row])
        .multiplyScalar(-Math.cos(angle))
        .addScaledVector(frames.binormals[row], Math.sin(angle))
        .multiplyScalar(r)
        .add(centre);
      positions.push(radial.x, radial.y, radial.z);
      uv.push(column / sides, t);
      if (row < rows && column < sides) {
        const a = row * (sides + 1) + column,
          b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  // Both ends are closed; the small terminal fan has a nonzero UV footprint.
  for (const row of [0, rows]) {
    const cap = positions.length / 3;
    curve.getPointAt(row / rows, centre);
    positions.push(centre.x, centre.y, centre.z);
    uv.push(0.5, row === 0 ? 0.015 : 0.985);
    for (let column = 0; column <= sides; column++) {
      const at = (row * (sides + 1) + column) * 3,
        angle = (column / sides) * Math.PI * 2;
      positions.push(positions[at], positions[at + 1], positions[at + 2]);
      uv.push(0.5 + Math.cos(angle) * 0.01, (row === 0 ? 0.015 : 0.985) + Math.sin(angle) * 0.01);
    }
    for (let column = 0; column < sides; column++) {
      const a = cap + column + 1;
      if (row === 0) indices.push(cap, a, a + 1);
      else indices.push(cap, a + 1, a);
    }
  }
  return finish(positions, uv, indices, rows, sides, 'Motocross tapered curled glove digit');
}

export function addMotocrossGlove(
  hand: T.Group,
  detail: RiderDetail,
  side: number,
  palm: T.Material,
  textile: T.Material,
  flex: T.Material,
) {
  part(hand, motocrossGlovePalm(detail, side), palm, 'Motocross anatomical glove palm');
  if (detail === 'far') return;
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    rows = detail === 'high' ? 10 : 6,
    columns = detail === 'high' ? 12 : 8;
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      const v = T.MathUtils.lerp(0.05, 0.86, row / rows),
        u = T.MathUtils.lerp(0.055, 0.445, column / columns),
        p = palmPoint(u, v, side, 0.0007);
      positions.push(p.x, p.y, p.z);
      uv.push(column / columns, row / rows);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column,
          b = a + columns + 1;
        if (side > 0) indices.push(a, a + 1, b, a + 1, b + 1, b);
        else indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  const patch = new T.BufferGeometry();
  patch.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  patch.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  patch.setIndex(indices);
  patch.computeVertexNormals();
  part(hand, patch, textile, 'Motocross flexible textile glove back');
  for (let finger = 0; finger < 4; finger++) {
    const x = side * (-0.024 + finger * 0.016),
      reach = [0.031, 0.04, 0.036, 0.027][finger],
      radius = finger === 3 ? 0.0061 : 0.007;
    part(
      hand,
      digit(
        [
          new T.Vector3(x, 0.008, 0.038),
          new T.Vector3(x, 0.01, 0.048 + reach * 0.45),
          new T.Vector3(x, -0.007, 0.046 + reach),
          new T.Vector3(x, -0.024, 0.044 + reach * 0.7),
        ],
        radius,
        detail,
      ),
      palm,
      'Motocross individually tapered curled finger',
    );
    if (detail === 'high') {
      const grip = part(
        hand,
        new RoundedBoxGeometry(0.009, 0.0025, 0.016, 2, 0.0012),
        flex,
        'Motocross flexible finger grip ridge',
      );
      grip.position.set(x, 0.017, 0.048);
    }
  }
  part(
    hand,
    digit(
      [
        new T.Vector3(-side * 0.024, -0.006, 0.005),
        new T.Vector3(-side * 0.043, -0.014, 0.017),
        new T.Vector3(-side * 0.036, -0.028, 0.039),
        new T.Vector3(-side * 0.023, -0.029, 0.043),
      ],
      0.0088,
      detail,
    ),
    palm,
    'Motocross opposing wrapped thumb',
  );
}
