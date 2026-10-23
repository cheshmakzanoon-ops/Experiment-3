import * as T from 'three';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';
import { batchBikeRigidMeshes } from './bike-rigid-batch.ts';
import { sampleProfile } from './profile-sampling.ts';

/** Original GP rear structure, in the existing pivot/axle frame. REF 018
 * shows a tapered carbon-clad arm and machined adjuster; REF 071/087 show
 * the dark, enclosed underside of the tail. Dimensions are authored metres,
 * not measurements recovered from those images. Wheels and chain retain
 * their own geometry, transforms, service articulation and materials. */
type Materials = Pick<
  BikeMaterials,
  'carbon' | 'aluminium' | 'steel' | 'dark' | 'band' | 'forkUpper'
>;
const UP = new T.Vector3(0, 1, 0);
const STATIONS = [0, 0.12, 0.28, 0.4, 0.55, 0.8, 1];
const ARM_X = [0.075, 0.075, 0.12, 0.16, 0.162, 0.158, 0.158];
const ARM_Y = [0, -0.075, -0.14, -0.115, -0.07, -0.025, 0];
const ARM_WIDTH = [0.016, 0.016, 0.016, 0.018, 0.021, 0.019, 0.018];
const ARM_HEIGHT = [0.038, 0.027, 0.022, 0.028, 0.039, 0.032, 0.028];

