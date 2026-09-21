import * as T from 'three';
import { mesh, rod, box, mergeStatic } from './geometry.ts';
import { crewGloveGeometry, installCrewFabric } from './crew-geometry.ts';

export type PersonRole = 'driver' | 'engineer' | 'presenter';
const SKIN = [0xb77755, 0x71432f, 0xc9926f, 0x94603f] as const;
/** Original analytic head. Front-plane cheek, brow, chin and nose shaping are
 * part of the surface, not a spherical head with a cone glued onto its face. */
export function humanHeadGeometry(hair = false) {
  const p: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const rows = 32,
    columns = 48;
  for (let i = 0; i <= rows; i++) {
    const latitude = (i / rows) * Math.PI;
    const y = Math.cos(latitude) * 0.15;
    for (let j = 0; j <= columns; j++) {
      const a = (j / columns) * Math.PI * 2;
      const front = Math.max(0, Math.cos(a));
      const jaw = 1 - 0.18 * Math.exp(-(((y + 0.105) / 0.045) ** 2));
      const x = Math.sin(latitude) * Math.sin(a) * 0.109 * jaw;
      let z = Math.sin(latitude) * Math.cos(a) * 0.096;
      // Bridge, alae, brow ridge and cheek volume; values are authored metres.
      z +=
        front ** 12 *
        (0.025 * Math.exp(-(((y + 0.018) / 0.035) ** 2)) +
          0.009 * Math.exp(-(((y - 0.036) / 0.023) ** 2)));
      z += front ** 3 * 0.006 * Math.exp(-(((y + 0.045) / 0.055) ** 2));
      if (hair) z += Math.sign(z) * 0.003;
      p.push(x * (hair ? 1.035 : 1), y + (hair ? 0.003 : 0), z);
      uv.push(j / columns, i / rows);
    }
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < columns; j++) {
      // Hair is a sculpted crown/side cap with a stable asymmetric parting.
      const y = Math.cos(((i + 0.5) / rows) * Math.PI) * 0.15;
      const a = ((j + 0.5) / columns) * Math.PI * 2;
      if (hair && y < 0.035 + 0.029 * Math.max(0, Math.cos(a)) + 0.009 * Math.sin(a)) continue;
      const a0 = i * (columns + 1) + j,
        b = a0 + columns + 1;
      indices.push(a0, b, a0 + 1, b, b + 1, a0 + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
/** Closed garment lofts retain full-radius joint ends. A tapered ellipsoid at
 * every joint creates detached robot-like limbs, even with correct hierarchy. */
export function garmentGeometry(profile: readonly (readonly [number, number, number])[]) {
  if (
    profile.length < 2 ||
    profile.some(
      (p, i) =>
        p.some((n) => !Number.isFinite(n)) ||
        p[1] <= 0 ||
        p[2] <= 0 ||
        (i > 0 && p[0] <= profile[i - 1][0]),
    )
  )
    throw new Error('Invalid garment profile');
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const sides = 32,
    subdivisions = 4;
  const rows = (profile.length - 1) * subdivisions + 1;
  for (let row = 0; row < rows; row++) {
    const k = Math.min(profile.length - 2, Math.floor(row / subdivisions));
    const t = (row - k * subdivisions) / subdivisions;
    const y = T.MathUtils.lerp(profile[k][0], profile[k + 1][0], t);
    const rx = T.MathUtils.lerp(profile[k][1], profile[k + 1][1], t);
    const rz = T.MathUtils.lerp(profile[k][2], profile[k + 1][2], t);
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      // Small resolved fabric folds change the silhouette rather than pretending
      // that painted shadows are geometry. Shared endpoints remain concentric.
      const fold =
        1 + 0.018 * Math.sin(angle * 6 + y * 33) * Math.sin((row / (rows - 1)) * Math.PI) ** 2;
      positions.push(Math.sin(angle) * rx * fold, y, Math.cos(angle) * rz * fold);
      uv.push(j / sides, row / (rows - 1));
    }
  }
  for (let row = 0; row < rows - 1; row++)
    for (let j = 0; j < sides; j++) {
      const a = row * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  for (const row of [0, rows - 1]) {
    const centre = positions.length / 3;
    positions.push(0, positions[row * (sides + 1) * 3 + 1], 0);
    uv.push(0.5, row ? 1 : 0);
    for (let j = 0; j < sides; j++) {
      const a = row * (sides + 1) + j;
      if (row === 0) indices.push(centre, a + 1, a);
      else indices.push(centre, a, a + 1);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
function torso() {
  return garmentGeometry([
    [-0.29, 0.156, 0.115],
    [-0.25, 0.169, 0.119],
    [-0.16, 0.154, 0.116],
    [-0.04, 0.171, 0.14],
    [0.085, 0.208, 0.151],
    [0.16, 0.232, 0.137],
    [0.217, 0.231, 0.116],
    [0.262, 0.158, 0.09],
    [0.288, 0.068, 0.069],
  ]);
}
function segment(length: number, radius: number) {
  return garmentGeometry([
    [-length - 0.025, radius * 0.69, radius * 0.61],
    [-length * 0.85, radius * 0.73, radius * 0.63],
    [-length * 0.56, radius * 0.91, radius * 0.77],
    [-length * 0.23, radius, radius * 0.84],
    [0.015, radius * 0.92, radius * 0.79],
    [0.04, radius * 0.74, radius * 0.63],
  ]);
}
/** Close-range fictional person with articulated shoulder/elbow/neck groups.
 * Used in authored HQ/media scenes; not a scanned likeness or a final-human-art
 * certification. Every pose is a pure function of the supplied scene clock. */
export class ForegroundPerson {
  readonly root = new T.Group();
  readonly head = new T.Group();
  readonly shoulders = [new T.Group(), new T.Group()];
  readonly elbows = [new T.Group(), new T.Group()];
  private mouth = new T.Group();
  private eyes = new T.Group();
  constructor(
    readonly identity = 0,
    readonly role: PersonRole = 'engineer',
  ) {
    if (!Number.isInteger(identity) || identity < 0 || identity > 3)
      throw new Error('Invalid original person identity');
    this.root.name = `Original ${role} ${identity + 1}`;
    const skin = new T.MeshStandardMaterial({ color: SKIN[identity], roughness: 0.58 }),
      clothes = new T.MeshStandardMaterial({
        color: role === 'driver' ? 0x264956 : role === 'presenter' ? 0x293239 : 0x37555a,
        roughness: 0.93,
      }),
      pants = new T.MeshStandardMaterial({ color: 0x192a33, roughness: 0.9 }),
      trim = new T.MeshStandardMaterial({ color: 0xc9c6b7, roughness: 0.81 }),
      hair = new T.MeshStandardMaterial({
        color: [0x201915, 0x15120f, 0x483227, 0x29221c][identity],
        roughness: 0.94,
      }),
      eyeWhite = new T.MeshStandardMaterial({ color: 0xd9d9ce, roughness: 0.33 }),
      iris = new T.MeshStandardMaterial({ color: 0x302a22, roughness: 0.28 }),
      lips = new T.MeshStandardMaterial({ color: 0x633c34, roughness: 0.72 });
    installCrewFabric(clothes);
    installCrewFabric(pants);
    mesh(this.root, torso(), clothes, 0, 1.19, 0);
    mesh(this.root, new T.CylinderGeometry(0.074, 0.081, 0.055, 24, 1, true), clothes, 0, 1.478, 0);
    const hip = mesh(this.root, new T.SphereGeometry(1, 20, 12), pants, 0, 0.875, 0);
    hip.scale.set(0.168, 0.16, 0.122);
    for (const side of [-1, 1]) {
      const thigh = mesh(this.root, segment(0.415, 0.088), pants, side * 0.087, 0.88, 0);
      thigh.rotation.z = side * 0.02;
      const shin = mesh(this.root, segment(0.395, 0.07), pants, side * 0.095, 0.48, 0.011);
      shin.rotation.x = -0.025;
      const shoe = mesh(
        this.root,
        new T.CapsuleGeometry(0.071, 0.15, 4, 12),
        pants,
        side * 0.098,
        0.055,
        0.075,
      );
      shoe.rotation.x = Math.PI / 2;
      shoe.scale.y = 0.86;
      shoe.scale.z = 0.67;
      const index = side < 0 ? 0 : 1,
        shoulder = this.shoulders[index],
        elbow = this.elbows[index];
      shoulder.position.set(side * 0.218, 1.405, 0);
      this.root.add(shoulder);
      mesh(shoulder, segment(0.295, 0.077), clothes);
      elbow.position.y = -0.295;
      shoulder.add(elbow);
      mesh(elbow, segment(0.285, 0.055), clothes);
      const cuff = mesh(
        elbow,
        new T.CylinderGeometry(0.043, 0.039, 0.022, 16),
        clothes,
        0,
        -0.273,
        0,
      );
      cuff.rotation.z = 0.02;
      const hand = mesh(elbow, crewGloveGeometry(), skin, 0, -0.322, 0.006);
      hand.scale.set(0.038, 0.057, 0.034);
      hand.rotation.x = 0.15;
      hand.rotation.z = Math.PI;
      mergeStatic(elbow); // keeps one material draw per articulated limb
    }
    const neck = mesh(this.root, new T.CylinderGeometry(0.054, 0.065, 0.105, 20), skin, 0, 1.51, 0);
    neck.rotation.x = 0.03;
    this.head.position.set(0, 1.66, 0.008);
    this.head.scale.set(0.94, 0.87, 0.98);
    this.root.add(this.head);
    mesh(this.head, humanHeadGeometry(), skin);
    mesh(this.head, humanHeadGeometry(true), hair);
    for (const side of [-1, 1]) {
      const ear = mesh(
        this.head,
        new T.SphereGeometry(1, 12, 12),
        skin,
        side * 0.107,
        -0.016,
        0.002,
      );
      ear.scale.set(0.016, 0.034, 0.018);
      const fold = mesh(
        this.head,
        new T.TorusGeometry(0.014, 0.003, 6, 14),
        lips,
        side * 0.12,
        -0.016,
        0.007,
      );
      fold.rotation.y = (side * Math.PI) / 2;
      fold.scale.y = 1.55;
      const eye = mesh(this.eyes, new T.SphereGeometry(1, 16, 12), eyeWhite, side * 0.042, 0, 0.09);
      eye.scale.set(0.022, 0.008, 0.012);
      const pupil = mesh(this.eyes, new T.SphereGeometry(1, 12, 8), iris, side * 0.042, 0, 0.101);
      pupil.scale.set(0.006, 0.007, 0.003);
      const brow = new T.CatmullRomCurve3([
        new T.Vector3(side * 0.019, 0.041, 0.095),
        new T.Vector3(side * 0.045, 0.048, 0.096),
        new T.Vector3(side * 0.068, 0.044, 0.086),
      ]);
      mesh(this.head, new T.TubeGeometry(brow, 12, 0.0031, 5, false), hair);
    }
    this.eyes.position.y = 0.023;
    this.mouth.position.y = -0.069;
    this.head.add(this.eyes, this.mouth);
    const lip = mesh(this.mouth, new T.SphereGeometry(1, 18, 8), lips, 0, 0, 0.098);
    lip.scale.set(0.028, 0.0035, 0.003);
    const lower = mesh(this.head, new T.SphereGeometry(1, 18, 8), skin, 0, -0.077, 0.094);
    lower.scale.set(0.027, 0.0045, 0.005);
    box(this.root, trim, 0, 1.24, 0.151, 0.0035, 0.32, 0.003);
    if (role === 'engineer') {
      rod(
        this.root,
        pants,
        new T.Vector3(-0.065, 1.47, 0.097),
        new T.Vector3(0, 1.175, 0.15),
        0.003,
      );
      rod(
        this.root,
        pants,
        new T.Vector3(0.065, 1.47, 0.097),
        new T.Vector3(0, 1.175, 0.15),
        0.003,
      );
      box(this.root, trim, 0, 1.13, 0.151, 0.055, 0.076, 0.007);
    }
    // Merge only static meshes. Articulated child groups retain ownership.
    mergeStatic(this.eyes);
    mergeStatic(this.mouth);
    this.root.userData.originalPerson = true;
    this.pose(0, false, 0);
  }
  pose(time: number, speaking: boolean, attention: number) {
    if (![time, attention].every(Number.isFinite)) throw new Error('Invalid person scene pose');
    const phase = time + this.identity * 0.73;
    const gesture = speaking ? Math.sin(phase * 1.9) * 0.17 : Math.sin(phase * 0.7) * 0.025;
    this.head.rotation.set(
      Math.sin(phase * 0.95) * 0.018 + (speaking ? Math.sin(phase * 3.1) * 0.012 : 0),
      T.MathUtils.clamp(attention, -0.55, 0.55),
      Math.sin(phase * 0.61) * 0.009,
    );
    this.mouth.scale.y = speaking ? 1 + 2 * Math.max(0, Math.sin(phase * 8.5)) : 1;
    const blink = Math.pow(Math.max(0, Math.cos(phase * 1.7)), 90);
    this.eyes.scale.y = 1 - 0.92 * blink;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.shoulders[i].rotation.set(
        speaking ? -0.16 - Math.abs(gesture) : -0.035,
        0,
        side * (0.075 + Math.abs(gesture) * 0.45),
      );
      this.elbows[i].rotation.x = speaking ? -0.35 - Math.abs(gesture) * 1.5 : -0.1;
    }
    this.root.updateMatrixWorld(true);
  }
  dispose() {
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.root.removeFromParent();
  }
}
