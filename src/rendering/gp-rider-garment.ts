import * as T from 'three';
import { sampleProfile } from './profile-sampling.ts';
import { smoothGpSuitSeams } from './gp-rider-suit.ts';
import type { RiderDetail } from './rider.ts';

type Section = readonly [number, number, number, number, number];
export type GpGarment = 'sleeve' | 'pants';

const ROOT_FRAMES = 3;
const ROOT_BONES = [0, 4, 5, 6, 1] as const;

/** Precomputed shape deltas leave the sewn openings, protected joint ring and
 * cuffs in place. Three applies them before skinning in colour and shadow
 * passes; the CPU only supplies two bounded weights. */
function compressionMorphs(geometry: T.BufferGeometry, deltas: readonly number[][]) {
  const positions = geometry.getAttribute('position'),
    normals = geometry.getAttribute('normal');
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [];
  geometry.morphAttributes.normal = [];
  for (const [index, values] of deltas.entries()) {
    const delta = new T.Float32BufferAttribute(values, 3),
      target = new T.BufferGeometry(),
      targetPositions = new Float32Array(positions.array.length);
    delta.name = index === 0 ? 'joint compression' : 'root compression';
    for (let i = 0; i < targetPositions.length; i++)
      targetPositions[i] = positions.array[i] + delta.array[i];
    target.setAttribute('position', new T.BufferAttribute(targetPositions, 3));
    target.setIndex(geometry.index);
    target.computeVertexNormals();
    smoothGpSuitSeams(target);
    const targetNormals = target.getAttribute('normal'),
      normalDelta = new Float32Array(normals.array.length);
    for (let i = 0; i < normalDelta.length; i++)
      normalDelta[i] = targetNormals.array[i] - normals.array[i];
    geometry.morphAttributes.position.push(delta);
    geometry.morphAttributes.normal.push(new T.BufferAttribute(normalDelta, 3));
    target.dispose();
  }
}

/** Fitted one-piece leather, observed in MotoGP26 REF_071 and REF_098. The
 * deltoid/quadriceps, protected joint and tapered cuff are a single surface.
 * Stations are [bone fraction, centre Z, width, front depth, rear depth]. */