function finish(positions: number[], uvs: number[], indices: number[]) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
function add(parent: T.Group, geometry: T.BufferGeometry, material: T.Material, name: string) {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Stable-axis rounded box sections avoid the twisted normal frame of a
 * constant-width path extrusion. The neck starts inboard of the planted
 * forefoot and chain, then turns outward below the lower chain run.
 * This preserves the rider's actual occupied volume through suspension travel. */
function spar(arm: number, side: number, detail: RiderDetail) {
  const rows = detail === 'high' ? 20 : detail === 'mid' ? 12 : 6,
    sides = detail === 'high' ? 12 : 8,
    p: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const t = row / rows,
      x = sampleProfile(STATIONS, ARM_X, t) * side,
      y = sampleProfile(STATIONS, ARM_Y, t),
      w = sampleProfile(STATIONS, ARM_WIDTH, t),
      h = sampleProfile(STATIONS, ARM_HEIGHT, t);
    for (let j = 0; j <= sides; j++) {
      const angle = j === sides ? 0 : (j / sides) * Math.PI * 2,
        c = Math.cos(angle),
        s = Math.sin(angle);
      p.push(
        x + Math.sign(c) * Math.abs(c) ** 0.45 * w,
        y + Math.sign(s) * Math.abs(s) ** 0.45 * h,
        -arm * t,
      );
      uv.push(j / sides, t);
    }
  }
  for (let row = 0; row < rows; row++)
    for (let j = 0; j < sides; j++) {
      const a = row * (sides + 1) + j,
        b = a + sides + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // The end faces are real structure, not transparent open sleeves.
  for (const row of [0, rows]) {
    const start = row * (sides + 1),
      centre = p.length / 3,
      t = row / rows;
    p.push(side * sampleProfile(STATIONS, ARM_X, t), sampleProfile(STATIONS, ARM_Y, t), -arm * t);
    uv.push(0.5, t);
    for (let j = 0; j < sides; j++)
      if (row === 0) index.push(centre, start + j, start + j + 1);
      else index.push(centre, start + j + 1, start + j);
  }
  return finish(p, uv, index);
}

export function gpRearSwingarm(arm: number, detail: RiderDetail, materials: Materials) {
  if (!Number.isFinite(arm) || arm < 0.3 || arm > 1.1)
    throw new RangeError('Invalid GP rear arm length');
  const root = new T.Group();
  root.name = 'GP tapered carbon rear swingarm';
  root.userData.gpRearStructure = 'swingarm';
  const segments = detail === 'high' ? 16 : 10;
  for (const side of [-1, 1]) {
    add(root, spar(arm, side, detail), materials.carbon, 'Formed carbon swingarm spar');
    if (detail === 'far') continue;
    const collar = add(
      root,
      new T.CylinderGeometry(0.041, 0.041, 0.021, segments),
      materials.aluminium,
      'Machined swingarm pivot collar',
    );
    collar.rotation.z = Math.PI / 2;
    collar.position.x = side * ARM_X[0];
    const adjuster = add(
      root,
      new T.BoxGeometry(0.009, 0.037, 0.077),
      materials.aluminium,
      'Captive rear axle adjuster',
    );
    adjuster.position.set(side * 0.178, 0, -arm + 0.014);
    const slot = add(
      root,
      new T.BoxGeometry(0.0015, 0.015, 0.043),
      materials.dark,
      'Recessed axle adjustment slot',
    );
    slot.position.set(side * 0.183, 0, -arm + 0.014);
    const nut = add(
      root,
      new T.CylinderGeometry(0.016, 0.016, 0.012, 6),
      materials.steel,
      'Rear axle hex fastener',
    );
    nut.rotation.z = Math.PI / 2;
    nut.position.set(side * 0.186, 0, -arm);
    if (detail === 'high') {
      const screw = add(
        root,
        new T.CylinderGeometry(0.004, 0.004, 0.036, 6),
        materials.steel,
        'Captive chain-tension screw',
      );
      screw.rotation.x = Math.PI / 2;
      screw.position.set(side * 0.176, 0, -arm + 0.063);
    }
  }
  if (detail !== 'far') {
    for (const side of [-1, 1]) {
      const neck = new T.Vector3(side * ARM_X[1], ARM_Y[1], -arm * STATIONS[1]),
        clevis = new T.Vector3(side * 0.035, -0.02, -arm * 0.12),
        direction = clevis.clone().sub(neck),
        brace = add(
          root,
          new T.CylinderGeometry(0.011, 0.011, direction.length(), segments),
          materials.aluminium,
          'Suspension clevis crossbrace',
        );
      brace.quaternion.setFromUnitVectors(UP, direction.normalize());
      brace.position.copy(neck).add(clevis).multiplyScalar(0.5);
    }
    const pin = add(
      root,
      new T.CylinderGeometry(0.0055, 0.0055, 0.07, segments),
      materials.steel,
      'Lower damper captive pin',
    );
    pin.rotation.z = Math.PI / 2;
    pin.position.set(0, -0.02, -arm * 0.12);
  }
  return root;
}

/** A 2 mm formed tray with returned edges, fitted below the existing tail.
 * The rear tyre and its hugger retain daylight below the tray throughout
 * the suspension envelope. No transparent occlusion cards are used. */
export function gpUndertray(detail: RiderDetail) {
  const z = [-0.81, -0.68, -0.5, -0.33, -0.17],
    y = [0.252, 0.19, 0.12, 0.038, 0.094],
    w = [0.027, 0.061, 0.101, 0.118, 0.121],
    lip = [0.013, 0.025, 0.055, 0.075, 0.065],
    rows = detail === 'high' ? 20 : detail === 'mid' ? 12 : 6,
    cols = detail === 'far' ? 2 : 4,
    count = (rows + 1) * (cols + 1),
    p: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let inner = 0; inner < 2; inner++)
    for (let i = 0; i <= rows; i++) {
      const at = T.MathUtils.lerp(z[0], z[z.length - 1], i / rows);
      for (let j = 0; j <= cols; j++) {
        const u = (j / cols) * 2 - 1;
        p.push(
          u * sampleProfile(z, w, at),
          sampleProfile(z, y, at) + Math.abs(u) ** 3 * sampleProfile(z, lip, at) - inner * 0.002,
          at,
        );
        uv.push(j / cols, i / rows);
      }
    }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j,
        b = a + cols + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
      index.push(a + count, a + 1 + count, b + count, a + 1 + count, b + 1 + count, b + count);
    }
  const boundary = [
    ...Array.from({ length: cols + 1 }, (_, j) => j),
    ...Array.from({ length: rows }, (_, i) => (i + 1) * (cols + 1) + cols),
    ...Array.from({ length: cols }, (_, j) => rows * (cols + 1) + cols - j - 1),
    ...Array.from({ length: rows - 1 }, (_, i) => (rows - 1 - i) * (cols + 1)),
  ];
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length];
    index.push(a, b, a + count, b, b + count, a + count);
  }
  const geometry = finish(p, uv, index);
  geometry.userData.gpRearStructure = 'undertray';
  return geometry;
}

