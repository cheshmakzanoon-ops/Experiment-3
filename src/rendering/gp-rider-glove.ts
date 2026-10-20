import * as T from 'three';
import { sampleProfile } from './profile-sampling.ts';
import { GP_GLOVE_GRIP } from './gp-rider-contact.ts';
import type { RiderDetail } from './rider.ts';

type Detail = Exclude<RiderDetail, 'far'>;
type Section = readonly [number, number, number, number, number];
/** Metres in the existing GP hand frame: +Y is the back of the hand, +Z
 * reaches around the grip. The cuff overlaps the sleeve behind the unchanged
 * wrist landmark. The raised distal palm leaves room for the real grip. */
const PALM: readonly Section[] = [
  [-0.062, 0, 0.033, 0.023, 0.021],
  [-0.047, 0.001, 0.034, 0.024, 0.022],
  [-0.025, 0, 0.027, 0.022, 0.02],
  [-0.005, 0.001, 0.031, 0.024, 0.022],
  [0.018, 0.002, 0.034, 0.026, 0.023],
  [0.033, 0.004, 0.035, 0.026, 0.021],
  [0.044, 0.012, 0.033, 0.02, 0.007],
  [0.051, 0.015, 0.028, 0.013, 0.002],
  [0.054, 0.015, 0.025, 0.01, 0.001],
];
const stations = PALM.map((s) => s[0]);
const dimensions = [1, 2, 3, 4].map((axis) => PALM.map((s) => s[axis]));
const palmAt = (z: number, angle: number, lift = 0) => {
  const [centre, width, up, down] = dimensions.map((values) =>
    sampleProfile(stations, values, z),
  );
  const sine = Math.sin(angle);
  return new T.Vector3(
    Math.cos(angle) * (width + lift),
    centre + sine * ((sine >= 0 ? up : down) + lift),
    z,
  );
};

