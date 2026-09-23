import { addSeatedRestraints } from './driver-restraints.ts';
import { tailoredSleeve } from './driver-tailoring.ts';
import { fingerGripCurve } from './wheel-grip.ts';
import { bodySurfacePatch } from './car-surfaces.ts';
import { sculptedLoft } from './bodywork.ts';
import * as T from 'three';
import { mesh, mergeStatic } from './geometry.ts';
import type { driverMaterials } from './driver-materials.ts';

type Materials = ReturnType<typeof driverMaterials>;

/** Metre-valued glove construction. Four different fingers curl around the
 * existing grip; this is original geometry, not extracted character data. */
export function fingerGeometry(side: number, finger: number) {
  if ((side !== -1 && side !== 1) || !Number.isInteger(finger) || finger < 0 || finger > 3)
    throw new Error('Invalid glove finger');
  const curve = fingerGripCurve(side, finger);
  const steps = 20,
    sides = 16;
  const geometry = new T.TubeGeometry(curve, steps, 1, sides, false);
  const position = geometry.getAttribute('position');
  const centre = new T.Vector3();
  // Broader proximal phalanges, restrained knuckles and a rounded distal tip.
  // End caps close the glove; no transparent/open tube ends in close views.
  for (let row = 0; row <= steps; row++) {
    const u = row / steps;
    curve.getPointAt(u, centre);
    const capU = Math.max(0, (u - 0.8) / 0.2);
    const roundTip = Math.sqrt(Math.max(0.0025, 1 - capU * capU));
    const radius = (0.0088 - u * 0.0034) * (1 + 0.11 * Math.sin(u * Math.PI * 3) ** 8) * roundTip;
    for (let j = 0; j <= sides; j++) {
      const index = row * (sides + 1) + j;
      position.setXYZ(
        index,
        centre.x + (position.getX(index) - centre.x) * radius,
        // A gloved finger is flattened across the knuckle, not a round hose.
        // Its existing X/Z grip contact curve remains unchanged.
        centre.y + (position.getY(index) - centre.y) * radius * (0.82 + 0.1 * u),
        centre.z + (position.getZ(index) - centre.z) * radius,
      );
    }
  }
  const positions = Array.from(position.array);
  const uvs = Array.from(geometry.getAttribute('uv').array);
  const indices = Array.from(geometry.getIndex()!.array);
  for (const row of [0, steps]) {
    curve.getPointAt(row / steps, centre);
    const cap = positions.length / 3;
    positions.push(centre.x, centre.y, centre.z);
    uvs.push(0.5, 0.5);
    // Separate cap vertices preserve the skin's normals at the fingertip seam.
    for (let j = 0; j <= sides; j++) {
      const v = row * (sides + 1) + j;
      positions.push(position.getX(v), position.getY(v), position.getZ(v));
      uvs.push(
        0.5 + Math.cos((j / sides) * Math.PI * 2) * 0.5,
        0.5 + Math.sin((j / sides) * Math.PI * 2) * 0.5,
      );
    }
    for (let j = 0; j < sides; j++) {
      if (row === 0) indices.push(cap, cap + j + 1, cap + j + 2);
      else indices.push(cap, cap + j + 2, cap + j + 1);
    }
  }
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal'),
    average = new T.Vector3();
  for (let row = 0; row <= steps; row++) {
    const first = row * (sides + 1),
      last = first + sides;
    average
      .set(
        normal.getX(first) + normal.getX(last),
        normal.getY(first) + normal.getY(last),
        normal.getZ(first) + normal.getZ(last),
      )
      .normalize();
    normal.setXYZ(first, average.x, average.y, average.z);
    normal.setXYZ(last, average.x, average.y, average.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.finger = finger;
  return geometry;
}

export function buildGlove(side: number, m: Materials) {
  const root = new T.Group(),
    fixed = new T.Group(),
    index = new T.Group(),
    thumb = new T.Group();
  root.name = side < 0 ? 'Right anatomical glove' : 'Left anatomical glove';
  root.add(fixed);
  const palmSections = [
    [-0.053, 0.003, 0.014, 0.01],
    [-0.041, 0.002, 0.021, 0.016],
    [-0.012, 0.001, 0.028, 0.022],
    [0.013, 0, 0.029, 0.023],
    [0.037, 0.003, 0.025, 0.019],
    [0.045, 0.004, 0.017, 0.012],
  ] as const;
  const palmGeometry = sculptedLoft(palmSections, 0, 0.45);
  palmGeometry.rotateX(-Math.PI / 2);
  mesh(fixed, palmGeometry, m.glove);
  const back = bodySurfacePatch(
    palmSections,
    { z0: -0.036, z1: 0.031, u0: 0.3, u1: 0.7 },
    0,
    0.45,
    0.0008,
    12,
    16,
  );
  back.rotateX(-Math.PI / 2);
  mesh(fixed, back, m.panel);
  const palmGrip = bodySurfacePatch(
    palmSections,
    { z0: -0.031, z1: 0.024, u0: 0.04, u1: 0.23 },
    0,
    0.45,
    0.0008,
  );
  palmGrip.rotateX(-Math.PI / 2);
  mesh(fixed, palmGrip, m.grip);
  // A fitted, flattened gauntlet overlaps the suit's wrist anchor. It is not
  // a rigid circular pipe around an otherwise anatomical palm.
  const cuffGeometry = sculptedLoft(
    [
      [-0.043, 0, 0.0275, 0.023],
      [-0.033, 0, 0.03, 0.025],
      [-0.011, 0.001, 0.032, 0.026],
      [0.005, 0.002, 0.025, 0.02],
      [0.018, 0.003, 0.02, 0.014],
    ],
    0,
    0.3,
  );
  cuffGeometry.rotateX(-Math.PI / 2);
  const cuff = mesh(fixed, cuffGeometry, m.glove, 0, -0.035, -0.02);
  cuff.rotation.x = -0.8;
  const cuffBand = mesh(
    fixed,
    new T.TorusGeometry(0.0288, 0.0013, 6, 32),
    m.panel,
    0,
    -0.05,
    -0.035,
  );
  cuffBand.scale.y = 0.87;
  cuffBand.rotation.x = Math.PI / 2 - 0.8;
  const closure = mesh(
    fixed,
    new T.CapsuleGeometry(0.006, 0.029, 4, 12),
    m.panel,
    side * 0.026,
    -0.036,
    -0.026,
  );
  closure.rotation.z = side * 0.24;
  closure.scale.z = 0.38;
  const seamPoints = Array.from({ length: 17 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return new T.Vector3(Math.cos(a) * 0.023, -0.003 + Math.sin(a) * 0.036, -0.0233);
  });
  mesh(
    fixed,
    new T.TubeGeometry(new T.CatmullRomCurve3(seamPoints, true), 40, 0.00035, 5, true),
    m.stitch,
  );
  for (let finger = 0; finger < 4; finger++) {
    mesh(finger === 0 ? index : fixed, fingerGeometry(side, finger), m.glove);
    const knuckle = mesh(
      fixed,
      new T.SphereGeometry(1, 12, 8),
      m.panel,
      side * 0.018,
      0.028 - finger * 0.018,
      -0.024,
    );
    knuckle.scale.set(0.009, 0.006, 0.003);
  }
  // One continuous opposed thumb with a flattened distal pad, rather than a
  // sphere glued to a capsule. Its base remains buried in the palm while the
  // tip rests on the real wheel-button row.
  const thumbProfile = [
    [0, -0.016],
    [0.009, -0.014],
    [0.013, -0.006],
    [0.013, 0.005],
    [0.011, 0.015],
    [0.009, 0.025],
    [0.007, 0.033],
    [0.003, 0.038],
    [0, 0.039],
  ].map((p) => new T.Vector2(p[0], p[1]));
  const thumbSurface = new T.LatheGeometry(thumbProfile, 24);
  const tp = thumbSurface.getAttribute('position');
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i),
      u = T.MathUtils.smoothstep(y, -0.01, 0.037);
    tp.setXYZ(i, tp.getX(i) - side * 0.012 * u, y, tp.getZ(i) * 0.82 + 0.007 * u);
  }
  thumbSurface.computeVertexNormals();
  mesh(thumb, thumbSurface, m.glove);
  const tipGrip = mesh(
    thumb,
    new T.SphereGeometry(1, 16, 10),
    m.grip,
    -side * 0.0105,
    0.028,
    0.014,
  );
  tipGrip.scale.set(0.006, 0.008, 0.0015);
  thumb.position.set(-side * 0.023, -0.004, -0.035);
  mergeStatic(fixed);
  // The one index mesh retains its topology for anchored paddle articulation.
  mergeStatic(thumb);
  root.add(index, thumb);
  return { root, thumb, index };
}

