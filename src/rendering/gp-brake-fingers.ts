import * as T from 'three';
import { GP_GLOVE_GRIP } from './gp-rider-contact.ts';
import { smoothGpSuitSeams } from './gp-rider-suit.ts';

const Z = new T.Vector3(0, 0, 1);
const GRIP = new T.Vector3(...GP_GLOVE_GRIP);
const LENGTHS = [
  [0.034, 0.025, 0.018],
  [0.036, 0.027, 0.019],
] as const;
const ROOT_X = [0.0245, 0.008] as const;
const END_ANGLE = [2.78, 3] as const;
const BASE_Y = GP_GLOVE_GRIP[1] + 0.0248 * Math.cos(-0.66);
const BASE_Z = GP_GLOVE_GRIP[2] + 0.0248 * Math.sin(-0.66);

/** Two continuous leather fingers, five skin frames each. Dedicated bend
 * rings preserve volume at both knuckles. The other two fingers, thumb and
 * palm remain the existing rigid grip; no wrist or contact is translated. */
function fingerGeometry() {
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    skin: number[] = [],
    weights: number[] = [];
  const sides = 8,
    rows = 20;
  for (let finger = 0; finger < 2; finger++) {
    const [a, b, c] = LENGTHS[finger],
      total = a + b + c,
      first = positions.length / 3,
      bone = finger * 5;
    const append = (x: number, y: number, z: number, u: number, v: number, distance: number) => {
      positions.push(x, y, z);
      uv.push(u, v);
      let start: number, end: number, blend: number;
      if (distance < a) {
        start = 0;
        end = 1;
        blend = T.MathUtils.smoothstep(distance, a - 0.006, a);
      } else if (distance < a + 0.006) {
        start = 1;
        end = 2;
        blend = T.MathUtils.smoothstep(distance, a, a + 0.006);
      } else if (distance < a + b) {
        start = 2;
        end = 3;
        blend = T.MathUtils.smoothstep(distance, a + b - 0.005, a + b);
      } else {
        start = 3;
        end = 4;
        blend = T.MathUtils.smoothstep(distance, a + b, a + b + 0.005);
      }
      skin.push(bone + start, bone + end, 0, 0);
      weights.push(1 - blend, blend, 0, 0);
    };
    // Explicit joint stations ensure the volume-preserving bend frames are
    // represented even if the length/sample budget changes later.
    const distances = [
      ...new Set([...Array.from({ length: rows + 1 }, (_, i) => (total * i) / rows), a, a + b]),
    ].sort((x, y) => x - y);
    for (let row = 0; row < distances.length; row++) {
      const d = distances[row],
        v = d / total,
        radius = (finger === 0 ? 0.0071 : 0.0075) * (1 - v * 0.2),
        tip = 1 - T.MathUtils.smoothstep(v, 0.89, 1) * 0.4;
      for (let column = 0; column <= sides; column++) {
        const angle = (column / sides) * Math.PI * 2;
        append(
          ROOT_X[finger] + Math.cos(angle) * radius * tip,
          BASE_Y + Math.sin(angle) * radius * tip,
          BASE_Z + d,
          column / sides,
          v,
          d,
        );
        if (row < distances.length - 1 && column < sides) {
          const p = first + row * (sides + 1) + column,
            q = p + sides + 1;
          indices.push(p, p + 1, q, p + 1, q + 1, q);
        }
      }
    }
    for (const row of [0, distances.length - 1]) {
      const d = distances[row],
        cap = positions.length / 3,
        ring = first + row * (sides + 1);
      append(ROOT_X[finger], BASE_Y, BASE_Z + d, 0.5, row ? 1 : 0, d);
      for (let column = 0; column < sides; column++)
        if (row === 0) indices.push(cap, ring + column + 1, ring + column);
        else indices.push(cap, ring + column, ring + column + 1);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.name = 'GP articulated index and middle leather fingers';
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(skin, 4));
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  smoothGpSuitSeams(geometry);
  return geometry;
}

/** Absolute, fixed-length three-joint IK driven by the presented front-brake
 * input and the actual animated lever. It owns no clock or accumulated pose.
 * Geometry stays on the GPU; only ten small bone matrices change per pose. */
export class GpBrakeFingers {
  readonly root = new T.Group();
  readonly mesh: T.SkinnedMesh;
  /** Glove-local joint landmarks for mechanical contact/length verification. */
  readonly joints = Array.from({ length: 2 }, () =>
    Array.from({ length: 4 }, () => new T.Vector3()),
  );
  private readonly bones = Array.from({ length: 10 }, () => new T.Bone());
  private readonly inverseHand = new T.Quaternion();
  private readonly direction = new T.Vector3();
  private readonly pole = new T.Vector3();
  private readonly tipDirection = new T.Vector3();
  private readonly target = new T.Vector3();
  private readonly q = [new T.Quaternion(), new T.Quaternion(), new T.Quaternion()];
  constructor(parent: T.Group, material: T.Material) {
    this.root.name = 'GP right brake fingers';
    const inverses = this.bones.map((bone, i) => {
      const finger = Math.floor(i / 5),
        at = i % 5,
        [a, b] = LENGTHS[finger],
        d = at === 0 ? 0 : at <= 2 ? a : a + b;
      bone.name = `GP brake finger ${finger + 1} skin frame ${at}`;
      bone.position.set(ROOT_X[finger], BASE_Y, BASE_Z + d);
      this.root.add(bone);
      return new T.Matrix4().makeTranslation(-ROOT_X[finger], -BASE_Y, -BASE_Z - d);
    });
    this.mesh = new T.SkinnedMesh(fingerGeometry(), material);
    this.mesh.name = 'GP continuous brake-finger leather';
    this.mesh.bind(new T.Skeleton(this.bones, inverses), new T.Matrix4());
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = new T.Sphere(new T.Vector3(0, 0, 0.075), 0.15);
    this.mesh.boundingBox = new T.Box3(
      new T.Vector3(-0.06, -0.09, -0.02),
      new T.Vector3(0.07, 0.09, 0.19),
    );
    this.root.add(this.mesh);
    parent.add(this.root);
    this.update(0);
  }
  update(
    braking = 0,
    contacts?: readonly [T.Vector3, T.Vector3],
    grip?: T.Vector3,
    frame?: T.Quaternion,
  ) {
    const input = Number.isFinite(braking) ? T.MathUtils.clamp(braking, 0, 1) : 0,
      cover = contacts && grip && frame ? T.MathUtils.smoothstep(input, 0, 0.08) : 0;
    if (frame) this.inverseHand.copy(frame).invert();
    for (let finger = 0; finger < 2; finger++) {
      const [a, b, c] = LENGTHS[finger],
        [p0, p1, p2, p3] = this.joints[finger],
        angle = END_ANGLE[finger];
      p0.set(ROOT_X[finger], BASE_Y, BASE_Z);
      p3.set(
        ROOT_X[finger],
        GP_GLOVE_GRIP[1] + 0.0248 * Math.cos(angle),
        GP_GLOVE_GRIP[2] + 0.0248 * Math.sin(angle),
      );
      this.tipDirection.set(0, -Math.sin(angle), Math.cos(angle));
      if (cover > 0) {
        this.target.copy(contacts![finger]).sub(grip!).applyQuaternion(this.inverseHand).add(GRIP);
        if (
          Number.isFinite(this.target.x) &&
          Number.isFinite(this.target.y) &&
          Number.isFinite(this.target.z)
        ) {
          p3.lerp(this.target, cover);
          this.tipDirection.lerp(this.target.set(0, -0.8, 0.6), cover).normalize();
        }
      }
      p2.copy(p3).addScaledVector(this.tipDirection, -c);
      this.direction.subVectors(p2, p0);
      const requestedDistance = this.direction.length();
      if (requestedDistance < 1e-8) this.direction.copy(Z);
      else this.direction.multiplyScalar(1 / requestedDistance);
      const distance = T.MathUtils.clamp(
        requestedDistance,
        Math.abs(a - b) + 0.0001,
        a + b - 0.0001,
      );
      p2.copy(p0).addScaledVector(this.direction, distance);
      p3.copy(p2).addScaledVector(this.tipDirection, c);
      const along = (a * a - b * b + distance * distance) / (2 * distance),
        height = Math.sqrt(Math.max(0, a * a - along * along));
      this.pole.set(0, 1, 0).addScaledVector(this.direction, -this.direction.y);
      if (this.pole.lengthSq() < 1e-10)
        this.pole.set(1, 0, 0).addScaledVector(this.direction, -this.direction.x);
      this.pole.normalize();
      p1.copy(p0).addScaledVector(this.direction, along).addScaledVector(this.pole, height);
      for (let part = 0; part < 3; part++)
        this.q[part].setFromUnitVectors(
          Z,
          this.direction
            .subVectors(this.joints[finger][part + 1], this.joints[finger][part])
            .normalize(),
        );
      const bones = this.bones,
        at = finger * 5;
      bones[at].position.copy(p0);
      bones[at].quaternion.copy(this.q[0]);
      bones[at + 1].position.copy(p1);
      bones[at + 1].quaternion.copy(this.q[0]).slerp(this.q[1], 0.5);
      bones[at + 2].position.copy(p1);
      bones[at + 2].quaternion.copy(this.q[1]);
      bones[at + 3].position.copy(p2);
      bones[at + 3].quaternion.copy(this.q[1]).slerp(this.q[2], 0.5);
      bones[at + 4].position.copy(p2);
      bones[at + 4].quaternion.copy(this.q[2]);
    }
  }
  dispose() {
    this.mesh.skeleton.dispose();
  }
}
