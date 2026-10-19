import * as T from 'three';
import { sampleProfile } from './profile-sampling.ts';
import { smoothGpSuitSeams } from './gp-rider-suit.ts';
import type { RiderDetail } from './rider.ts';

type Section = readonly [number, number, number, number, number];
export type GpGarment = 'sleeve' | 'pants';

/** Fitted one-piece leather, observed in MotoGP26 REF_071 and REF_098. The
 * deltoid/quadriceps, protected joint and tapered cuff are a single surface.
 * Stations are [bone fraction, centre Z, width, front depth, rear depth]. */
function sections(kind: GpGarment, upper: number, lower: number): Section[] {
  const sleeve = kind === 'sleeve';
  const proximal: readonly Section[] = sleeve
    ? [
        [-0.13, 0, 0.025, 0.03, 0.033],
        [-0.06, 0, 0.046, 0.044, 0.052],
        [0.06, 0.003, 0.055, 0.05, 0.058],
        [0.24, 0.004, 0.056, 0.052, 0.059],
        [0.48, 0.003, 0.05, 0.046, 0.054],
        [0.75, 0.001, 0.041, 0.038, 0.047],
        [1, -0.005, 0.038, 0.037, 0.054],
      ]
    : [
        [-0.14, -0.003, 0.034, 0.038, 0.042],
        [-0.06, -0.003, 0.068, 0.075, 0.079],
        [0.06, 0, 0.08, 0.084, 0.084],
        [0.24, 0.003, 0.082, 0.086, 0.079],
        [0.46, 0.004, 0.073, 0.077, 0.069],
        [0.74, 0.004, 0.06, 0.065, 0.057],
        [1, 0.012, 0.055, 0.061, 0.053],
      ];
  const distal: readonly Section[] = sleeve
    ? [
        [0.14, -0.005, 0.046, 0.048, 0.052],
        [0.32, -0.003, 0.044, 0.047, 0.046],
        [0.62, -0.001, 0.034, 0.036, 0.037],
        [0.86, 0, 0.029, 0.031, 0.031],
        [1.025, 0, 0.027, 0.029, 0.03],
      ]
    : [
        [0.13, 0.006, 0.053, 0.059, 0.055],
        [0.34, -0.007, 0.049, 0.045, 0.058],
        [0.62, -0.004, 0.04, 0.04, 0.046],
        [0.86, 0, 0.032, 0.035, 0.034],
        [1.025, 0, 0.031, 0.034, 0.032],
      ];
  return [
    ...proximal.map(([t, z, w, f, b]): Section => [t * upper, z, w, f, b]),
    ...distal.map(([t, z, w, f, b]): Section => [upper + t * lower, z, w, f, b]),
  ];
}

/** Four small render bones cover torso attachment, upper limb, bend and lower
 * limb. A dedicated bend ring retains its diameter at deep elbow/knee flex;
 * averaging only upper/lower matrices would flatten it into a pinched hinge. */