export function gpRearBody(detail: RiderDetail, materials: Materials) {
  const root = new T.Group();
  root.name = 'GP enclosed carbon undertail and shock clevis';
  add(root, gpUndertray(detail), materials.carbon, 'Formed 2 mm carbon undertail');
  if (detail !== 'far') {
    for (const side of [-1, 1]) {
      const ear = add(
        root,
        new T.BoxGeometry(0.007, 0.042, 0.033),
        materials.aluminium,
        'Upper damper clevis ear',
      );
      ear.position.set(side * 0.023, 0.111, -0.18);
    }
    const pin = add(
      root,
      new T.CylinderGeometry(0.0055, 0.0055, 0.059, detail === 'high' ? 12 : 8),
      materials.steel,
      'Upper damper captive pin',
    );
    pin.rotation.z = Math.PI / 2;
    pin.position.set(0, 0.095, -0.18);
  }
  return root;
}

/** The damper joins two named hardpoints. Its eyes, barrel and shaft retain
 * their dimensions while the spring changes length. Absolute local poses
 * follow the production sprung and swingarm matrices, including rewind;
 * there is no added suspension solver, clock or per-frame allocation. */
export class GPRearSuspension {
  readonly root = new T.Group();
  readonly upperEye = new T.Group();
  readonly lowerEye = new T.Group();
  readonly upperMount = new T.Vector3(0, 0.095, -0.18);
  readonly lowerMount: T.Vector3;
  private readonly spring = new T.Group();
  private readonly a = new T.Vector3();
  private readonly b = new T.Vector3();
  private readonly direction = new T.Vector3();

  constructor(arm: number, detail: Exclude<RiderDetail, 'far'>, materials: Materials) {
    if (!Number.isFinite(arm) || arm < 0.3 || arm > 1.1)
      throw new RangeError('Invalid GP damper arm length');
    this.root.name = 'GP attached rear damper';
    this.upperEye.name = 'GP rear shock upper eye';
    this.lowerEye.name = 'GP rear shock lower eye';
    this.spring.name = 'GP rear shock compression spring';
    this.lowerMount = new T.Vector3(0, -0.02, -arm * 0.12);
    this.root.add(this.upperEye, this.lowerEye, this.spring);
    const segments = detail === 'high' ? 16 : 10;
    for (const [group, sign] of [
      [this.upperEye, -1],
      [this.lowerEye, 1],
    ] as const) {
      const eye = add(
        group,
        new T.TorusGeometry(0.013, 0.0045, 5, segments),
        materials.aluminium,
        'Bushed shock eyelet',
      );
      eye.rotation.y = Math.PI / 2;
      const seat = add(
        group,
        new T.CylinderGeometry(0.031, 0.031, 0.008, segments),
        materials.aluminium,
        'Spring retaining collar',
      );
      seat.position.y = sign * 0.027;
    }
    const barrel = add(
      this.upperEye,
      new T.CylinderGeometry(0.019, 0.021, 0.12, segments),
      materials.dark,
      'Anodised telescopic damper barrel',
    );
    barrel.position.y = -0.088;
    const shaft = add(
      this.lowerEye,
      new T.CylinderGeometry(0.008, 0.008, 0.16, segments),
      materials.steel,
      'Sliding polished damper shaft',
    );
    shaft.position.y = 0.098;
    const points: T.Vector3[] = [],
      steps = detail === 'high' ? 84 : 42;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        angle = t * Math.PI * 14;
      points.push(new T.Vector3(Math.cos(angle) * 0.026, t * 0.2 - 0.1, Math.sin(angle) * 0.026));
    }
    add(
      this.spring,
      new T.TubeGeometry(
        new T.CatmullRomCurve3(points),
        steps,
        0.0035,
        detail === 'high' ? 5 : 4,
        false,
      ),
      // Not the compound-paint material: that is recoloured every frame to
      // the tyre compound (white on mediums), which made a toy white coil.
      materials.forkUpper,
      'Compact wound shock spring',
    );
    batchBikeRigidMeshes(this.upperEye);
    batchBikeRigidMeshes(this.lowerEye);
  }

  update(sprung: T.Matrix4, swingarm: T.Matrix4) {
    this.a.copy(this.upperMount).applyMatrix4(sprung);
    this.b.copy(this.lowerMount).applyMatrix4(swingarm);
    this.direction.subVectors(this.a, this.b);
    const length = this.direction.length();
    this.root.position.copy(this.a).add(this.b).multiplyScalar(0.5);
    this.root.quaternion.setFromUnitVectors(UP, this.direction.multiplyScalar(1 / length));
    this.upperEye.position.y = length * 0.5;
    this.lowerEye.position.y = -length * 0.5;
    this.spring.scale.y = (length - 0.054) / 0.2;
  }
}
