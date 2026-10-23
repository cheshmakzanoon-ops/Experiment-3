import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RiderPose } from './rider.ts';

const LUMBAR_HEIGHT = 0.15;
const CHEST_HEIGHT = 0.32;

/** Three bounded frames for the one-piece racing suit. REF018 shows the
 * curved back in a tuck, REF065 the raised chest over the controls, and
 * REF071 the asymmetric waist at an apex. Their timing is authored here;
 * the stills are not motion-capture or anatomical measurements.
 *
 * Each frame maps the original torso's bind coordinates into the rider
 * root. This lets the existing sleeves attach to the chest and the trousers
 * to the pelvis without moving either hand or foot contact target. */
export class GpRiderSpine {
  readonly lumbar = new T.Group();
  readonly chest = new T.Group();
  readonly skeleton: T.Skeleton;
  readonly meshes: T.SkinnedMesh[] = [];
  private readonly euler = new T.Euler();
  private readonly chestAngles = new T.Euler();
  private readonly pivot = new T.Vector3();
  private readonly offset = new T.Vector3();

  constructor(
    parent: T.Group,
    private readonly pelvis: T.Group,
  ) {
    this.lumbar.name = 'GP lumbar spine';
    this.chest.name = 'GP upper chest';
    parent.add(this.lumbar, this.chest);
    const bones = [pelvis, this.lumbar, this.chest].map((frame, i) => {
      const bone = new T.Bone();
      bone.name = ['GP pelvis skin', 'GP lumbar skin', 'GP chest skin'][i];
      frame.add(bone);
      return bone;
    });
    this.skeleton = new T.Skeleton(
      bones,
      bones.map(() => new T.Matrix4()),
    );
  }

  /** Reuse the original torso's material batches and triangle count. Collar,
   * shoulder armour, zip and side panels receive the same skin transform as
   * the underlying suit, so none can float off when the waist bends. */
  bindTorso() {
    const buckets = new Map<T.Material, T.Mesh[]>();
    for (const child of [...this.pelvis.children]) {
      if (!(child instanceof T.Mesh) || Array.isArray(child.material)) continue;
      const bucket = buckets.get(child.material) ?? [];
      bucket.push(child);
      buckets.set(child.material, bucket);
    }
    for (const [material, parts] of buckets) {
      const geometries = parts.map((part) => {
        part.updateMatrix();
        const geometry = part.geometry.clone().applyMatrix4(part.matrix);
        // The small rounded zip pull is non-indexed; retain its vertices and
        // give it a sequential index before joining the indexed armour batch.
        if (!geometry.index)
          geometry.setIndex(
            Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i),
          );
        part.removeFromParent();
        part.geometry.dispose();
        return geometry;
      });
      const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
      if (!geometry) throw new Error('GP torso has incompatible material-batch geometry');
      if (geometries.length > 1) for (const part of geometries) part.dispose();
      const position = geometry.getAttribute('position'),
        indices = new Uint16Array(position.count * 4),
        weights = new Float32Array(position.count * 4);
      for (let i = 0; i < position.count; i++) {
        const y = position.getY(i),
          upper = y > 0.22,
          weight = upper
            ? T.MathUtils.smoothstep(y, 0.22, 0.4)
            : T.MathUtils.smoothstep(y, 0.06, 0.22);
        indices.set(upper ? [1, 2, 0, 0] : [0, 1, 0, 0], i * 4);
        weights.set([1 - weight, weight, 0, 0], i * 4);
      }
      geometry.setAttribute('skinIndex', new T.BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', new T.BufferAttribute(weights, 4));
      const mesh = new T.SkinnedMesh(geometry, material);
      mesh.name = parts.length === 1 ? parts[0].name : `GP articulated torso ${material.name}`;
      mesh.castShadow = parts[0].castShadow;
      mesh.receiveShadow = parts[0].receiveShadow;
      mesh.bind(this.skeleton, new T.Matrix4());
      // Bounds cover the bounded relative bend, including remote replay roots.
      // Skin matrices change; positions, normals and UVs are never uploaded again.
      mesh.boundingBox = new T.Box3(
        new T.Vector3(-0.45, -0.2, -0.45),
        new T.Vector3(0.45, 0.8, 0.45),
      );
      mesh.boundingSphere = new T.Sphere(new T.Vector3(0, 0.3, 0), 0.9);
      this.pelvis.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /** Upper-chest attitude retains the existing riding envelope. The pelvis
   * supplies less flexion/twist, distributed over two short spinal segments.
   * The seat centre is unchanged; there is no render clock or pose history. */
  ride(pose: RiderPose, position: T.Vector3, pitch: number, yaw: number, roll: number) {
    const tuck = T.MathUtils.clamp(pose.tuck, 0, 1),
      braking = Number.isFinite(pose.braking) ? T.MathUtils.clamp(pose.braking, 0, 1) : 0,
      lean = T.MathUtils.clamp(pose.lean, -1.3, 1.3),
      hang = T.MathUtils.clamp(pose.offset, -0.35, 0.35),
      flex = 0.075 + tuck * 0.18 - braking * 0.055 * (1 - tuck * 0.6),
      twist = T.MathUtils.clamp(hang * 0.48 + lean * 0.03, -0.15, 0.15) * (1 - tuck * 0.25),
      sideBend = T.MathUtils.clamp(lean * 0.045 + hang * 0.1, -0.085, 0.085);
    this.pose(
      position,
      this.euler.set(pitch - flex, yaw - twist, roll + sideBend, 'ZYX'),
      this.chestAngles.set(pitch, yaw, roll, 'ZYX'),
    );
  }

  /** Explicit pelvis and chest attitudes from the GP posture solver. The
   * lumbar frame shares their bend; both frames keep the spine continuous. */
  pose(position: T.Vector3, pelvis: T.Euler, chest: T.Euler) {
    this.pelvis.position.copy(position);
    this.pelvis.quaternion.setFromEuler(pelvis);
    this.chest.quaternion.setFromEuler(chest);
    this.lumbar.quaternion.copy(this.pelvis.quaternion).slerp(this.chest.quaternion, 0.55);
    this.placeFrame(this.lumbar, this.pelvis, LUMBAR_HEIGHT);
    this.placeFrame(this.chest, this.lumbar, CHEST_HEIGHT);
  }

  /** Recovery is the existing rigid slide/jog/remount pose. Reset every frame
   * explicitly so a replay seek cannot retain the previous riding flexion. */
  reset() {
    for (const frame of [this.lumbar, this.chest]) {
      frame.position.copy(this.pelvis.position);
      frame.quaternion.copy(this.pelvis.quaternion);
    }
  }

  private placeFrame(frame: T.Group, previous: T.Group, height: number) {
    this.pivot.set(0, height, 0).applyQuaternion(previous.quaternion).add(previous.position);
    this.offset.set(0, height, 0).applyQuaternion(frame.quaternion);
    frame.position.copy(this.pivot).sub(this.offset);
  }

  dispose() {
    // All torso material batches share one small bone texture.
    this.skeleton.dispose();
  }
}