function sections(kind: GpGarment, upper: number, lower: number): Section[] {
  const sleeve = kind === 'sleeve';
  const proximal: readonly Section[] = sleeve
    ? [
        [-0.13, 0, 0.018, 0.021, 0.023],
        [-0.06, 0, 0.041, 0.04, 0.047],
        [0.06, 0.003, 0.051, 0.048, 0.054],
        [0.24, 0.004, 0.055, 0.051, 0.057],
        [0.48, 0.003, 0.05, 0.046, 0.054],
        [0.75, 0.001, 0.041, 0.038, 0.047],
        [1, -0.005, 0.038, 0.037, 0.054],
      ]
    : [
        [-0.1, -0.003, 0.026, 0.029, 0.03],
        [-0.04, -0.003, 0.054, 0.059, 0.058],
        [0.06, 0, 0.075, 0.079, 0.076],
        [0.24, 0.003, 0.08, 0.083, 0.074],
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

/** The joint has a dedicated bend frame; the opening has three short frames
 * along a curved saddle. Both retain the garment's cross-section through deep
 * flex, instead of averaging two opposed transforms into a pinched hinge.
 * Existing rows and indices are retained: this adds no triangles or draws. */
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
    skinWeights: number[] = [],
    jointMorph: number[] = [],
    rootMorph: number[] = [];
  const append = (
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    jointRelief = 0,
    rootRelief = 0,
  ) => {
    positions.push(x, y, z);
    uv.push(u, v);
    const c = Math.cos(u * Math.PI * 2),
      s = Math.sin(u * Math.PI * 2);
    jointMorph.push(c * jointRelief, 0, s * jointRelief);
    rootMorph.push(c * rootRelief, 0, s * rootRelief);
    if (y < attachment) {
      const t = T.MathUtils.clamp(y / attachment, 0, 1) * (ROOT_FRAMES + 1),
        segment = Math.min(ROOT_FRAMES, Math.floor(t)),
        weight = t - segment;
      skinIndices.push(ROOT_BONES[segment], ROOT_BONES[segment + 1], 2, 3);
      skinWeights.push(1 - weight, weight, 0, 0);
    } else if (y < upper) {
      const t = T.MathUtils.smoothstep(y, upper - bend, upper);
      skinIndices.push(0, 1, 2, 3);
      skinWeights.push(0, 1 - t, t, 0);
    } else {
      const t = T.MathUtils.smoothstep(y, upper, upper + bend);
      skinIndices.push(0, 1, 2, 3);
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
        jointFold =
          0.0025 * joint * inside * Math.sin((y - upper) * 205 + c * 2.3) * Math.sin(t * Math.PI),
        rootFold = 0.0019 * root * Math.sin(y * 242 + s * 2.5) * Math.sin(t * Math.PI),
        distance = Math.abs(y - upper),
        // The protected ring stays full. Folds gather beside it as the joint
        // closes and relax on extension; sewn and rigid boundaries are fixed.
        jointRelief =
          jointFold *
          0.78 *
          T.MathUtils.smoothstep(distance, 0.003, 0.015) *
          (1 - T.MathUtils.smoothstep(distance, bend * 0.75, bend)),
        rootRelief =
          rootFold *
          0.82 *
          T.MathUtils.smoothstep(y, 0.004, 0.018) *
          (1 - T.MathUtils.smoothstep(y, attachment * 0.78, attachment)),
        fold = jointFold + rootFold - jointRelief - rootRelief;
      append(
        c * (width + fold),
        y,
        centre + s * ((s > 0 ? front : back) + fold),
        column / sides,
        t,
        jointRelief,
        rootRelief,
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
  // Two constant cut coordinates distinguish sleeve/trouser tailoring on the
  // shared leather material. Capture the joint in bind metres: the shader
  // follows skinning without CPU vertex rewrites or another material draw.
  const cut = new Float32Array((positions.length / 3) * 2);
  for (let i = 0; i < cut.length; i += 2) {
    cut[i] = kind === 'sleeve' ? 1 : 2;
    cut[i + 1] = upper;
  }
  geometry.setAttribute('gpSuitCut', new T.BufferAttribute(cut, 2));
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  smoothGpSuitSeams(geometry);
  compressionMorphs(geometry, [jointMorph, rootMorph]);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Shape follows deterministic IK. Root frames preserve volume; precomputed
 * fold deltas follow solved flex, including braking and hang-off. There are
 * no new contact targets, render clocks or CPU vertex uploads. */
export class GpRiderGarment {
  readonly mesh: T.SkinnedMesh;
  private readonly attachment = new T.Bone();
  private readonly bend = new T.Bone();
  private readonly relative = new T.Quaternion();
  private readonly swing = new T.Quaternion();
  private readonly limbAxis = new T.Vector3();
  private readonly openingAxis = new T.Vector3();
  private readonly roots = Array.from({ length: ROOT_FRAMES }, () => new T.Bone());
  private readonly rootRotation = new T.Quaternion();
  private readonly rootStart = new T.Vector3();
  private readonly rootEnd = new T.Vector3();
  private readonly rootTangent = new T.Vector3();
  private readonly limbTangent = new T.Vector3();
  private readonly rootOffset = new T.Vector3();
  private readonly attachmentLength: number;
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
    this.attachmentLength = kind === 'sleeve' ? 0.062 : 0.096;
    this.attachment.name = `GP ${kind} attachment to torso`;
    this.attachment.position.fromArray(at);
    for (const [index, root] of this.roots.entries()) {
      root.name = `GP ${kind} attachment saddle ${index + 1}`;
      parent.add(root);
    }
    // The sewn opening belongs to the torso. A sleeve opens out through the
    // side of the shoulder; trousers open down from the pelvis. Rotating this
    // first ring with the solved limb exposed its cap above the shoulder or
    // behind the hip in a tuck. The existing weights blend into the IK bone
    // over the short saddle, leaving all joint/contact positions unchanged.
    this.openingAxis.set(kind === 'sleeve' ? Math.sign(at[0]) : 0, kind === 'pants' ? -1 : 0, 0);
    torso.add(this.attachment);
    const upperBone = new T.Bone(),
      lowerBone = new T.Bone();
    proximal.add(upperBone, this.bend);
    distal.add(lowerBone);
    this.bend.position.y = upper;
    const skeleton = new T.Skeleton(
      [this.attachment, upperBone, this.bend, lowerBone, ...this.roots],
      [
        new T.Matrix4(),
        new T.Matrix4(),
        new T.Matrix4().makeTranslation(0, -upper, 0),
        new T.Matrix4().makeTranslation(0, -upper, 0),
        ...this.roots.map(() => new T.Matrix4()),
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
    // Keep the opening's normal fixed while taking the nearest roll from the
    // moving limb. A fully fixed X/Z frame can oppose the IK frame by half a
    // turn, causing linear skinning to pinch a shoulder/hip almost flat.
    this.attachment.quaternion
      .copy(this.torso.quaternion)
      .invert()
      .multiply(this.proximal.quaternion);
    this.limbAxis.set(0, 1, 0).applyQuaternion(this.attachment.quaternion);
    this.swing.setFromUnitVectors(this.limbAxis, this.openingAxis);
    this.attachment.quaternion.premultiply(this.swing);
    this.rootRotation.copy(this.torso.quaternion).multiply(this.attachment.quaternion);
    this.rootStart
      .copy(this.attachment.position)
      .applyQuaternion(this.torso.quaternion)
      .add(this.torso.position);
    this.rootTangent.set(0, 1, 0).applyQuaternion(this.rootRotation);
    this.limbTangent.set(0, 1, 0).applyQuaternion(this.proximal.quaternion);
    this.rootEnd
      .copy(this.proximal.position)
      .addScaledVector(this.limbTangent, this.attachmentLength);
    for (let index = 0; index < this.roots.length; index++) {
      const root = this.roots[index],
        t = (index + 1) / (ROOT_FRAMES + 1),
        t2 = t * t,
        t3 = t2 * t;
      // A Hermite centreline joins the sewn opening and solved limb with their
      // endpoint directions. Quaternion frames retain each cross-section.
      root.position
        .copy(this.rootStart)
        .multiplyScalar(2 * t3 - 3 * t2 + 1)
        .addScaledVector(this.rootTangent, (t3 - 2 * t2 + t) * this.attachmentLength)
        .addScaledVector(this.rootEnd, -2 * t3 + 3 * t2)
        .addScaledVector(this.limbTangent, (t3 - t2) * this.attachmentLength);
      root.quaternion.copy(this.rootRotation).slerp(this.proximal.quaternion, t);
      this.rootOffset.set(0, t * this.attachmentLength, 0).applyQuaternion(root.quaternion);
      root.position.sub(this.rootOffset);
    }
    this.relative.copy(this.proximal.quaternion).invert().multiply(this.distal.quaternion);
    this.bend.quaternion.identity().slerp(this.relative, 0.5);
    const jointAngle = Math.acos(
        T.MathUtils.clamp(1 - 2 * (this.relative.x ** 2 + this.relative.z ** 2), -1, 1),
      ),
      rootAngle = Math.acos(T.MathUtils.clamp(this.rootTangent.dot(this.limbTangent), -1, 1));
    // Authored response envelopes, not fabric simulation or measurements
    // inferred from still photos. Held poses and replay seeks are identical.
    this.mesh.morphTargetInfluences![0] = T.MathUtils.smoothstep(jointAngle, 0.3, 1.8);
    this.mesh.morphTargetInfluences![1] = T.MathUtils.smoothstep(rootAngle, 0.2, 1.5);
  }
  dispose() {
    this.mesh.skeleton.dispose();
  }
}
