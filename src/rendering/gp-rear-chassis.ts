import * as T from 'three';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';
import { batchBikeRigidMeshes } from './bike-rigid-batch.ts';
import { GP_TAIL_LED } from './gp-appearance.ts';
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

function closedSkinIndices(rows: number, cols: number) {
  const index: number[] = [],
    count = (rows + 1) * (cols + 1);
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
  return index;
}

/** Pigmented red lens cells with a domed rear face. The black bezel fits
 * flush over the squared tail end. Both parts use the existing material
 * batches and the lamp emits only through the actual optical surfaces. */
export function gpRainLenses(r2: boolean, detail: RiderDetail) {
  const count = r2 ? 6 : 7,
    sides = detail === 'high' ? 10 : 6;
  const position: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let cell = 0; cell < count; cell++) {
    const x =
      (cell - (count - 1) / 2) * (r2 ? 0.0095 : 0.009) + (r2 ? Math.sign(cell - 2.5) * 0.002 : 0);
    const y = r2 ? Math.abs(x) * 0.08 : 0;
    const start = position.length / 3;
    const atlasU = (cell + 0.5) / GP_TAIL_LED.columns,
      atlasV = 0.5 / GP_TAIL_LED.rows;
    for (const [r, z] of [
      [1, -0.004],
      [0.88, -0.0056],
      [0.55, -0.0065],
    ]) {
      for (let j = 0; j < sides; j++) {
        const a = (j * 2 * Math.PI) / sides;
        position.push(x + Math.cos(a) * r * 0.0042, y + Math.sin(a) * r * 0.0068, z);
        uv.push(
          atlasU + (0.46 * Math.cos(a) * r) / GP_TAIL_LED.columns,
          atlasV + (0.46 * Math.sin(a) * r) / GP_TAIL_LED.rows,
        );
      }
    }
    const cap = position.length / 3;
    position.push(x, y, -0.0069);
    uv.push(atlasU, atlasV);
    for (let j = 0; j < sides; j++) {
      const n = (j + 1) % sides;
      for (let ring = 0; ring < 2; ring++) {
        const a = start + ring * sides + j,
          b = start + ring * sides + n;
        index.push(a, a + sides, b, b, a + sides, b + sides);
      }
      index.push(start + 2 * sides + j, cap, start + 2 * sides + n);
    }
  }
  const geom = new T.BufferGeometry();
  geom.name = 'GP domed rain-light lens array';
  geom.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geom.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geom.setIndex(index);
  geom.computeVertexNormals();
  return geom;
}
/** The swingarm carries a moulded carbon cover clear of the rear slick. The
 * section follows the rounded tyre shoulders. The leading edge wraps further
 * down the flanks and the trailing tongue tapers away above the wheel. */