function surface(
  rows: number,
  columns: number,
  point: (u: number, v: number) => T.Vector3,
  caps = false,
) {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      const p = point(column / columns, row / rows);
      positions.push(p.x, p.y, p.z);
      uvs.push(column / columns, row / rows);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  if (caps)
    for (const row of [0, rows]) {
      const centre = positions.length / 3,
        ring = row * (columns + 1),
        p = new T.Vector3();
      for (let j = 0; j < columns; j++)
        p.add(new T.Vector3().fromArray(positions, (ring + j) * 3));
      p.multiplyScalar(1 / columns);
      positions.push(p.x, p.y, p.z);
      uvs.push(0.5, row === 0 ? 0 : 1);
      for (let j = 0; j < columns; j++)
        if (row === 0) indices.push(centre, ring + j + 1, ring + j);
        else indices.push(centre, ring + j, ring + j + 1);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // The duplicated UV ring must not create a specular seam down the glove.
  if (caps) {
    const normal = geometry.getAttribute('normal'),
      average = new T.Vector3();
    for (let row = 0; row <= rows; row++) {
      const a = row * (columns + 1),
        b = a + columns;
      average
        .set(
          normal.getX(a) + normal.getX(b),
          normal.getY(a) + normal.getY(b),
          normal.getZ(a) + normal.getZ(b),
        )
        .normalize();
      normal.setXYZ(a, average.x, average.y, average.z);
      normal.setXYZ(b, average.x, average.y, average.z);
    }
  }
  return geometry;
}

/** Four unequal fingers curl around the unchanged contact cylinder. The thumb
 * is medial on both hands: the old shared road pose put it outside the GP grip.
 * REF057/073/076 guide the fitted gauntlet, covered finger joints and shallow
 * molded knuckle bridge. Dimensions are authored, not measured from images.
 *
 * Parts remain direct rigid children so the existing hand batch combines them
 * into three materials at high detail and one at mid detail. No new textures,
 * skin bones, animation state or material ownership are introduced. */
export function addGpRacingGlove(
  parent: T.Group,
  detail: Detail,
  side: -1 | 1,
  materials: { leather: T.Material; panel: T.Material; armour: T.Material },
) {
  if (side !== -1 && side !== 1) throw new RangeError('Invalid GP glove side');
  const high = detail === 'high',
    sides = high ? 8 : 6;
  const add = (geometry: T.BufferGeometry, material: T.Material, name: string) => {
    if (side < 0) {
      geometry.scale(-1, 1, 1);
      const index = geometry.index!;
      for (let i = 0; i < index.count; i += 3) {
        const b = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, b);
      }
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
  };
  add(
    surface(
      high ? 14 : 10,
      high ? 16 : 10,
      (u, v) => palmAt(T.MathUtils.lerp(-0.062, 0.054, v), u * Math.PI * 2),
      true,
    ),
    materials.leather,
    'GP fitted palm and flared gauntlet',
  );

  const panelMaterial = high ? materials.panel : materials.leather;
  add(
    surface(high ? 8 : 6, high ? 8 : 6, (u, v) =>
      palmAt(T.MathUtils.lerp(-0.042, 0.036, v), T.MathUtils.lerp(0.28, Math.PI - 0.28, u), 0.0008),
    ),
    panelMaterial,
    'GP continuous dorsal leather panel',
  );
  add(
    surface(2, high ? 8 : 6, (u, v) =>
      palmAt(T.MathUtils.lerp(-0.055, -0.047, v), T.MathUtils.lerp(0.08, Math.PI - 0.08, u), 0.0015),
    ),
    panelMaterial,
    'GP overlapping wrist closure',
  );

  const fingerX = [-0.0245, -0.008, 0.0085, 0.025],
    ends = [2.78, 3.0, 2.91, 2.58],
    radii = [0.0071, 0.0075, 0.007, 0.0062];
  for (let finger = 0; finger < 4; finger++) {
    const fingerAt = (u: number, v: number, lift = 0) => {
      const angle = T.MathUtils.lerp(-0.66, ends[finger], v),
        ring = u * Math.PI * 2,
        radius = radii[finger] * (1 - 0.17 * v) + lift,
        // A smaller distal cross section rounds the tip without a pinched pole.
        end = 1 - T.MathUtils.smoothstep(v, 0.8, 1) * 0.55,
        bend = 0.0248;
      return new T.Vector3(
        fingerX[finger] + Math.cos(ring) * radius * end,
        GP_GLOVE_GRIP[1] + (bend + Math.sin(ring) * radius * end) * Math.cos(angle),
        GP_GLOVE_GRIP[2] + (bend + Math.sin(ring) * radius * end) * Math.sin(angle),
      );
    };
    add(
      surface(high ? 10 : 6, sides, (u, v) => fingerAt(u, v), true),
      materials.leather,
      `GP wrapped finger ${finger + 1}`,
    );
    if (high)
      add(
        surface(5, 3, (u, v) => fingerAt(T.MathUtils.lerp(0.1, 0.4, u), v * 0.72, 0.0006)),
        panelMaterial,
        `GP dorsal finger reinforcement ${finger + 1}`,
      );
  }

  const thumb = new T.CatmullRomCurve3([
    new T.Vector3(-0.024, 0.001, -0.012),
    new T.Vector3(-0.038, -0.01, 0.011),
    new T.Vector3(-0.042, -0.027, 0.039),
    new T.Vector3(-0.026, -0.032, 0.063),
  ]);
  const segments = high ? 8 : 6,
    frames = thumb.computeFrenetFrames(segments, false);
  add(
    surface(
      segments,
      sides,
      (u, v) => {
        const at = Math.round(v * segments),
          ring = u * Math.PI * 2,
          radius = T.MathUtils.lerp(0.0105, 0.0045, v);
        return thumb
          .getPointAt(v)
          .addScaledVector(frames.normals[at], Math.cos(ring) * radius)
          .addScaledVector(frames.binormals[at], Math.sin(ring) * radius);
      },
      true,
    ),
    materials.leather,
    'GP medial thumb wrapped below grip',
  );

  // A single molded bridge follows the metacarpals instead of four exposed
  // spherical beads. Longitudinal ribs come from this continuous silhouette.
  add(
    surface(
      high ? 8 : 6,
      sides,
      (u, v) => {
        const x = T.MathUtils.lerp(-0.032, 0.032, v),
          edge = Math.sin(v * Math.PI),
          ring = u * Math.PI * 2,
          y = 0.0275 + 0.006 * edge + 0.0008 * Math.cos(v * Math.PI * 8) * edge;
        return new T.Vector3(
          x,
          y + Math.sin(ring) * (0.002 + 0.002 * edge),
          0.023 - Math.cos(ring) * (0.004 + 0.009 * edge),
        );
      },
      true,
    ),
    high ? materials.armour : materials.leather,
    'GP molded metacarpal bridge',
  );
}
