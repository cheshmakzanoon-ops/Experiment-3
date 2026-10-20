import * as T from 'three';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';
import { sampleProfile } from './profile-sampling.ts';

/** Original chassis and tank construction. REF018 shows the frame entering
 * the steering casting and continuing behind the knee to the pivot; REF004,
 * 060 and 076 show the narrow saddle, tank shoulders and cockpit well. These
 * profiles are authored metres, not dimensions recovered from screenshots. */
type Station = readonly [
  z: number,
  x: number,
  y: number,
  width: number,
  top: number,
  bottom: number,
];
type Materials = Pick<BikeMaterials, 'aluminium' | 'steel' | 'dark'>;

/** Closed, rounded sections in stable chassis axes. Unlike a constant
 * extrusion, their depth and lateral flare can follow the actual hardpoints.
 * Separate cap rings keep their normals planar; the long seam shares normals. */
function formedSections(stations: readonly Station[], detail: RiderDetail, exponent: number) {
  const rows = detail === 'high' ? 36 : detail === 'mid' ? 20 : 9,
    sides = detail === 'high' ? 24 : detail === 'mid' ? 16 : 8,
    zs = stations.map((station) => station[0]),
    axes = [1, 2, 3, 4, 5].map((axis) => stations.map((station) => station[axis])),
    positions: number[] = [],
    uvs: number[] = [],
    index: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const v = i / rows,
      z = T.MathUtils.lerp(zs[0], zs[zs.length - 1], v),
      [x, y, width, top, bottom] = axes.map((values) => sampleProfile(zs, values, z));
    for (let j = 0; j <= sides; j++) {
      const a = j === sides ? 0 : (j / sides) * Math.PI * 2,
        c = Math.cos(a),
        s = Math.sin(a);
      positions.push(
        x + Math.sign(c) * Math.abs(c) ** (2 / exponent) * width,
        y + Math.sign(s) * Math.abs(s) ** (2 / exponent) * (s >= 0 ? top : bottom),
        z,
      );
      uvs.push(j / sides, v);
      if (i < rows && j < sides) {
        const a = i * (sides + 1) + j,
          b = a + sides + 1;
        index.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  for (const row of [0, rows]) {
    const centre = positions.length / 3,
      z = row === 0 ? zs[0] : zs[zs.length - 1],
      [x, y, width, top, bottom] = axes.map((values) => sampleProfile(zs, values, z));
    positions.push(x, y, z);
    uvs.push(0.5, 0.5);
    for (let j = 0; j <= sides; j++) {
      const at = (row * (sides + 1) + j) * 3,
        px = positions[at],
        py = positions[at + 1];
      positions.push(px, py, z);
      uvs.push(0.5 + (px - x) / (2 * width), 0.5 + (py - y) / (2 * Math.max(top, bottom)));
    }
    for (let j = 0; j < sides; j++) {
      const a = centre + j + 1;
      if (row === 0) index.push(centre, a + 1, a);
      else index.push(centre, a, a + 1);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal'),
    n = new T.Vector3();
  for (let row = 0; row <= rows; row++) {
    const a = row * (sides + 1),
      b = a + sides;
    n.set(
      normal.getX(a) + normal.getX(b),
      normal.getY(a) + normal.getY(b),
      normal.getZ(a) + normal.getZ(b),
    ).normalize();
    normal.setXYZ(a, n.x, n.y, n.z);
    normal.setXYZ(b, n.x, n.y, n.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** The head and pivot remain where the steering and suspension rigs put them.
 * Broad, shallow-wall pressed sections replace the old uniform diagonal bar.
 * Their pivot faces stay inboard of the planted feet through travel. */
export function gpMainSpar(head: T.Vector3, side: -1 | 1, detail: RiderDetail) {
  const front = head.z - 0.04,
    z = (fraction: number) => T.MathUtils.lerp(-0.2, front, fraction),
    geometry = formedSections(
      [
        [-0.2, side * 0.1, -0.13, 0.018, 0.052, 0.041],
        [z(0.13), side * 0.112, -0.066, 0.018, 0.058, 0.046],
        [z(0.33), side * 0.16, 0.045, 0.019, 0.056, 0.046],
        [z(0.55), side * 0.158, head.y * 0.57, 0.018, 0.048, 0.041],
        [z(0.77), side * 0.136, head.y - 0.102, 0.017, 0.038, 0.032],
        [z(0.92), side * 0.092, head.y - 0.041, 0.017, 0.029, 0.026],
        [front, side * 0.07, head.y - 0.02, 0.017, 0.024, 0.024],
      ],
      detail,
      4.5,
    );
  geometry.name = 'GP formed aluminium main spar';
  return geometry;
}

function add(root: T.Group, geometry: T.BufferGeometry, material: T.Material, name: string) {
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

export function gpMainFrame(head: T.Vector3, detail: RiderDetail, materials: Materials) {
  const root = new T.Group();
  root.name = 'GP formed main frame';
  for (const side of [-1, 1] as const) {
    add(root, gpMainSpar(head, side, detail), materials.aluminium, 'GP variable-section main spar');
    if (detail === 'far') continue;
    // A machined ring surrounds the captive axle. Keep its outer face
    // inboard of the planted boot through the complete suspension range.
    const collar = add(
      root,
      new T.TorusGeometry(0.028, 0.008, 6, detail === 'high' ? 24 : 12),
      materials.aluminium,
      'GP machined main-pivot collar',
    );
    collar.rotation.y = Math.PI / 2;
    collar.position.set(side * 0.114, -0.13, -0.2);
    const pivot = add(
      root,
      new T.CylinderGeometry(0.017, 0.017, 0.012, 6),
      materials.steel,
      'GP main-pivot captive hex',
    );
    pivot.rotation.z = Math.PI / 2;
    pivot.position.set(side * 0.12, -0.13, -0.2);
  }
  return root;
}

/** A narrow seat root grows into a fuller tank shoulder, with the lower
 * sidewall following the diagonal frame. The crown stays below the previous
 * tank height, and the front leaves clearance for the full steering sweep. */
export function gpR2Tank(detail: RiderDetail) {
  const geometry = formedSections(
    [
      [-0.185, 0, 0.207, 0.099, 0.031, 0.09],
      [-0.11, 0, 0.231, 0.119, 0.063, 0.154],
      [-0.015, 0, 0.258, 0.149, 0.09, 0.16],
      [0.11, 0, 0.261, 0.17, 0.087, 0.122],
      [0.22, 0, 0.25, 0.158, 0.073, 0.087],
      [0.29, 0, 0.226, 0.113, 0.046, 0.054],
      [0.325, 0, 0.211, 0.07, 0.03, 0.04],
    ],
    detail,
    2.35,
  );
  geometry.name = 'GP-R2 continuous tank shoulder and knee scallops';
  return geometry;
}

/** The pad's contact top stays at y=.2445; only its perimeter is rounded.
 * A shaped front tongue joins the narrow tank root without a floating block. */
export function gpR2SeatPad(detail: RiderDetail) {
  return formedSections(
    [
      [-0.441, 0, 0.2315, 0.082, 0.006, 0.009],
      [-0.405, 0, 0.2315, 0.098, 0.013, 0.012],
      [-0.32, 0, 0.2315, 0.105, 0.013, 0.012],
      [-0.235, 0, 0.2315, 0.097, 0.013, 0.012],
      [-0.19, 0, 0.2315, 0.083, 0.013, 0.011],
      [-0.174, 0, 0.2315, 0.079, 0.006, 0.01],
    ],
    detail,
    3.1,
  );
}

export function gpR2TankDetails(detail: RiderDetail, materials: Materials) {
  const root = new T.Group();
  root.name = 'GP-R2 tank hardware';
  if (detail === 'far') return root;
  const cap = add(
    root,
    new T.CylinderGeometry(0.034, 0.034, 0.003, detail === 'high' ? 32 : 16),
    materials.aluminium,
    'GP-R2 flush fuel-cap ring',
  );
  cap.position.set(0, 0.349, 0.054);
  const centre = add(
    root,
    new T.CylinderGeometry(0.025, 0.025, 0.0035, detail === 'high' ? 24 : 12),
    materials.dark,
    'GP-R2 recessed fuel-cap centre',
  );
  centre.position.set(0, 0.3505, 0.054);
  if (detail === 'high') {
    const latch = add(
      root,
      new T.BoxGeometry(0.007, 0.003, 0.029),
      materials.steel,
      'GP-R2 fuel-cap latch',
    );
    latch.position.set(0, 0.353, 0.054);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2,
        fastener = add(
          root,
          new T.CylinderGeometry(0.0017, 0.0017, 0.001, 6),
          materials.steel,
          'GP-R2 fuel-ring fastener',
        );
      fastener.position.set(Math.cos(angle) * 0.0295, 0.351, 0.054 + Math.sin(angle) * 0.0295);
    }
  }
  return root;
}
