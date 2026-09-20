import * as T from 'three';
import { mesh, mergeStatic } from './geometry.ts';
import type { driverMaterials } from './driver-materials.ts';

type Materials = ReturnType<typeof driverMaterials>;

/** Metre-valued glove construction. Four different fingers curl around the
 * existing grip; this is original geometry, not extracted character data. */
export function fingerGeometry(side: number, finger: number) {
  if ((side !== -1 && side !== 1) || !Number.isInteger(finger) || finger < 0 || finger > 3)
    throw new Error('Invalid glove finger');
  const y = 0.028 - finger * 0.018;
  const reach = [1, 1.06, 0.98, 0.82][finger];
  const curve = new T.CatmullRomCurve3([
    new T.Vector3(side * 0.008, y, -0.022),
    new T.Vector3(side * 0.029 * reach, y + 0.001, -0.019),
    new T.Vector3(side * 0.038 * reach, y, 0.002),
    new T.Vector3(side * 0.028 * reach, y - 0.002, 0.028),
    new T.Vector3(side * 0.007 * reach, y - 0.004, 0.034),
  ]);
  const steps = 20, sides = 16;
  const geometry = new T.TubeGeometry(curve, steps, 1, sides, false);
  const position = geometry.getAttribute('position');
  const centre = new T.Vector3();
  // Broader proximal phalanges, restrained knuckles and a rounded distal tip.
  // End caps close the glove; no transparent/open tube ends in close views.
  for (let row = 0; row <= steps; row++) {
    const u = row / steps;
    curve.getPointAt(u, centre);
    const radius = (0.0088 - u * 0.0034) * (1 + 0.11 * Math.sin(u * Math.PI * 3) ** 8);
    for (let j = 0; j <= sides; j++) {
      const index = row * (sides + 1) + j;
      position.setXYZ(index,
        centre.x + (position.getX(index) - centre.x) * radius,
        centre.y + (position.getY(index) - centre.y) * radius,
        centre.z + (position.getZ(index) - centre.z) * radius);
    }
  }
  const positions = Array.from(position.array);
  const uvs = Array.from(geometry.getAttribute('uv').array);
  const indices = Array.from(geometry.getIndex()!.array);
  for (const row of [0, steps]) {
    curve.getPointAt(row / steps, centre);
    const cap = positions.length / 3;
    positions.push(centre.x, centre.y, centre.z); uvs.push(0.5, 0.5);
    // Separate cap vertices preserve the skin's normals at the fingertip seam.
    for (let j = 0; j <= sides; j++) {
      const v = row * (sides + 1) + j;
      positions.push(position.getX(v), position.getY(v), position.getZ(v));
      uvs.push(0.5 + Math.cos(j / sides * Math.PI * 2) * 0.5,
        0.5 + Math.sin(j / sides * Math.PI * 2) * 0.5);
    }
    for (let j = 0; j < sides; j++) {
      if (row === 0) indices.push(cap, cap + j + 1, cap + j + 2);
      else indices.push(cap, cap + j + 2, cap + j + 1);
    }
  }
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.deleteAttribute('normal'); geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal'), average = new T.Vector3();
  for (let row = 0; row <= steps; row++) {
    const first = row * (sides + 1), last = first + sides;
    average.set(normal.getX(first) + normal.getX(last), normal.getY(first) + normal.getY(last),
      normal.getZ(first) + normal.getZ(last)).normalize();
    normal.setXYZ(first, average.x, average.y, average.z);
    normal.setXYZ(last, average.x, average.y, average.z);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.finger = finger;
  return geometry;
}

export function buildGlove(side: number, m: Materials) {
  const root = new T.Group(), fixed = new T.Group(), index = new T.Group(), thumb = new T.Group();
  root.name = side < 0 ? 'Right anatomical glove' : 'Left anatomical glove';
  root.add(fixed);
  const palm = mesh(fixed, new T.SphereGeometry(1, 24, 16), m.glove);
  palm.scale.set(0.029, 0.049, 0.024);
  const pad = mesh(fixed, new T.SphereGeometry(1, 16, 12), m.grip, 0, -0.003, 0.017);
  pad.scale.set(0.023, 0.04, 0.011);
  const back = mesh(fixed, new T.SphereGeometry(1, 20, 14), m.panel, 0, -0.003, -0.02);
  back.scale.set(0.025, 0.039, 0.008);
  const cuff = mesh(fixed, new T.CylinderGeometry(0.028, 0.033, 0.044, 16), m.suit,
    0, -0.052, -0.022);
  cuff.rotation.x = -0.8;
  const cuffBand = mesh(fixed, new T.TorusGeometry(0.0285, 0.0016, 6, 24), m.stitch,
    0, -0.0367, -0.0378);
  cuffBand.rotation.x = Math.PI / 2 - 0.8;
  const seamPoints = Array.from({ length: 17 }, (_, i) => {
    const a = i / 16 * Math.PI * 2;
    return new T.Vector3(Math.cos(a) * 0.023, -0.003 + Math.sin(a) * 0.036, -0.0233);
  });
  mesh(fixed, new T.TubeGeometry(new T.CatmullRomCurve3(seamPoints, true), 40, 0.0006, 5, true), m.stitch);
  for (let finger = 0; finger < 4; finger++) {
    mesh(finger === 0 ? index : fixed, fingerGeometry(side, finger), m.glove);
    const knuckle = mesh(fixed, new T.SphereGeometry(1, 12, 8), m.panel,
      side * 0.018, 0.028 - finger * 0.018, -0.024);
    knuckle.scale.set(0.009, 0.006, 0.003);
  }
  // An opposed thumb, with a padded base and two distinct phalanges.
  const thumbBase = mesh(thumb, new T.SphereGeometry(1, 16, 12), m.glove);
  thumbBase.scale.set(0.013, 0.018, 0.012);
  const tip = mesh(thumb, new T.CapsuleGeometry(0.008, 0.019, 4, 12), m.glove,
    -side * 0.004, 0.022, 0.005);
  tip.rotation.z = -side * 0.26;
  const tipGrip = mesh(thumb, new T.SphereGeometry(1, 12, 8), m.grip,
    -side * 0.006, 0.029, 0.012);
  tipGrip.scale.set(0.006, 0.011, 0.003);
  thumb.position.set(-side * 0.021, 0.017, -0.01);
  mergeStatic(fixed); mergeStatic(index); mergeStatic(thumb);
  root.add(index, thumb);
  return { root, thumb, index };
}

/** A one-metre sleeve is scaled ONLY along its bone axis by the IK rig. The
 * restrained folds are modelled, not a screen-space normal/noise animation. */
export function sleeveGeometry(upper: boolean) {
  const bottom = upper ? 0.052 : 0.041, top = upper ? 0.044 : 0.029;
  const points = [new T.Vector2(0, -0.5)];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    const fold = 1 + 0.045 * Math.sin(u * Math.PI * 6) * Math.sin(u * Math.PI);
    points.push(new T.Vector2((bottom + (top - bottom) * u) * fold, u - 0.5));
  }
  points.push(new T.Vector2(0, 0.5));
  return new T.LatheGeometry(points, 20);
}

export function buildDriverTorso(parent: T.Group, m: Materials) {
  const torso = mesh(parent, new T.SphereGeometry(1, 24, 18), m.suit, 0, -0.112, -0.48);
  torso.scale.set(0.181, 0.168, 0.109);
  const neck = mesh(parent, new T.CylinderGeometry(0.067, 0.078, 0.095, 20), m.panel,
    0, 0.086, -0.414);
  neck.rotation.x = -0.17;
  for (const side of [-1, 1]) {
    const belt = mesh(parent, new T.CapsuleGeometry(0.023, 0.20, 3, 8), m.grip,
      side * 0.095, -0.08, -0.378);
    belt.scale.z = 0.12;
    belt.rotation.z = side * -0.18;
  }
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