/** A one-metre sleeve is scaled ONLY along its bone axis by the IK rig. The
 * restrained folds are modelled, not a screen-space normal/noise animation. */
export function sleeveGeometry(upper: boolean) {
  return tailoredSleeve(upper);
}

/** A woven webbing strip with real thickness and a curved path over the chest.
 * It is static in the restrained torso frame; there is no fabricated belt motion. */
export function harnessRibbon(points: readonly T.Vector3[], width: number) {
  if (
    points.length < 2 ||
    !Number.isFinite(width) ||
    width <= 0 ||
    width > 0.1 ||
    points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
  )
    throw new Error('Invalid harness ribbon');
  const curve = new T.CatmullRomCurve3(points.map((p) => p.clone()));
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const rows = 24,
    tangent = new T.Vector3(),
    across = new T.Vector3();
  for (let i = 0; i <= rows; i++) {
    const p = curve.getPoint(i / rows);
    curve.getTangent(i / rows, tangent);
    across.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
    if (across.lengthSq() < 1e-8) across.set(0, 1, 0).addScaledVector(tangent, -tangent.y);
    across.normalize().multiplyScalar(width / 2);
    for (const [side, depth] of [
      [-1, 0],
      [1, 0],
      [1, -0.0035],
      [-1, -0.0035],
    ]) {
      positions.push(p.x + across.x * side, p.y + across.y * side, p.z + across.z * side + depth);
      uv.push(side > 0 ? 1 : 0, i / rows);
    }
    if (i < rows)
      for (let j = 0; j < 4; j++) {
        const a = i * 4 + j,
          b = i * 4 + ((j + 1) % 4);
        indices.push(a, b, a + 4, b, b + 4, a + 4);
      }
  }
  indices.push(
    0,
    2,
    1,
    0,
    3,
    2,
    rows * 4,
    rows * 4 + 1,
    rows * 4 + 2,
    rows * 4,
    rows * 4 + 2,
    rows * 4 + 3,
  );
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function buildDriverTorso(parent: T.Group, m: Materials, includeSuit = true) {
  const torso = sculptedLoft(
    [
      [-0.28, 0.485, 0.102, 0.064],
      [-0.22, 0.472, 0.149, 0.092],
      [-0.1, 0.473, 0.174, 0.105],
      [-0.015, 0.465, 0.167, 0.092],
      [0.045, 0.447, 0.139, 0.086],
      [0.092, 0.437, 0.081, 0.067],
    ],
    0,
    0.35,
  );
  torso.rotateX(-Math.PI / 2);
  if (includeSuit) mesh(parent, torso, m.suit);
  else torso.dispose();
  const neckGeometry = sculptedLoft(
    [
      [0.094, 0.424, 0.069, 0.057],
      [0.118, 0.416, 0.065, 0.057],
      [0.149, 0.411, 0.061, 0.054],
      [0.177, 0.407, 0.059, 0.051],
    ],
    0,
    0.2,
  );
  neckGeometry.rotateX(-Math.PI / 2);
  mesh(parent, neckGeometry, m.panel);
  const collar = mesh(parent, new T.TorusGeometry(0.071, 0.008, 8, 32), m.suit, 0, 0.094, -0.417);
  collar.rotation.x = Math.PI / 2 - 0.17;
  // Moulded neck restraint: a flat laminated yoke, not an inflatable-looking
  // cylindrical collar. Its two wings sit beneath the shoulder webbing.
  const yokePath = new T.CatmullRomCurve3(
    [
      [-0.108, 0.05, -0.393],
      [-0.105, 0.103, -0.439],
      [-0.065, 0.119, -0.484],
      [0, 0.124, -0.5],
      [0.065, 0.119, -0.484],
      [0.105, 0.103, -0.439],
      [0.108, 0.05, -0.393],
    ].map((p) => new T.Vector3(...p)),
  );
  const yoke = new T.TubeGeometry(yokePath, 48, 1, 12, false);
  const yp = yoke.getAttribute('position'),
    c = new T.Vector3(),
    tangent = new T.Vector3(),
    across = new T.Vector3(),
    normal = new T.Vector3();
  for (let row = 0; row <= 48; row++) {
    const t = row / 48;
    yokePath.getPointAt(t, c);
    yokePath.getTangentAt(t, tangent);
    across.set(0, 1, 0).cross(tangent).normalize();
    normal.crossVectors(tangent, across).normalize();
    for (let j = 0; j <= 12; j++) {
      const a = (j / 12) * Math.PI * 2;
      yp.setXYZ(
        row * 13 + j,
        c.x + across.x * Math.cos(a) * 0.026 + normal.x * Math.sin(a) * 0.005,
        c.y + across.y * Math.cos(a) * 0.026 + normal.y * Math.sin(a) * 0.005,
        c.z + across.z * Math.cos(a) * 0.026 + normal.z * Math.sin(a) * 0.005,
      );
    }
  }
  yoke.computeVertexNormals();
  mesh(parent, yoke, m.grip);
  if (!includeSuit) {
    addSeatedRestraints(parent, m.grip, m.stitch);
    mergeStatic(parent);
    return;
  }
  for (const side of [-1, 1]) {
    const path = [
      [side * 0.111, 0.039, -0.504],
      [side * 0.125, 0.07, -0.432],
      [side * 0.103, -0.035, -0.368],
      [side * 0.075, -0.125, -0.367],
      [side * 0.034, -0.22, -0.38],
    ].map((p) => new T.Vector3(...(p as [number, number, number])));
    mesh(parent, harnessRibbon(path, 0.044), m.grip);
    // Cloth edge binding shares the existing torso material submissions.
    for (const edge of [-1, 1])
      mesh(
        parent,
        harnessRibbon(
          path.map((p) => new T.Vector3(p.x + edge * 0.019, p.y, p.z + 0.0007)),
          0.002,
        ),
        m.panel,
      );
    const lap = [
      [side * 0.139, -0.234, -0.442],
      [side * 0.09, -0.23, -0.388],
      [side * 0.025, -0.224, -0.378],
    ].map((p) => new T.Vector3(...(p as [number, number, number])));
    mesh(parent, harnessRibbon(lap, 0.036), m.grip);
  }
  const buckle = mesh(
    parent,
    new T.CylinderGeometry(0.022, 0.024, 0.009, 12),
    m.panel,
    0,
    -0.221,
    -0.371,
  );
  buckle.rotation.x = Math.PI / 2;
  mergeStatic(parent);
}

export interface DriverBodyPose {
  compression: number;
  headRoll: number;
  headPitch: number;
}

/** Seat belts restrain the shoulder anchors. Acceleration compresses the suit
 * and tilts the helmet, never stretching the arms to reach the wheel. The same
 * recorded load yields the same pose after pause/seek; there is no idle timer. */
export function driverBodyPose(
  lateralG: number,
  longitudinalG: number,
  verticalG: number,
  out: DriverBodyPose = { compression: 0, headRoll: 0, headPitch: 0 },
) {
  if (!Number.isFinite(lateralG) || !Number.isFinite(longitudinalG) || !Number.isFinite(verticalG))
    throw new Error('Invalid driver load sample');
  out.compression = T.MathUtils.clamp(verticalG - 1, -2, 4) * 0.001;
  out.headRoll = T.MathUtils.clamp(lateralG, -5, 5) * 0.013;
  out.headPitch = -T.MathUtils.clamp(longitudinalG, -6, 6) * 0.009;
  return out;
}