export function gpRearHugger(radius: number, crown: number, arm: number, detail: RiderDetail) {
  const rows = detail === 'high' ? 22 : detail === 'mid' ? 12 : 6,
    cols = detail === 'high' ? 10 : detail === 'mid' ? 6 : 4,
    p: number[] = [],
    uv: number[] = [];
  const point = new T.Vector3();
  const skin = (t: number, u: number, inner: number) => {
    const width = 0.068 + 0.032 * Math.sin(Math.PI * t) + 0.006 * t,
      edge = u * u,
      x = u * width,
      angle = T.MathUtils.lerp(2.54 - 0.18 * edge, 0.73 - 0.2 * edge, t),
      shoulder = crown - Math.sqrt(Math.max(0, crown * crown - x * x)),
      ridge = 0.003 * (1 - edge) * Math.sin(Math.PI * t),
      r = radius + 0.021 - shoulder + ridge - inner * 0.0024;
    return point.set(x, Math.sin(angle) * r, Math.cos(angle) * r);
  };
  for (let inner = 0; inner < 2; inner++) {
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      for (let j = 0; j <= cols; j++) {
        skin(t, (2 * j) / cols - 1, inner);
        p.push(point.x, point.y, point.z);
        uv.push(j / cols, t);
      }
    }
  }
  const index = closedSkinIndices(rows, cols);
  // Two flared stays land on the real spars. Their knees pass outboard
  // before descending past the tyre shoulder and the upper chain run.
  for (const side of [-1, 1]) {
    const offset = p.length / 3,
      steps = detail === 'high' ? 8 : 4;
    for (let inner = 0; inner < 2; inner++)
      for (let i = 0; i <= steps; i++)
        for (let j = 0; j <= 2; j++) {
          const v = i / steps,
            u = j / 2;
          skin(0.72 + u * 0.2, side * 0.985, 1);
          const lowerZ = arm * (0.32 + u * 0.09),
            station = 1 - lowerZ / arm,
            x = T.MathUtils.lerp(
              Math.abs(point.x),
              sampleProfile(STATIONS, ARM_X, station),
              1 - (1 - v) ** 3,
            ),
            y = T.MathUtils.lerp(point.y, sampleProfile(STATIONS, ARM_Y, station) + 0.015, v),
            z = T.MathUtils.lerp(point.z, lowerZ, v);
          p.push(side * (x - inner * 0.003), y, z);
          uv.push(u, v);
        }
    const faces = closedSkinIndices(steps, 2);
    for (let k = 0; k < faces.length; k += 3) {
      const a = offset + faces[k],
        b = offset + faces[k + 1],
        c = offset + faces[k + 2];
      if (side > 0) index.push(a, c, b);
      else index.push(a, b, c);
    }
  }
  const geometry = finish(p, uv, index);
  geometry.name = 'GP crowned carbon rear tyre hugger';
  return geometry;
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
    p: number[] = [],
    uv: number[] = [];
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
  const geometry = finish(p, uv, closedSkinIndices(rows, cols));
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
  readonly upperMount: T.Vector3;
  readonly lowerMount: T.Vector3;
  private readonly spring = new T.Group();
  private readonly a = new T.Vector3();
  private readonly b = new T.Vector3();
  private readonly direction = new T.Vector3();

  constructor(
    arm: number,
    detail: Exclude<RiderDetail, 'far'>,
    materials: Materials,
    layout: 'prototype' | 'road-mono' | 'road-twin' = 'prototype',
  ) {
    if (!Number.isFinite(arm) || arm < 0.3 || arm > 1.1)
      throw new RangeError('Invalid GP damper arm length');
    const twin = layout === 'road-twin';
    const prefix = layout === 'prototype' ? 'GP' : twin ? 'Twin' : 'Road';
    this.root.name = prefix + ' attached rear damper';
    this.upperEye.name = prefix + ' rear shock upper eye';
    this.lowerEye.name = prefix + ' rear shock lower eye';
    this.spring.name = prefix + ' rear shock compression spring';
    this.upperMount = twin ? new T.Vector3(0, 0.162, -0.48) : new T.Vector3(0, 0.095, -0.18);
    this.lowerMount = twin
      ? new T.Vector3(0, 0.012, -arm * 0.84)
      : new T.Vector3(0, -0.02, -arm * 0.12);
    this.root.add(this.upperEye, this.lowerEye, this.spring);
    const segments = detail === 'high' ? 16 : 10;
    const steps = detail === 'high' ? 84 : 42;
    const points: T.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        angle = t * Math.PI * (twin ? 17 : 14);
      points.push(new T.Vector3(Math.cos(angle) * 0.026, t * 0.2 - 0.1, Math.sin(angle) * 0.026));
    }
    const wire = new T.TubeGeometry(
      new T.CatmullRomCurve3(points),
      steps,
      0.0035,
      detail === 'high' ? 5 : 4,
      false,
    );
    for (const x of twin ? [-0.153, 0.153] : [0]) {
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
        eye.position.x = x;
        const seat = add(
          group,
          new T.CylinderGeometry(0.031, 0.031, 0.008, segments),
          materials.aluminium,
          'Spring retaining collar',
        );
        seat.position.set(x, sign * 0.027, 0);
      }
      const barrelLength = twin ? 0.225 : 0.12,
        shaftLength = twin ? 0.33 : 0.16;
      const barrel = add(
        this.upperEye,
        new T.CylinderGeometry(0.019, 0.021, barrelLength, segments),
        materials.dark,
        'Anodised telescopic damper barrel',
      );
      barrel.position.set(x, -(0.028 + barrelLength * 0.5), 0);
      const shaft = add(
        this.lowerEye,
        new T.CylinderGeometry(0.008, 0.008, shaftLength, segments),
        materials.steel,
        'Sliding polished damper shaft',
      );
      shaft.position.set(x, 0.018 + shaftLength * 0.5, 0);
      add(
        this.spring,
        x < 0 ? wire.clone() : wire,
        twin ? materials.steel : materials.forkUpper,
        'Compact wound shock spring',
      ).position.x = x;
    }
    if (twin) batchBikeRigidMeshes(this.spring);
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