export function gpGarmentGeometry(
  kind: GpGarment,
  detail: Exclude<RiderDetail, 'far'>,
  upper: number,
  lower: number,
) {
  const profile = sections(kind, upper, lower),
    stations = profile.map((section) => section[0]),
    axes = [1, 2, 3, 4].map((axis) => profile.map((section) => section[axis])),
    sides = detail === 'high' ? 20 : 12,
    steps = detail === 'high' ? (kind === 'sleeve' ? 52 : 56) : 30,
    first = stations[0],
    last = stations[stations.length - 1],
    attachment = kind === 'sleeve' ? 0.062 : 0.096,
    bend = kind === 'sleeve' ? 0.052 : 0.074,
    rows = [
      ...new Set([
        ...Array.from({ length: steps + 1 }, (_, i) => T.MathUtils.lerp(first, last, i / steps)),
        0,
        attachment,
        upper - bend,
        upper,
        upper + bend,
      ]),
    ].sort((a, b) => a - b),
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    skinIndices: number[] = [],
    skinWeights: number[] = [];
  const append = (x: number, y: number, z: number, u: number, v: number) => {
    positions.push(x, y, z);
    uv.push(u, v);
    skinIndices.push(0, 1, 2, 3);
    if (y < attachment) {
      const t = T.MathUtils.smoothstep(y, 0, attachment);
      skinWeights.push(1 - t, t, 0, 0);
    } else if (y < upper) {
      const t = T.MathUtils.smoothstep(y, upper - bend, upper);
      skinWeights.push(0, 1 - t, t, 0);
    } else {
      const t = T.MathUtils.smoothstep(y, upper, upper + bend);
      skinWeights.push(0, 0, 1 - t, t);
    }
  };
  for (let row = 0; row < rows.length; row++) {
    const y = rows[row],
      t = (y - first) / (last - first),
      [centre, width, front, back] = axes.map((values) => sampleProfile(stations, values, y));
    for (let column = 0; column <= sides; column++) {
      const angle = (column / sides) * Math.PI * 2,
        c = Math.cos(angle),
        s = Math.sin(angle),
        // Short, curved folds at the inside joint and shoulder/hip insert.
        // Broad panels remain quiet; no separate ridged patch can float away.
        joint = Math.exp(-(((y - upper) / bend) ** 2)),
        root = Math.exp(-(((y - attachment * 0.82) / (attachment * 0.55)) ** 2)),
        inside = kind === 'sleeve' ? Math.max(0, s) ** 2 : Math.max(0, -s) ** 2,
        fold =
          (0.0025 * joint * inside * Math.sin((y - upper) * 205 + c * 2.3) +
            0.0019 * root * Math.sin(y * 242 + s * 2.5)) *
          Math.sin(t * Math.PI);
      append(
        c * (width + fold),
        y,
        centre + s * ((s > 0 ? front : back) + fold),
        column / sides,
        t,
      );
      if (row < rows.length - 1 && column < sides) {
        const a = row * (sides + 1) + column,
          b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  // Closed caps stay within the suit/gauntlet/boot overlap. Their own planar
  // UV footprint avoids zero-area tangents in the physical leather shader.
  for (const row of [0, rows.length - 1]) {
    const y = rows[row],
      centre = sampleProfile(stations, axes[0], y),
      cap = positions.length / 3,
      ring = row * (sides + 1),
      v = row === 0 ? 0.015 : 0.985;
    append(0, y, centre, 0.5, v);
    for (let column = 0; column <= sides; column++) {
      const at = (ring + column) * 3,
        x = positions[at],
        z = positions[at + 2];
      append(x, y, z, 0.5 + x * 0.15, v + (z - centre) * 0.1);
    }
    for (let column = 0; column < sides; column++) {
      const a = cap + column + 1;
      if (row === 0) indices.push(cap, a, a + 1);
      else indices.push(cap, a + 1, a);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.name = `GP continuous fitted ${kind} (${detail})`;
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  smoothGpSuitSeams(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Skinning follows the existing deterministic IK. No contact target, physics
 * state, pose history, CPU vertex rewrite or additional colour map is needed. */
export class GpRiderGarment {
  readonly mesh: T.SkinnedMesh;
  private readonly attachment = new T.Bone();
  private readonly bend = new T.Bone();
  private readonly relative = new T.Quaternion();
  constructor(
    parent: T.Group,
    private readonly torso: T.Group,
    private readonly proximal: T.Group,
    private readonly distal: T.Group,
    upper: number,
    lower: number,
    at: readonly [number, number, number],
    kind: GpGarment,
    detail: Exclude<RiderDetail, 'far'>,
    material: T.Material,
  ) {
    this.attachment.name = `GP ${kind} attachment to torso`;
    this.attachment.position.fromArray(at);
    torso.add(this.attachment);
    const upperBone = new T.Bone(),
      lowerBone = new T.Bone();
    proximal.add(upperBone, this.bend);
    distal.add(lowerBone);
    this.bend.position.y = upper;
    const skeleton = new T.Skeleton(
      [this.attachment, upperBone, this.bend, lowerBone],
      [
        new T.Matrix4(),
        new T.Matrix4(),
        new T.Matrix4().makeTranslation(0, -upper, 0),
        new T.Matrix4().makeTranslation(0, -upper, 0),
      ],
    );
    this.mesh = new T.SkinnedMesh(gpGarmentGeometry(kind, detail, upper, lower), material);
    this.mesh.name = `GP continuous fitted ${kind}`;
    this.mesh.bind(skeleton, new T.Matrix4());
    this.mesh.boundingSphere = new T.Sphere(new T.Vector3(0, 0.3, 0), 1.65);
    this.mesh.boundingBox = new T.Box3(
      new T.Vector3(-1.2, -1.15, -1.3),
      new T.Vector3(1.2, 1.8, 1.3),
    );
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    parent.add(this.mesh);
  }
  updatePose() {
    // Anchor the opening to the torso even when a shoulder protracts to keep
    // the outside hand on its grip. Orient the opening with its moving limb.
    this.attachment.quaternion
      .copy(this.torso.quaternion)
      .invert()
      .multiply(this.proximal.quaternion);
    this.relative.copy(this.proximal.quaternion).invert().multiply(this.distal.quaternion);
    this.bend.quaternion.identity().slerp(this.relative, 0.5);
  }
  dispose() {
    this.mesh.skeleton.dispose();
  }
}
